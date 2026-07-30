/**
 * Narrow client interfaces for everything that touches GCP, the shell, or
 * Anthropic. Stage orchestration depends ONLY on these (constructor
 * injection), so unit tests run with in-memory fakes and no network — the
 * repo rule that live API calls never happen in tests.
 *
 * Real implementations live in src/clients/gcp.ts and src/anthropic-batch.ts.
 */

export type DocData = Record<string, unknown>;

/**
 * Marker for Firestore vector fields: the real DocStore converts
 * `{ __vector: number[] }` to FieldValue.vector() on write (§9
 * clauseCatalog.embedding). Fakes may store it as-is.
 */
export interface VectorValue {
  __vector: number[];
}

export function vectorValue(values: number[]): VectorValue {
  return { __vector: values };
}

export interface DocStore {
  get(path: string): Promise<DocData | null>;
  /** set with merge:true semantics by default. */
  set(path: string, data: DocData, opts?: { merge?: boolean }): Promise<void>;
  /** All docs in a (small) collection. Pilot volumes only — see callers. */
  listDocs(collectionPath: string): Promise<Array<{ id: string; data: DocData }>>;
  /** Doc ids only (cheap resume checks). */
  listIds(collectionPath: string): Promise<string[]>;
  /**
   * Read-modify-write transaction on a single doc. `fn` returns the merged
   * update to write, or throws to abort (the throw propagates).
   */
  transact(path: string, fn: (current: DocData | null) => DocData): Promise<DocData>;
}

export interface BlobStore {
  write(path: string, data: Buffer | string): Promise<void>;
  read(path: string): Promise<Buffer>;
  exists(path: string): Promise<boolean>;
}

export interface DriveFileMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  md5Checksum: string | undefined;
  /** false ⇒ owned by an external account (§3 Stage 0, Adam decision #6). */
  ownedByMe: boolean;
  /** capabilities.canDownload — false ⇒ status 'share-required'. */
  canDownload: boolean;
}

export interface DriveClient {
  /** All non-trashed children of a folder (paging handled internally). */
  listChildren(folderId: string): Promise<DriveFileMeta[]>;
  /** First `length` bytes via a Range request (format sniffing, §8). */
  downloadRange(fileId: string, length: number): Promise<Uint8Array>;
  download(fileId: string): Promise<Buffer>;
}

export interface ShellResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ShellRunner {
  run(cmd: string, args: string[], opts: { timeoutMs: number }): Promise<ShellResult>;
}

export interface EmbeddingClient {
  /** Batched multi-instance predict (§3 Stage 6 — not one-text-per-call). */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/* ------------------------------------------------------------------ */
/* Anthropic Message Batches                                          */
/* ------------------------------------------------------------------ */

export type BatchModel = 'haiku' | 'sonnet' | 'opus';

export interface BatchTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface BatchRequest {
  customId: string;
  model: BatchModel;
  maxTokens: number;
  system: string;
  userText: string;
  /** Forced tool use (wills-classifier pattern) — structured JSON out. */
  tool?: BatchTool;
}

export interface BatchUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface BatchResultItem {
  customId: string;
  ok: boolean;
  /** tool_use input when a tool was forced and the call succeeded. */
  toolInput: DocData | undefined;
  /** Concatenated text blocks (for prose responses like trigger cards). */
  text: string | undefined;
  usage: BatchUsage | undefined;
  error: string | undefined;
}

export interface BatchClient {
  /**
   * Submit a batch; the batchId is persisted to the run ledger under
   * `batches.{name}` before returning (crash-resumable).
   */
  submitBatch(name: string, requests: BatchRequest[]): Promise<string>;
  /**
   * Poll until the batch ends, stream results, and charge spend per request
   * transactionally against clause_mining_state/control. Throws
   * SpendBreakerError as soon as the breaker trips (hard stop).
   */
  pollBatch(batchId: string): Promise<BatchResultItem[]>;
}
