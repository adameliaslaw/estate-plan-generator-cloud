/**
 * inheritance-tax-service.ts
 *
 * Frontend service layer for the NJ Transfer Inheritance Tax (IT-R) workflow. Every operation
 * goes through a Cloud Function — the Firestore collections behind this are closed to the client
 * SDK on purpose (the record holds the decedent's SSN, the audit chain is append-only, and a
 * checkpoint's status IS the approval gate).
 *
 * Deliberately NOT wired to the estate-planning questionnaire. A decedent is almost always a new
 * intake rather than a former planning client, so there is no mapping layer between the two data
 * models — just an optional `clientId` association for the occasional case where a planning client
 * has died. Association, not data sharing.
 */

import { functions } from '@/config/firebase';
import { httpsCallable } from 'firebase/functions';
import type {
  ITRMatterInput,
  EstateComputationResult,
  InheritanceMatterSummary,
  ITRFormResult,
  CompanionForm,
  CompanionFormResult,
  AuditTrailResult,
  CheckpointResult,
} from '@/types/inheritance-tax';

const call = <Req, Res>(name: string) => httpsCallable<Req, Res>(functions, name);

export const inheritanceTaxService = {
  /** Firm-scoped list. Projected server-side — never carries an SSN. */
  async list(firmId: string): Promise<InheritanceMatterSummary[]> {
    const fn = call<{ firmId: string }, { matters: InheritanceMatterSummary[] }>('listInheritanceMatters');
    const res = await fn({ firmId });
    return res.data.matters;
  },

  /**
   * Create or update a matter. The server re-validates the whole matter every time and refuses
   * to persist an invalid one, so a rejected save means the input is wrong — not that the save
   * failed.
   */
  async save(firmId: string, matter: ITRMatterInput, clientId?: string): Promise<{ matterId: string; created: boolean }> {
    const fn = call<{ firmId: string; matter: ITRMatterInput; clientId?: string }, { matterId: string; created: boolean }>('saveInheritanceMatter');
    const res = await fn({ firmId, matter, ...(clientId ? { clientId } : {}) });
    return res.data;
  },

  /** Compute and store. Out-of-scope estate structures come back as an error, never a number. */
  async compute(firmId: string, matterId: string): Promise<EstateComputationResult> {
    const fn = call<{ firmId: string; matterId: string }, { computation: EstateComputationResult }>('computeAndStoreInheritanceTax');
    const res = await fn({ firmId, matterId });
    return res.data.computation;
  },

  /** Freeze the latest computation into a review checkpoint. */
  async requestReview(firmId: string, matterId: string): Promise<CheckpointResult> {
    const fn = call<{ firmId: string; matterId: string }, CheckpointResult>('requestInheritanceReview');
    const res = await fn({ firmId, matterId });
    return res.data;
  },

  /** Two-attorney approval. Refuses a self-approval — use `finalize` if you are the only attorney. */
  async approve(firmId: string, matterId: string, checkpointId: string): Promise<CheckpointResult> {
    const fn = call<{ firmId: string; matterId: string; checkpointId: string }, CheckpointResult>('approveInheritanceReview');
    const res = await fn({ firmId, matterId, checkpointId });
    return res.data;
  },

  /**
   * Sole-practitioner finalization: you freeze your own work. Recorded as `matter_finalized`,
   * never `review_approved` — it is provenance, not an independent review.
   */
  async finalize(firmId: string, matterId: string, checkpointId: string): Promise<CheckpointResult> {
    const fn = call<{ firmId: string; matterId: string; checkpointId: string }, CheckpointResult>('finalizeInheritanceReview');
    const res = await fn({ firmId, matterId, checkpointId });
    return res.data;
  },

  /**
   * The IT-R. Only available once a checkpoint is approved; renders from its frozen snapshot.
   *
   * `html` is the on-screen workpaper; `pdf` is the State's own booklet filled in and ready to
   * sign. The PDF is opt-in because it costs roughly 700KB on the wire.
   */
  async getForm(
    firmId: string,
    matterId: string,
    opts: { html?: boolean; pdf?: boolean } = {},
  ): Promise<ITRFormResult> {
    const { html = true, pdf = false } = opts;
    const fn = call<{ firmId: string; matterId: string; html: boolean; pdf: boolean }, ITRFormResult>('getInheritanceForm');
    const res = await fn({ firmId, matterId, html, pdf });
    return res.data;
  },

  /**
   * One of the forms that travel with the IT-R. Rendered from the same approved snapshot; a
   * matter that does not meet the form's own precondition is refused with the reason.
   */
  async getCompanionForm(
    firmId: string,
    matterId: string,
    form: CompanionForm,
  ): Promise<CompanionFormResult> {
    const fn = call<{ firmId: string; matterId: string; form: CompanionForm }, CompanionFormResult>('getInheritanceCompanionForm');
    const res = await fn({ firmId, matterId, form });
    return res.data;
  },

  /** The signed audit chain plus a live re-verification of its integrity. */
  async auditTrail(firmId: string, matterId: string): Promise<AuditTrailResult> {
    const fn = call<{ firmId: string; matterId: string }, AuditTrailResult>('getInheritanceAuditTrail');
    const res = await fn({ firmId, matterId });
    return res.data;
  },
};
