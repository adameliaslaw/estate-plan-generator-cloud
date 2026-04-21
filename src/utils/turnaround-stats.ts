/**
 * turnaround-stats.ts
 *
 * Derives turnaround-time metrics for the dashboard "Turnaround Times" card
 * and its per-client drill-in. All inputs are read directly from Client and
 * Document timestamps that the app already writes — no new Firestore fields.
 *
 * Metric definitions:
 *   - Questionnaire duration:  completedAt − startedAt
 *   - Draft turnaround:        first doc createdAt − questionnaire completedAt
 *   - Review turnaround:       doc reviewedAt − doc createdAt (per doc, averaged per client)
 *   - Signing lag:             doc signedAt − doc reviewedAt (per doc, averaged per client)
 *   - Full cycle:              last signedAt − client createdAt (requires all required docs signed)
 *
 * Only clients that have the required timestamps contribute to each median.
 * Archived clients are excluded from all metrics.
 */

import type { Client, Document } from '@/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

function tsMs(ts: unknown): number | null {
  const t = ts as { seconds?: number } | null | undefined;
  if (!t?.seconds) return null;
  return t.seconds * 1000;
}

function daysBetween(startMs: number, endMs: number): number {
  return (endMs - startMs) / MS_PER_DAY;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// ── Per-client cycle breakdown ────────────────────────────────────────────────

export type ClientStage =
  | 'not_started'     // Questionnaire not started
  | 'questionnaire'   // Questionnaire in progress
  | 'drafting'        // Questionnaire complete, no docs generated
  | 'review'          // Docs exist, some in draft/review status
  | 'signing'         // All docs reviewed, some not yet signed
  | 'complete';       // All docs signed

export interface ClientCycleRow {
  clientId: string;
  displayName: string;
  stage: ClientStage;
  daysInStage: number | null;
  daysSinceIntake: number;
  // Per-metric contributions (null if not applicable for this client yet)
  questionnaireDays: number | null;
  draftTurnaroundDays: number | null;
  avgReviewDays: number | null;
  avgSigningDays: number | null;
  fullCycleDays: number | null;
}

function clientDisplayName(c: Client): string {
  const { lastName, firstName } = c.personalInfo;
  if (!lastName && !firstName) return 'Unknown Client';
  if (!firstName) return lastName;
  return `${lastName}, ${firstName}`;
}

/**
 * Figure out which pipeline stage a client is in based on their
 * questionnaire + documents state.
 */
function computeStage(
  client: Client,
  docs: Document[],
): { stage: ClientStage; stageEnteredMs: number | null } {
  const qStatus = client.questionnaireProgress?.status;
  const qStartedMs = tsMs(client.questionnaireProgress?.startedAt);
  const qCompletedMs = tsMs(client.questionnaireProgress?.completedAt);
  const createdMs = tsMs(client.createdAt);

  // Not started
  if (qStatus !== 'in_progress' && qStatus !== 'completed') {
    return { stage: 'not_started', stageEnteredMs: createdMs };
  }

  // Questionnaire in progress
  if (qStatus === 'in_progress') {
    return { stage: 'questionnaire', stageEnteredMs: qStartedMs ?? createdMs };
  }

  // From here, questionnaire is completed
  if (docs.length === 0) {
    return { stage: 'drafting', stageEnteredMs: qCompletedMs };
  }

  // We have docs. Check review + signing state.
  const allReviewed = docs.every((d) => !!d.reviewedAt);
  if (!allReviewed) {
    // Last doc touched = most recent `updatedAt` or `createdAt`
    const latestDocMs = docs
      .map((d) => tsMs(d.updatedAt) ?? tsMs(d.createdAt) ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return { stage: 'review', stageEnteredMs: latestDocMs || qCompletedMs };
  }

  const allSigned = docs.every((d) => !!d.signedAt);
  if (!allSigned) {
    const latestReviewMs = docs
      .map((d) => tsMs(d.reviewedAt) ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);
    return { stage: 'signing', stageEnteredMs: latestReviewMs || qCompletedMs };
  }

  // All docs signed = complete. Stage "entered" = last sign timestamp.
  const lastSignMs = docs
    .map((d) => tsMs(d.signedAt) ?? 0)
    .reduce((a, b) => Math.max(a, b), 0);
  return { stage: 'complete', stageEnteredMs: lastSignMs || null };
}

export function buildClientCycleRow(
  client: Client,
  docs: Document[],
  nowMs: number = Date.now(),
): ClientCycleRow {
  const createdMs = tsMs(client.createdAt) ?? nowMs;
  const qStartedMs = tsMs(client.questionnaireProgress?.startedAt);
  const qCompletedMs = tsMs(client.questionnaireProgress?.completedAt);

  const questionnaireDays =
    qStartedMs != null && qCompletedMs != null
      ? daysBetween(qStartedMs, qCompletedMs)
      : null;

  // Draft turnaround: Q completed → first doc created
  const firstDocMs =
    docs.length > 0
      ? docs
          .map((d) => tsMs(d.createdAt) ?? Number.POSITIVE_INFINITY)
          .reduce((a, b) => Math.min(a, b), Number.POSITIVE_INFINITY)
      : null;
  const draftTurnaroundDays =
    qCompletedMs != null && firstDocMs != null && isFinite(firstDocMs)
      ? daysBetween(qCompletedMs, firstDocMs)
      : null;

  // Review turnaround: average across docs that have been reviewed
  const perDocReviewDays: number[] = [];
  for (const d of docs) {
    const genMs = tsMs(d.createdAt);
    const revMs = tsMs(d.reviewedAt);
    if (genMs != null && revMs != null && revMs >= genMs) {
      perDocReviewDays.push(daysBetween(genMs, revMs));
    }
  }
  const avgReviewDays = mean(perDocReviewDays);

  // Signing lag: average across docs that have been signed AND reviewed
  const perDocSigningDays: number[] = [];
  for (const d of docs) {
    const revMs = tsMs(d.reviewedAt);
    const signMs = tsMs(d.signedAt);
    if (revMs != null && signMs != null && signMs >= revMs) {
      perDocSigningDays.push(daysBetween(revMs, signMs));
    }
  }
  const avgSigningDays = mean(perDocSigningDays);

  // Full cycle: only defined when all docs are signed
  const allSigned = docs.length > 0 && docs.every((d) => !!d.signedAt);
  const lastSignMs = allSigned
    ? docs
        .map((d) => tsMs(d.signedAt) ?? 0)
        .reduce((a, b) => Math.max(a, b), 0)
    : null;
  const fullCycleDays =
    lastSignMs != null && lastSignMs > 0 ? daysBetween(createdMs, lastSignMs) : null;

  const { stage, stageEnteredMs } = computeStage(client, docs);
  const daysInStage =
    stageEnteredMs != null ? daysBetween(stageEnteredMs, nowMs) : null;
  const daysSinceIntake = daysBetween(createdMs, nowMs);

  return {
    clientId: client.id,
    displayName: clientDisplayName(client),
    stage,
    daysInStage,
    daysSinceIntake,
    questionnaireDays,
    draftTurnaroundDays,
    avgReviewDays,
    avgSigningDays,
    fullCycleDays,
  };
}

// ── Aggregate medians ─────────────────────────────────────────────────────────

export interface TurnaroundMedians {
  questionnaireDays: number | null;
  draftTurnaroundDays: number | null;
  reviewTurnaroundDays: number | null;
  signingLagDays: number | null;
  fullCycleDays: number | null;
  // Sample sizes for the tooltip/subtitle
  samples: {
    questionnaire: number;
    draft: number;
    review: number;
    signing: number;
    fullCycle: number;
  };
}

export function computeTurnaroundMedians(
  rows: ClientCycleRow[],
): TurnaroundMedians {
  const q: number[] = [];
  const d: number[] = [];
  const r: number[] = [];
  const s: number[] = [];
  const f: number[] = [];
  for (const row of rows) {
    if (row.questionnaireDays != null) q.push(row.questionnaireDays);
    if (row.draftTurnaroundDays != null) d.push(row.draftTurnaroundDays);
    if (row.avgReviewDays != null) r.push(row.avgReviewDays);
    if (row.avgSigningDays != null) s.push(row.avgSigningDays);
    if (row.fullCycleDays != null) f.push(row.fullCycleDays);
  }
  return {
    questionnaireDays: median(q),
    draftTurnaroundDays: median(d),
    reviewTurnaroundDays: median(r),
    signingLagDays: median(s),
    fullCycleDays: median(f),
    samples: {
      questionnaire: q.length,
      draft: d.length,
      review: r.length,
      signing: s.length,
      fullCycle: f.length,
    },
  };
}

// ── Orchestration ─────────────────────────────────────────────────────────────

/**
 * Compute per-client rows + aggregate medians from the dashboard's
 * already-fetched clients and firm-wide documents list.
 */
export function computeTurnaroundReport(
  clients: Client[],
  documents: Document[],
  nowMs: number = Date.now(),
): { rows: ClientCycleRow[]; medians: TurnaroundMedians } {
  const docsByClient = new Map<string, Document[]>();
  for (const d of documents) {
    if (!d.clientId) continue;
    const arr = docsByClient.get(d.clientId) ?? [];
    arr.push(d);
    docsByClient.set(d.clientId, arr);
  }

  const activeClients = clients.filter((c) => !c.isArchived);
  const rows = activeClients.map((c) =>
    buildClientCycleRow(c, docsByClient.get(c.id) ?? [], nowMs),
  );
  const medians = computeTurnaroundMedians(rows);
  return { rows, medians };
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function formatDays(days: number | null): string {
  if (days == null) return '—';
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours}h`;
  }
  const rounded = Math.round(days * 10) / 10;
  return `${rounded}d`;
}

export const STAGE_LABELS: Record<ClientStage, string> = {
  not_started: 'Not started',
  questionnaire: 'Questionnaire',
  drafting: 'Drafting',
  review: 'Review',
  signing: 'Signing',
  complete: 'Complete',
};

export const STAGE_COLORS: Record<ClientStage, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  questionnaire: 'bg-amber-100 text-amber-700',
  drafting: 'bg-emerald-100 text-emerald-700',
  review: 'bg-blue-100 text-blue-700',
  signing: 'bg-indigo-100 text-indigo-700',
  complete: 'bg-slate-200 text-slate-700',
};
