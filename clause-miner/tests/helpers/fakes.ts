/**
 * In-memory fakes for the narrow client interfaces (src/clients/interfaces.ts).
 * No GCP, no Anthropic, no network — constructor-injected into stage
 * orchestration under test.
 */

import type { Env } from '../../src/env.js';
import type {
  BatchClient,
  BatchRequest,
  BatchResultItem,
  BlobStore,
  DocData,
  DocStore,
  DriveClient,
  DriveFileMeta,
  EmbeddingClient,
  ShellResult,
  ShellRunner,
} from '../../src/clients/interfaces.js';

export class FakeDocStore implements DocStore {
  readonly docs = new Map<string, DocData>();

  async get(path: string): Promise<DocData | null> {
    return this.docs.get(path) ?? null;
  }

  async set(path: string, data: DocData, opts?: { merge?: boolean }): Promise<void> {
    const merge = opts?.merge ?? true;
    const current = merge ? (this.docs.get(path) ?? {}) : {};
    this.docs.set(path, { ...current, ...data });
  }

  async listDocs(collectionPath: string): Promise<Array<{ id: string; data: DocData }>> {
    const prefix = `${collectionPath}/`;
    const out: Array<{ id: string; data: DocData }> = [];
    for (const [path, data] of this.docs) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes('/')) {
        out.push({ id: path.slice(prefix.length), data });
      }
    }
    return out.sort((a, b) => a.id.localeCompare(b.id));
  }

  async listIds(collectionPath: string): Promise<string[]> {
    return (await this.listDocs(collectionPath)).map((d) => d.id);
  }

  async transact(path: string, fn: (current: DocData | null) => DocData): Promise<DocData> {
    const next = fn(this.docs.get(path) ?? null);
    const current = this.docs.get(path) ?? {};
    const merged = { ...current, ...next };
    this.docs.set(path, merged);
    return next;
  }
}

export class FakeBlobStore implements BlobStore {
  readonly blobs = new Map<string, Buffer>();

  async write(path: string, data: Buffer | string): Promise<void> {
    this.blobs.set(path, typeof data === 'string' ? Buffer.from(data, 'utf8') : data);
  }

  async read(path: string): Promise<Buffer> {
    const blob = this.blobs.get(path);
    if (blob === undefined) throw new Error(`blob not found: ${path}`);
    return blob;
  }

  async exists(path: string): Promise<boolean> {
    return this.blobs.has(path);
  }
}

export interface FakeDriveNode {
  meta: DriveFileMeta;
  /** Set for folders. */
  children?: FakeDriveNode[];
  bytes?: Buffer;
}

export function folder(id: string, name: string, children: FakeDriveNode[]): FakeDriveNode {
  return {
    meta: {
      id,
      name,
      mimeType: 'application/vnd.google-apps.folder',
      size: 0,
      md5Checksum: undefined,
      ownedByMe: true,
      canDownload: true,
    },
    children,
  };
}

export function file(
  id: string,
  name: string,
  opts: Partial<DriveFileMeta> & { bytes?: Buffer } = {},
): FakeDriveNode {
  const { bytes, ...meta } = opts;
  return {
    meta: {
      id,
      name,
      mimeType: meta.mimeType ?? 'application/octet-stream',
      size: meta.size ?? (bytes?.length ?? 0),
      md5Checksum: meta.md5Checksum,
      ownedByMe: meta.ownedByMe ?? true,
      canDownload: meta.canDownload ?? true,
    },
    bytes,
  };
}

export class FakeDrive implements DriveClient {
  private readonly byId = new Map<string, FakeDriveNode>();

  constructor(root: FakeDriveNode) {
    const walk = (node: FakeDriveNode): void => {
      this.byId.set(node.meta.id, node);
      for (const child of node.children ?? []) walk(child);
    };
    walk(root);
  }

  async listChildren(folderId: string): Promise<DriveFileMeta[]> {
    const node = this.byId.get(folderId);
    if (node === undefined || node.children === undefined) {
      throw new Error(`403 not a readable folder: ${folderId}`);
    }
    return node.children.map((c) => c.meta);
  }

  async downloadRange(fileId: string, length: number): Promise<Uint8Array> {
    const bytes = (await this.download(fileId)).subarray(0, length);
    return new Uint8Array(bytes);
  }

  async download(fileId: string): Promise<Buffer> {
    const node = this.byId.get(fileId);
    if (node?.bytes === undefined) throw new Error(`404 no content: ${fileId}`);
    return node.bytes;
  }
}

export class FakeShell implements ShellRunner {
  readonly calls: Array<{ cmd: string; args: string[] }> = [];

  constructor(
    private readonly handler: (cmd: string, args: string[]) => Promise<ShellResult> | ShellResult,
  ) {}

  async run(cmd: string, args: string[], _opts: { timeoutMs: number }): Promise<ShellResult> {
    this.calls.push({ cmd, args });
    return this.handler(cmd, args);
  }
}

export const shellOk: ShellResult = { code: 0, stdout: '', stderr: '', timedOut: false };
export const shellFail: ShellResult = { code: 1, stdout: '', stderr: 'boom', timedOut: false };

/**
 * FakeBatchClient answers each request via a per-request responder — the
 * batch mechanics (ids, polling) are exercised separately in
 * anthropic-batch.test.ts with a fake Anthropic SDK.
 */
export class FakeBatchClient implements BatchClient {
  readonly submitted: Array<{ name: string; requests: BatchRequest[] }> = [];
  private counter = 0;
  private readonly pending = new Map<string, BatchRequest[]>();

  constructor(
    private readonly responder: (req: BatchRequest) => Partial<BatchResultItem> | undefined,
  ) {}

  async submitBatch(name: string, requests: BatchRequest[]): Promise<string> {
    this.submitted.push({ name, requests });
    const id = `batch_${this.counter++}`;
    this.pending.set(id, requests);
    return id;
  }

  async pollBatch(batchId: string): Promise<BatchResultItem[]> {
    const requests = this.pending.get(batchId) ?? [];
    return requests.map((req) => {
      const partial = this.responder(req) ?? {};
      return {
        customId: req.customId,
        ok: partial.ok ?? true,
        toolInput: partial.toolInput,
        text: partial.text,
        usage: partial.usage ?? { inputTokens: 100, outputTokens: 50 },
        error: partial.error,
      };
    });
  }
}

export class FakeEmbeddings implements EmbeddingClient {
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Deterministic pseudo-embeddings: 8 dims from char-code sums so equal
    // texts embed identically and different texts differ.
    return texts.map((text) => {
      const out = new Array<number>(8).fill(0);
      for (let i = 0; i < text.length; i++) {
        out[i % 8] += text.charCodeAt(i) / 1000;
      }
      const norm = Math.sqrt(out.reduce((s, v) => s + v * v, 0)) || 1;
      return out.map((v) => v / norm);
    });
  }
}

/**
 * Env for stage tests. Overrides let a test opt into the curated-seed /
 * canary folders (§11 P1) without every other test having to know they exist.
 */
export function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    firmId: 'firm1',
    runId: 'run1',
    rootFolderId: 'root',
    gcsBucket: 'bucket',
    anthropicApiKey: undefined,
    sampleLimit: undefined,
    seedFolderIds: [],
    canaryFolderIds: [],
    ...overrides,
  };
}
