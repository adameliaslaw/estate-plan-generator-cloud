/**
 * Real client implementations: Firestore, Cloud Storage, Drive (ADC,
 * drive.readonly — same auth pattern as functions/src/wills-backfill.ts),
 * Vertex embeddings (text-embedding-005, 768-dim — same model/space as
 * functions/src/kb-embeddings.ts, but BATCHED multi-instance predicts per
 * §3 Stage 6), and a child_process shell runner for LibreOffice.
 *
 * Nothing in this file is imported by unit tests — tests use fakes behind
 * src/clients/interfaces.ts.
 */

import { spawn } from 'node:child_process';
import { FieldValue, Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { google } from 'googleapis';
import type {
  BlobStore,
  DocData,
  DocStore,
  DriveClient,
  DriveFileMeta,
  EmbeddingClient,
  FolderMatch,
  ShellResult,
  ShellRunner,
} from './interfaces.js';

/* ------------------------------------------------------------------ */
/* Firestore                                                          */
/* ------------------------------------------------------------------ */

function isVectorMarker(value: unknown): value is { __vector: number[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { __vector?: unknown }).__vector)
  );
}

/** Recursively convert {__vector: number[]} markers to FieldValue.vector(). */
function encodeVectors(value: unknown): unknown {
  if (isVectorMarker(value)) return FieldValue.vector(value.__vector);
  if (Array.isArray(value)) return value.map(encodeVectors);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = encodeVectors(v);
    }
    return out;
  }
  return value;
}

export class FirestoreDocStore implements DocStore {
  constructor(private readonly db: Firestore = new Firestore()) {}

  async get(path: string): Promise<DocData | null> {
    const snap = await this.db.doc(path).get();
    return snap.exists ? (snap.data() as DocData) : null;
  }

  async set(path: string, data: DocData, opts?: { merge?: boolean }): Promise<void> {
    await this.db
      .doc(path)
      .set(encodeVectors(data) as DocData, { merge: opts?.merge ?? true });
  }

  async listDocs(collectionPath: string): Promise<Array<{ id: string; data: DocData }>> {
    const snap = await this.db.collection(collectionPath).get();
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as DocData }));
  }

  async listIds(collectionPath: string): Promise<string[]> {
    const snap = await this.db.collection(collectionPath).select().get();
    return snap.docs.map((d) => d.id);
  }

  async count(collectionPath: string): Promise<number> {
    const snap = await this.db.collection(collectionPath).count().get();
    return snap.data().count;
  }

  async transact(path: string, fn: (current: DocData | null) => DocData): Promise<DocData> {
    return this.db.runTransaction(async (tx) => {
      const ref = this.db.doc(path);
      const snap = await tx.get(ref);
      const next = fn(snap.exists ? (snap.data() as DocData) : null);
      tx.set(ref, encodeVectors(next) as DocData, { merge: true });
      return next;
    });
  }
}

/* ------------------------------------------------------------------ */
/* Cloud Storage                                                      */
/* ------------------------------------------------------------------ */

export class GcsBlobStore implements BlobStore {
  private readonly bucket;

  constructor(bucketName: string, storage: Storage = new Storage()) {
    this.bucket = storage.bucket(bucketName);
  }

  async write(path: string, data: Buffer | string): Promise<void> {
    await this.bucket.file(path).save(data);
  }

  async read(path: string): Promise<Buffer> {
    const [contents] = await this.bucket.file(path).download();
    return contents;
  }

  async exists(path: string): Promise<boolean> {
    const [exists] = await this.bucket.file(path).exists();
    return exists;
  }
}

/* ------------------------------------------------------------------ */
/* Drive (ADC, drive.readonly — wills-backfill.ts pattern)            */
/* ------------------------------------------------------------------ */

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

export class GoogleDriveClient implements DriveClient {
  private readonly drive = google.drive({
    version: 'v3',
    auth: new google.auth.GoogleAuth({ scopes: DRIVE_SCOPES }),
  });

  async listChildren(folderId: string): Promise<DriveFileMeta[]> {
    const out: DriveFileMeta[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.drive.files.list({
        q: `"${folderId}" in parents and trashed = false`,
        fields:
          'nextPageToken,files(id,name,mimeType,size,md5Checksum,ownedByMe,capabilities/canDownload)',
        pageSize: 1000,
        ...(pageToken !== undefined ? { pageToken } : {}),
      });
      for (const f of res.data.files ?? []) {
        if (typeof f.id !== 'string') continue;
        out.push({
          id: f.id,
          name: f.name ?? f.id,
          mimeType: f.mimeType ?? 'application/octet-stream',
          size: parseInt(f.size ?? '0', 10),
          md5Checksum: f.md5Checksum ?? undefined,
          ownedByMe: f.ownedByMe !== false,
          canDownload: f.capabilities?.canDownload !== false,
        });
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken !== undefined);
    return out;
  }

  async downloadRange(fileId: string, length: number): Promise<Uint8Array> {
    const res = await this.drive.files.get(
      { fileId, alt: 'media' },
      {
        responseType: 'arraybuffer',
        headers: { Range: `bytes=0-${length - 1}` },
      },
    );
    return new Uint8Array(res.data as ArrayBuffer);
  }

  async download(fileId: string): Promise<Buffer> {
    const res = await this.drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data as ArrayBuffer);
  }

  /**
   * The service-account email this client authenticates as. Read from the
   * ADC credentials; on Cloud Run those come from the metadata server, which
   * reports the literal string 'default' rather than an address, so fall
   * back to asking the metadata server for the real email.
   */
  async identity(): Promise<string | null> {
    try {
      const auth = new google.auth.GoogleAuth({ scopes: DRIVE_SCOPES });
      const credentials = await auth.getCredentials();
      const email = credentials.client_email;
      if (typeof email === 'string' && email.includes('@')) return email;
    } catch {
      // fall through to the metadata server
    }
    try {
      const res = await fetch(
        'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email',
        { headers: { 'Metadata-Flavor': 'Google' } },
      );
      if (!res.ok) return null;
      const text = (await res.text()).trim();
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  async getFolder(folderId: string): Promise<{ id: string; name: string } | null> {
    try {
      const res = await this.drive.files.get({ fileId: folderId, fields: 'id,name' });
      const id = res.data.id;
      if (typeof id !== 'string') return null;
      return { id, name: res.data.name ?? id };
    } catch {
      // 404 for a folder that is not shared, 403 for one that is withheld —
      // both mean "this identity cannot see it".
      return null;
    }
  }

  async findFolders(name: string): Promise<FolderMatch[]> {
    // Escape single quotes for the Drive query language.
    const escaped = name.replace(/'/g, "\\'");
    const res = await this.drive.files.list({
      q:
        `name = '${escaped}' and ` +
        `mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id,name,parents)',
      pageSize: 100,
    });
    const out: FolderMatch[] = [];
    for (const f of res.data.files ?? []) {
      if (typeof f.id !== 'string') continue;
      const parentNames: string[] = [];
      for (const parentId of f.parents ?? []) {
        try {
          const parent = await this.drive.files.get({
            fileId: parentId,
            fields: 'name',
          });
          if (typeof parent.data.name === 'string') parentNames.push(parent.data.name);
        } catch {
          parentNames.push(`(unreadable parent ${parentId})`);
        }
      }
      out.push({ id: f.id, name: f.name ?? f.id, parentNames });
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Vertex embeddings — batched multi-instance predict                 */
/* ------------------------------------------------------------------ */

const VERTEX_LOCATION = 'us-central1';
const EMBEDDING_MODEL = 'text-embedding-005';
const EMBEDDING_DIMENSIONS = 768;
/** Instances per predict call — well under the model's per-request cap. */
const PREDICT_BATCH_SIZE = 25;

export class VertexEmbeddingClient implements EmbeddingClient {
  private readonly auth = new google.auth.GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  });

  async embedBatch(texts: string[]): Promise<number[][]> {
    const client = await this.auth.getClient();
    const projectId = await this.auth.getProjectId();
    const url =
      `https://${VERTEX_LOCATION}-aiplatform.googleapis.com/v1/projects/` +
      `${projectId}/locations/${VERTEX_LOCATION}/publishers/google/models/` +
      `${EMBEDDING_MODEL}:predict`;

    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += PREDICT_BATCH_SIZE) {
      const slice = texts.slice(i, i + PREDICT_BATCH_SIZE);
      const res = await client.request<{
        predictions?: Array<{ embeddings?: { values?: number[] } }>;
      }>({
        url,
        method: 'POST',
        data: {
          instances: slice.map((text) => ({
            task_type: 'RETRIEVAL_DOCUMENT',
            // Same 8000-char safety net as kb-embeddings.generateEmbedding.
            content: text.replace(/\s+/g, ' ').trim().slice(0, 8000),
          })),
          parameters: { outputDimensionality: EMBEDDING_DIMENSIONS },
        },
      });
      const predictions = res.data.predictions ?? [];
      if (predictions.length !== slice.length) {
        throw new Error(
          `Vertex returned ${predictions.length} embeddings for ${slice.length} inputs`,
        );
      }
      for (const p of predictions) {
        const values = p.embeddings?.values;
        if (values === undefined || values.length === 0) {
          throw new Error('Vertex AI returned empty embedding');
        }
        out.push(values);
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Shell runner (LibreOffice / antiword / wpd2text)                   */
/* ------------------------------------------------------------------ */

export class ChildProcessShellRunner implements ShellRunner {
  run(cmd: string, args: string[], opts: { timeoutMs: number }): Promise<ShellResult> {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);
      child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
      child.stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr: `${stderr}\n${err.message}`, timedOut });
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr, timedOut });
      });
    });
  }
}
