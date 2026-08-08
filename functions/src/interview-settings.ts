/**
 * functions/src/interview-settings.ts
 *
 * Maps the firm's interview defaults (D1 — firms/{firmId}/interviewSettings/
 * current) onto the firmData object the generators already read. This is the
 * single bridge between the settings record and generation: D2 wires
 * apportionmentMode; later D-sections add their mappings HERE rather than
 * teaching each generator about the record.
 *
 * Precedence, per field: interview setting > legacy top-level firm field >
 * the generator's code default. An unset or unrecognized setting changes
 * nothing, and a failed read degrades silently — firm defaults must never
 * fail a generation.
 */

import * as admin from 'firebase-admin';

/** Mirrors ApportionmentMode in nj-inheritance-tax.ts. */
const APPORTIONMENT_MODES: ReadonlySet<string> = new Set(['residuary', 'apportioned', 'hybrid']);

export async function applyInterviewSettingsToFirmData(
  db: admin.firestore.Firestore,
  firmId: string,
  firmData: Record<string, unknown>,
): Promise<void> {
  try {
    const snap = await db.doc(`firms/${firmId}/interviewSettings/current`).get();
    if (!snap.exists) return;

    // D2 — NJ death-tax apportionment. will-generator reads
    // firmData.taxApportionmentMode; the interview default becomes that field.
    const trust = (snap.get('trust') ?? {}) as { apportionmentMode?: unknown };
    if (
      typeof trust.apportionmentMode === 'string' &&
      APPORTIONMENT_MODES.has(trust.apportionmentMode)
    ) {
      firmData.taxApportionmentMode = trust.apportionmentMode;
    }
  } catch (err) {
    console.warn(
      `[interview-settings] Failed to load interview defaults for firm ${firmId}: ` +
        `${(err as Error).message} — generating with legacy/code defaults.`,
    );
  }
}
