#!/usr/bin/env node
/**
 * scripts/ingest/src/ingest.ts
 *
 * Bulk ingestion CLI — uploads every PDF from a directory to PageIndex and
 * registers each document in Firestore so the RAG Cloud Functions can find it.
 *
 * Usage:
 *   npm run ingest -- --dir ./docs/reference      --namespace reference
 *   npm run ingest -- --dir ./docs/work-product   --namespace work-product
 *   npm run ingest -- --dir ./docs/client-files   --namespace client-files
 *
 * Namespaces: reference | work-product | client-files
 *
 * Prerequisites:
 *   1. Copy .env.example to .env and fill in PAGEINDEX_API_KEY.
 *   2. Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key, or run
 *      inside GCP with Application Default Credentials.
 *      For the emulator: set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
 *   3. npm install
 *
 * Re-uploading a file that is already registered in Firestore is safe — the
 * existing Firestore entry is preserved and PageIndex receives a fresh upload.
 * (PageIndex deduplications is handled server-side by doc_id.)
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const VALID_NAMESPACES = new Set(['reference', 'work-product', 'client-files']);
const PAGEINDEX_BASE   = 'https://api.pageindex.ai';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const dir       = getArg('--dir');
const namespace = getArg('--namespace');

if (!dir || !namespace) {
  console.error('Usage: npm run ingest -- --dir <path> --namespace <reference|work-product|client-files>');
  process.exit(1);
}
if (!VALID_NAMESPACES.has(namespace)) {
  console.error(`Invalid namespace "${namespace}". Must be one of: ${[...VALID_NAMESPACES].join(', ')}`);
  process.exit(1);
}
if (!fs.existsSync(dir)) {
  console.error(`Directory not found: ${dir}`);
  process.exit(1);
}

const pageIndexKey = process.env.PAGEINDEX_API_KEY;
if (!pageIndexKey) {
  console.error('Missing PAGEINDEX_API_KEY. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Firebase Admin
// ---------------------------------------------------------------------------
admin.initializeApp();
const db = admin.firestore();

// ---------------------------------------------------------------------------
// PageIndex upload
// ---------------------------------------------------------------------------
interface PageIndexDocResponse {
  doc_id: string;
}

async function uploadToPageIndex(filePath: string, fileName: string): Promise<string> {
  const fileBuffer = fs.readFileSync(filePath);
  const blob = new Blob([fileBuffer], { type: 'application/pdf' });

  const form = new FormData();
  form.append('file', blob, fileName);

  const response = await fetch(`${PAGEINDEX_BASE}/doc/`, {
    method: 'POST',
    headers: { api_key: pageIndexKey! },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`PageIndex upload ${response.status}: ${body}`);
  }

  const data = (await response.json()) as PageIndexDocResponse;
  if (!data.doc_id) throw new Error('PageIndex returned no doc_id');
  return data.doc_id;
}

// ---------------------------------------------------------------------------
// Firestore registration
// ---------------------------------------------------------------------------
async function registerInFirestore(
  docId: string,
  fileName: string,
  ns: string,
): Promise<void> {
  const ref = db.collection(`pageindex_docs/${ns}/files`).doc(docId);
  await ref.set({
    doc_id: docId,
    fileName,
    namespace: ns,
    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ---------------------------------------------------------------------------
// Process a single file
// ---------------------------------------------------------------------------
async function processFile(filePath: string, ns: string): Promise<boolean> {
  const fileName = path.basename(filePath);
  process.stdout.write(`  → ${fileName} … `);

  try {
    const docId = await uploadToPageIndex(filePath, fileName);
    await registerInFirestore(docId, fileName, ns);
    console.log(`✓  doc_id=${docId}`);
    return true;
  } catch (err) {
    console.log(`\n    ⚠ ${(err as Error).message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const files = fs
    .readdirSync(dir!)
    .filter((f) => path.extname(f).toLowerCase() === '.pdf')
    .map((f) => path.join(dir!, f));

  console.log(`\nPageIndex Bulk Ingest`);
  console.log(`  directory  : ${dir}`);
  console.log(`  namespace  : ${namespace}`);
  console.log(`  files      : ${files.length}\n`);

  if (files.length === 0) {
    console.log('No PDF files found in directory.');
    return;
  }

  let succeeded = 0;
  let failed    = 0;

  for (const filePath of files) {
    const ok = await processFile(filePath, namespace!);
    if (ok) succeeded++; else failed++;
  }

  console.log(`\n✅ Done — ${succeeded} uploaded, ${failed > 0 ? `${failed} failed` : '0 failed'}\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', (err as Error).message);
  process.exit(1);
});
