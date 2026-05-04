#!/usr/bin/env ts-node
/**
 * scripts/seed-pageindex.ts
 *
 * One-time helper: register existing PageIndex doc IDs into Firestore so the
 * RAG Cloud Functions can discover them.  Use this if you already uploaded
 * documents to PageIndex outside the ingest CLI (e.g. via the PageIndex web
 * console) and need to backfill the Firestore registry.
 *
 * Usage:
 *   npx ts-node scripts/seed-pageindex.ts --input ./docs.json
 *
 * Input JSON file format (array of objects):
 *   [
 *     { "doc_id": "pi-xxxxx", "fileName": "nj-estates-act.pdf",   "namespace": "reference"    },
 *     { "doc_id": "pi-yyyyy", "fileName": "prior-will-memo.pdf",  "namespace": "work-product" },
 *     { "doc_id": "pi-zzzzz", "fileName": "smith-intake.pdf",     "namespace": "client-files" }
 *   ]
 *
 * Namespaces: reference | work-product | client-files
 *
 * Prerequisites:
 *   Set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file, or run
 *   inside a GCP environment with Application Default Credentials.
 *   Alternatively: FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 for the emulator.
 *
 *   Run from the repo root or from functions/ (firebase-admin must be reachable):
 *     cd functions && npx ts-node ../scripts/seed-pageindex.ts --input ../docs.json
 */

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
admin.initializeApp();

const db = admin.firestore();

const VALID_NAMESPACES = new Set(['reference', 'work-product', 'client-files']);

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const inputPath = getArg('--input');

if (!inputPath) {
  console.error('Usage: npx ts-node scripts/seed-pageindex.ts --input <path-to-docs.json>');
  console.error('\nThe JSON file should contain an array of:');
  console.error('  { "doc_id": string, "fileName": string, "namespace": "reference"|"work-product"|"client-files" }');
  process.exit(1);
}

const resolvedPath = path.resolve(inputPath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`Input file not found: ${resolvedPath}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DocEntry {
  doc_id: string;
  fileName: string;
  namespace: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
function validate(entries: unknown[]): DocEntry[] {
  const valid: DocEntry[] = [];
  const errors: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] as Record<string, unknown>;
    if (typeof e?.doc_id !== 'string' || !e.doc_id.trim()) {
      errors.push(`[${i}] missing or invalid "doc_id"`);
      continue;
    }
    if (typeof e?.fileName !== 'string' || !e.fileName.trim()) {
      errors.push(`[${i}] missing or invalid "fileName"`);
      continue;
    }
    if (typeof e?.namespace !== 'string' || !VALID_NAMESPACES.has(e.namespace)) {
      errors.push(`[${i}] invalid "namespace" — must be one of: ${[...VALID_NAMESPACES].join(', ')}`);
      continue;
    }
    valid.push({ doc_id: e.doc_id.trim(), fileName: e.fileName.trim(), namespace: e.namespace });
  }

  if (errors.length > 0) {
    console.error('\nValidation errors:');
    errors.forEach((e) => console.error(`  ${e}`));
    process.exit(1);
  }

  return valid;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const raw = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8')) as unknown;

  if (!Array.isArray(raw)) {
    console.error('Input JSON must be an array of document entries.');
    process.exit(1);
  }

  const entries = validate(raw as unknown[]);
  console.log(`\nPageIndex Firestore Seed`);
  console.log(`  input    : ${resolvedPath}`);
  console.log(`  entries  : ${entries.length}\n`);

  let written = 0;
  let skipped = 0;

  for (const entry of entries) {
    const ref = db
      .collection(`pageindex_docs/${entry.namespace}/files`)
      .doc(entry.doc_id);

    const snap = await ref.get();
    if (snap.exists) {
      console.log(`  skip  ${entry.fileName}  (already registered — doc_id: ${entry.doc_id})`);
      skipped++;
      continue;
    }

    await ref.set({
      doc_id: entry.doc_id,
      fileName: entry.fileName,
      namespace: entry.namespace,
      uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`  ✓ ${entry.namespace}/${entry.fileName}  →  ${entry.doc_id}`);
    written++;
  }

  console.log(`\n✅ Done — ${written} registered, ${skipped} already existed\n`);
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', (err as Error).message);
  process.exit(1);
});
