/**
 * functions/src/inheritance-tax-compute.ts
 *
 * Callable wrapper around the NJ Transfer Inheritance Tax engine
 * (`./inheritance-tax`, ported from `adameliaslaw/elias-estate-suite`).
 *
 * The engine itself is pure and has no idea Firebase exists; this file is the only thing that
 * knows about auth, tenancy, and HttpsError. Two rules it exists to preserve across the RPC
 * boundary:
 *
 *  1. **Refuse, never guess.** The engine throws `UnsupportedMatterError` for estate structures
 *     it cannot model to the exact official figures (nonresident decedent, death before 2002,
 *     deductions exceeding the gross estate, any non-pro-rata apportionment). That surfaces here
 *     as `failed-precondition` with the engine's own reason — NOT as a computed number. A
 *     plausible-but-wrong return is the worst failure this system can have.
 *  2. **Validation is not optional.** Every matter goes through `validateMatter` before it
 *     reaches the engine, so a malformed matter is `invalid-argument`, never a silent default.
 *
 * The handler is exported separately from the callable so it can be unit-tested without mocking
 * Firebase (see `tests/unit/inheritance-tax-compute-handler.test.ts`).
 *
 * Output is a WORKPAPER for attorney review, not a filed return.
 */
import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { assertFirmStaff } from './auth-guards';
import {
  computeEstate,
  deriveEngineMatter,
  getRuleSet,
  validateMatter,
  UnsupportedMatterError,
} from './inheritance-tax';

export interface ComputeInheritanceTaxRequest {
  firmId: string;
  /** An IT-R `Matter` (see ./inheritance-tax/types). Validated before use. */
  matter: unknown;
}

export interface ComputeInheritanceTaxResponse {
  ruleSetId: string;
  /** Full `EstateComputation` — summary lines, per-beneficiary tax, and `filingDeadline`. */
  computation: unknown;
  /** Always true — every figure here is a preparation aid, not a filed return. */
  workpaper: true;
}

/**
 * NOT exposed here, deliberately: IT-R **form data**. `buildITRFormData` requires an
 * *approved* `ReviewCheckpoint` and renders only from its frozen snapshot, so a form can
 * never disagree with what an attorney signed off on. Wiring that needs the review/freeze
 * workflow on Firestore (the next slice) — not a shortcut around it.
 */

/**
 * Pure handler: validate → select the rule set by date of death → compute → (optionally) build
 * the IT-R form data. Throws `HttpsError`; performs no I/O.
 */
export function computeInheritanceTaxHandler(
  data: ComputeInheritanceTaxRequest,
): ComputeInheritanceTaxResponse {
  if (!data || typeof data !== 'object' || !data.firmId) {
    throw new HttpsError('invalid-argument', 'firmId is required.');
  }
  if (data.matter === undefined || data.matter === null) {
    throw new HttpsError('invalid-argument', 'matter is required.');
  }

  let matter;
  try {
    matter = validateMatter(data.matter);
  } catch (e) {
    // A matter that does not validate must never reach the engine.
    throw new HttpsError(
      'invalid-argument',
      `Matter validation failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Nonresident decedents are out of scope: the return is an IT-NR, not an IT-R. In the source
  // application that refusal lives in `buildITRFormData` (forms/it-r.ts), because a form could
  // only ever be produced through it. This callable returns figures WITHOUT building a form, so
  // the guard has to be repeated here — otherwise a nonresident matter would come back as a
  // confident set of numbers with nothing to refuse it, which is the exact failure mode the
  // engine's scope rules exist to prevent.
  if (matter.decedent.isNJResident === false) {
    throw new HttpsError(
      'failed-precondition',
      'Nonresident decedent: this engine computes the resident IT-R only. A nonresident estate ' +
        'requires Form IT-NR (and L-9 NR for real property) — compute it separately.',
    );
  }

  try {
    // The rule set is selected by date of death (2002 / 2017 / 2018 / 2025 regimes), and the
    // computation carries its own `filingDeadline` — 8 months, shifted off weekends and NJ
    // legal holidays (N.J.A.C. 18:2-4.12).
    const ruleSet = getRuleSet(matter.decedent.dateOfDeath);
    // A matter in the allocation model carries assets, not per-beneficiary bequests. The
    // per-beneficiary amounts the engine needs are DERIVED here, at the boundary — the engine
    // keeps the shape it has always taken, and the gold cases keep proving the figures.
    // A matter in the nested model passes through untouched.
    const computation = computeEstate(deriveEngineMatter(matter), ruleSet);
    return { ruleSetId: ruleSet.id, computation, workpaper: true };
  } catch (e) {
    if (e instanceof UnsupportedMatterError) {
      // Out of the engine's modelled scope — the attorney computes this one by hand.
      throw new HttpsError('failed-precondition', e.message);
    }
    throw e;
  }
}

export const computeInheritanceTax = onCall(
  {
    region: 'us-east1',
    timeoutSeconds: 60,
    memory: '512MiB',
  },
  async (request: CallableRequest<unknown>): Promise<ComputeInheritanceTaxResponse> => {
    const data = request.data as ComputeInheritanceTaxRequest;
    if (!data || typeof data !== 'object' || !data.firmId) {
      throw new HttpsError('invalid-argument', 'firmId is required.');
    }
    // Staff-only, and only within the caller's own firm.
    assertFirmStaff(request, data.firmId);
    return computeInheritanceTaxHandler(data);
  },
);
