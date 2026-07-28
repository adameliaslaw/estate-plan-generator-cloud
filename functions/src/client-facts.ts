/**
 * functions/src/client-facts.ts
 *
 * Deterministic client facts — the single source of truth for every fact the
 * generation pipeline asserts about a client (marital status, minor children,
 * asset totals) plus a pre-generation consistency check.
 *
 * Why this exists: prompts previously derived these facts in more than one
 * place with subtly different rules (case-sensitive marital-status matching
 * in the serializer vs. presence-based spouse logic in the aggregator; a
 * stored `isMinor` flag that no intake path ever wrote). Divergent or stale
 * facts produce internally contradictory prompts — and in a legal document
 * generator, a wrong fact (e.g. "no minor children") silently drops entire
 * articles such as guardianship. Every consumer must derive these facts from
 * here; do not re-implement them inline.
 */

import * as admin from 'firebase-admin';

type Rec = Record<string, unknown> | admin.firestore.DocumentData;

// ---------------------------------------------------------------------------
// Minor children
// ---------------------------------------------------------------------------

/**
 * Determine whether a child is a minor (under 18).
 *
 * Computes from the ISO `dob` field at generation time — the stored `isMinor`
 * flag is only a fallback for records with no parseable DOB, because no
 * intake path ever writes it and a stored flag goes stale as children age.
 */
export function isMinorChild(c: Rec): boolean {
  const dob = typeof c.dob === 'string' ? c.dob : undefined;
  if (dob) {
    const birth = new Date(dob);
    if (!isNaN(birth.getTime())) {
      const now = new Date();
      let age = now.getFullYear() - birth.getFullYear();
      const m = now.getMonth() - birth.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
      return age < 18;
    }
  }
  return c.isMinor === true;
}

// ---------------------------------------------------------------------------
// Spouse
// ---------------------------------------------------------------------------

/**
 * Marital statuses that imply a spouse/partner for document purposes.
 * Deliberately mirrors the historical predicate ('Married' and 'Domestic
 * Partnership' from MARITAL_STATUSES) — but matched case-insensitively so
 * data-entry or import casing drift cannot silently flip a married client
 * to "SPOUSE: None" in prompts. Statuses outside this set that still carry
 * spouseInfo are surfaced by checkClientFactConsistency rather than decided
 * silently here.
 */
const SPOUSAL_STATUSES = new Set(['married', 'domestic partnership']);

/** Case-insensitive spousal-status predicate. */
export function hasSpousalStatus(maritalStatus: unknown): boolean {
  return (
    typeof maritalStatus === 'string' &&
    SPOUSAL_STATUSES.has(maritalStatus.trim().toLowerCase())
  );
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * Estimate total assets from the canonical Assets shape. Kept identical to
 * the historical aggregator arithmetic (first non-null of cashValue/faceValue
 * for life insurance) — now in one place.
 */
export function estimateTotalAssets(assets: Rec | undefined | null): number {
  const a = (assets ?? {}) as Record<string, unknown>;
  const list = (key: string): Record<string, unknown>[] =>
    Array.isArray(a[key]) ? (a[key] as Record<string, unknown>[]) : [];
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  let total = 0;
  for (const p of list('realEstate')) total += num(p.estimatedValue);
  for (const b of list('bankAccounts')) total += num(b.estimatedBalance);
  for (const i of list('investmentAccounts')) total += num(i.estimatedValue);
  for (const r of list('retirementAccounts')) total += num(r.estimatedValue);
  for (const l of list('lifeInsurance')) {
    total += num(l.cashValue) || num(l.faceValue);
  }
  for (const b of list('businessInterests')) total += num(b.estimatedValue);
  for (const pp of list('personalProperty')) total += num(pp.estimatedValue);
  // A manually entered estate total overrides the itemized sum.
  const manual = num(a.estimatedTotalEstate);
  return manual > 0 ? manual : total;
}

// ---------------------------------------------------------------------------
// Pre-generation consistency check
// ---------------------------------------------------------------------------

export interface ClientFactFinding {
  /** Stable machine code, e.g. "spouse-data-mismatch". */
  code:
    | 'spouse-data-mismatch'
    | 'spouse-info-missing'
    | 'child-missing-dob'
    | 'stale-isminor-flag'
    | 'minors-without-guardian';
  severity: 'warning' | 'error';
  message: string;
}

function personName(p: unknown): string {
  if (!p || typeof p !== 'object') return '';
  const r = p as Record<string, unknown>;
  if (typeof r.name === 'string' && r.name.trim()) return r.name.trim();
  return [r.firstName, r.lastName]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join(' ');
}

/**
 * Cross-check the facts the prompts will assert against the underlying
 * client record. Findings do not block generation; they are logged, attached
 * to the generated document, and shown to the reviewing attorney — the goal
 * is that a contradictory prompt is never sent silently.
 */
export function checkClientFactConsistency(client: Rec): ClientFactFinding[] {
  const findings: ClientFactFinding[] = [];
  const pi = (client.personalInfo ?? {}) as Record<string, unknown>;
  const spouseInfo = client.spouseInfo as Record<string, unknown> | undefined;
  const spousal = hasSpousalStatus(pi.maritalStatus);
  const spouseNamed = personName(spouseInfo).length > 0;

  if (spousal && !spouseNamed) {
    findings.push({
      code: 'spouse-info-missing',
      severity: 'error',
      message:
        `Marital status is "${String(pi.maritalStatus)}" but no spouse name is on file — ` +
        'spousal provisions (elective share, marital bequests) cannot be drafted correctly.',
    });
  }
  if (!spousal && spouseNamed) {
    findings.push({
      code: 'spouse-data-mismatch',
      severity: 'warning',
      message:
        `Spouse "${personName(spouseInfo)}" is on file but marital status is ` +
        `"${String(pi.maritalStatus ?? 'unset')}" — prompts will treat the client as unmarried. ` +
        'Confirm the marital status before generating.',
    });
  }

  const children = Array.isArray(client.children)
    ? (client.children as Record<string, unknown>[])
    : [];
  for (const child of children) {
    const name = personName(child) || 'Unnamed child';
    const dob = typeof child.dob === 'string' ? child.dob : '';
    if (!dob || isNaN(new Date(dob).getTime())) {
      findings.push({
        code: 'child-missing-dob',
        severity: 'warning',
        message: `${name} has no parseable date of birth — minor/adult status falls back to the stored isMinor flag.`,
      });
    } else if (child.isMinor === true && !isMinorChild({ dob })) {
      findings.push({
        code: 'stale-isminor-flag',
        severity: 'warning',
        message: `${name} is flagged isMinor but their DOB (${dob}) makes them an adult — the stored flag is stale.`,
      });
    }
  }

  const hasMinors = children.some((c) => isMinorChild(c));
  if (hasMinors) {
    const fiduciaries = (client.fiduciaries ?? {}) as Record<string, unknown>;
    const guardian = (fiduciaries.guardian ?? {}) as Record<string, unknown>;
    if (!personName(guardian.primary)) {
      findings.push({
        code: 'minors-without-guardian',
        severity: 'error',
        message:
          'Client has minor children but no primary guardian is on file — ' +
          'guardianship provisions cannot be drafted.',
      });
    }
  }

  return findings;
}
