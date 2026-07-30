/**
 * Path builders for Firestore documents and GCS objects (§9 schemas).
 * One place, so a schema move is a one-file diff.
 */

/** Kill switch + spend ledger, mirrors pipeline_state/control (§3, §10). */
export const CONTROL_DOC = 'clause_mining_state/control';

export function runLedgerPath(firmId: string, runId: string): string {
  return `firms/${firmId}/clauseMining/${runId}`;
}

export function filesCollection(firmId: string, runId: string): string {
  return `${runLedgerPath(firmId, runId)}/files`;
}

export function fileDocPath(firmId: string, runId: string, driveFileId: string): string {
  return `${filesCollection(firmId, runId)}/${driveFileId}`;
}

/**
 * Curated-seed manifest rows (§11 P1). A SEPARATE collection from the corpus
 * `files` collection on purpose: Gate 4's independent-recovery canary is only
 * meaningful if the seed is out of corpus input BY CONSTRUCTION, not by a
 * filter some later stage could forget to apply.
 */
export function seedFilesCollection(firmId: string, runId: string): string {
  return `${runLedgerPath(firmId, runId)}/seedFiles`;
}

export function seedFileDocPath(firmId: string, runId: string, driveFileId: string): string {
  return `${seedFilesCollection(firmId, runId)}/${driveFileId}`;
}

export function docFactsCollection(firmId: string, runId: string): string {
  return `${runLedgerPath(firmId, runId)}/docFacts`;
}

export function docFactsPath(firmId: string, runId: string, driveFileId: string): string {
  return `${docFactsCollection(firmId, runId)}/${driveFileId}`;
}

export function catalogCollection(firmId: string): string {
  return `firms/${firmId}/clauseCatalog`;
}

export function catalogDocPath(firmId: string, clauseId: string): string {
  return `${catalogCollection(firmId)}/${clauseId}`;
}

/* ------------------------------------------------------------------ */
/* GCS object paths (relative to the bucket)                          */
/* ------------------------------------------------------------------ */

function gcsBase(firmId: string): string {
  return `firms/${firmId}/clause-mining`;
}

export function convertedPath(firmId: string, driveFileId: string): string {
  return `${gcsBase(firmId)}/converted/${driveFileId}.docx`;
}

export function textPath(firmId: string, driveFileId: string): string {
  return `${gcsBase(firmId)}/text/${driveFileId}.txt`;
}

/** Reflowed plaintext artifact (spans index here when reflow fired, §4.1). */
export function reflowedTextPath(firmId: string, driveFileId: string): string {
  return `${gcsBase(firmId)}/text-reflowed/${driveFileId}.txt`;
}

/** Segments-ready JSON: paragraphs + style/numbering hints from OOXML. */
export function segmentsReadyPath(firmId: string, driveFileId: string): string {
  return `${gcsBase(firmId)}/segments-ready/${driveFileId}.json`;
}

/** Per-file segment records (volume — GCS, not Firestore; §9 note). */
export function segmentsPath(firmId: string, runId: string, driveFileId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/segments/${driveFileId}.json`;
}

export function edgesPath(firmId: string, runId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/identity/edges.json`;
}

export function familiesPath(firmId: string, runId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/identity/families.json`;
}

export function adjudicationPath(firmId: string, runId: string, pairId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/adjudications/${pairId}.json`;
}

export function canonicalPath(firmId: string, runId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/canonical/families.json`;
}

export function statsPath(firmId: string, runId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/stats/contingency.json`;
}

/** Segmented curated-seed pieces (§11 P1) — the gold set Gates 1–3 measure against. */
export function seedPiecesPath(firmId: string, runId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/seed/pieces.json`;
}

/** Seed→family match result, written by canonicalize, read by the gates (§11). */
export function seedMatchPath(firmId: string, runId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/seed/matches.json`;
}

/** The packet Adam labels in his bounded 1-hour session (§11 P1). */
export function calibrationPacketPath(firmId: string, runId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/calibration/packet.json`;
}

/** Adam's returned labels — written by the review UI, read by `calibrate`. */
export function calibrationLabelsPath(firmId: string, runId: string): string {
  return `${runLedgerPath(firmId, runId)}/calibration/labels`;
}

/** §11 P3 validation report — the deliverable that gates Adam's review. */
export function gatesReportPath(firmId: string, runId: string): string {
  return `${gcsBase(firmId)}/runs/${runId}/validation/gates.json`;
}
