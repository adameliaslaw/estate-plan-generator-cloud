#!/usr/bin/env node
/**
 * scripts/ingest/src/ingest.ts
 *
 * Bulk ingestion CLI — reads every PDF and DOCX from a directory, chunks the
 * text, embeds each chunk with Voyage AI voyage-law-2, and upserts the vectors
 * to Pinecone under the specified namespace.
 *
 * Usage:
 *   npm run ingest -- --dir ./docs/reference --namespace reference
 *   npm run ingest -- --dir ./docs/work-product --namespace work-product
 *   npm run ingest -- --dir ./docs/client-files --namespace client-files
 *
 * Namespaces:  reference | work-product | client-files
 *
 * Prerequisites:
 *   1. Copy .env.example to .env and fill in your API keys.
 *   2. npm install
 *   3. Your Pinecone index must already exist, configured for 1024 dimensions
 *      (voyage-law-2 output size) with cosine metric.
 *
 * Re-ingesting a file is safe — vector IDs are deterministic so existing
 * chunks are overwritten rather than duplicated.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { Pinecone } from '@pinecone-database/pinecone';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CHUNK_SIZE    = 1500;  // characters per chunk
const CHUNK_OVERLAP = 150;   // overlap between adjacent chunks
const EMBED_BATCH   = 32;    // chunks per Voyage AI request
const UPSERT_BATCH  = 100;   // vectors per Pinecone upsert

const VALID_NAMESPACES = new Set(['reference', 'work-product', 'client-files']);

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

const pineconeKey  = process.env.PINECONE_API_KEY;
const indexName    = process.env.PINECONE_INDEX_NAME;
const voyageKey    = process.env.VOYAGE_API_KEY;

if (!pineconeKey || !indexName || !voyageKey) {
  console.error('Missing env vars. Copy .env.example to .env and fill in PINECONE_API_KEY, PINECONE_INDEX_NAME, VOYAGE_API_KEY.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------
async function extractPdf(filePath: string): Promise<string> {
  // Dynamic import — pdf-parse has a quirky CJS default export
  const { default: pdfParse } = await import('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);
  return result.text;
}

async function extractDocx(filePath: string): Promise<string> {
  const mammoth = await import('mammoth');
  const buffer = fs.readFileSync(filePath);
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf')  return extractPdf(filePath);
  if (ext === '.docx') return extractDocx(filePath);
  throw new Error(`Unsupported file type: ${ext}`);
}

// ---------------------------------------------------------------------------
// Chunking
// ---------------------------------------------------------------------------
function chunkText(text: string): string[] {
  const chunks: string[] = [];
  // Normalise whitespace
  const normalised = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  let start = 0;
  while (start < normalised.length) {
    const end = Math.min(start + CHUNK_SIZE, normalised.length);
    chunks.push(normalised.slice(start, end).trim());
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks.filter(c => c.length > 50); // drop tiny trailing fragments
}

// ---------------------------------------------------------------------------
// Voyage AI embedding
// ---------------------------------------------------------------------------
interface VoyageEmbedResponse {
  data: Array<{ embedding: number[] }>;
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${voyageKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'voyage-law-2',
      input: texts,
      input_type: 'document',
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Voyage AI ${response.status}: ${text}`);
  }
  const data = (await response.json()) as VoyageEmbedResponse;
  return data.data.map(d => d.embedding);
}

// ---------------------------------------------------------------------------
// Pinecone upsert
// ---------------------------------------------------------------------------
function safeId(filename: string, chunkIndex: number): string {
  return `${filename.replace(/[^a-zA-Z0-9-_]/g, '_')}-c${chunkIndex}`;
}

async function upsertVectors(
  index: ReturnType<Pinecone['index']>,
  ns: string,
  vectors: Array<{ id: string; values: number[]; metadata: Record<string, string | number> }>,
): Promise<void> {
  for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
    await index.namespace(ns).upsert({ records: vectors.slice(i, i + UPSERT_BATCH) });
  }
}

// ---------------------------------------------------------------------------
// Process a single file
// ---------------------------------------------------------------------------
async function processFile(
  filePath: string,
  ns: string,
  index: ReturnType<Pinecone['index']>,
): Promise<number> {
  const fileName = path.basename(filePath);
  console.log(`  → ${fileName}`);

  let text: string;
  try {
    text = await extractText(filePath);
  } catch (err) {
    console.warn(`    ⚠ Could not extract text: ${(err as Error).message}`);
    return 0;
  }

  if (!text.trim()) {
    console.warn('    ⚠ No text extracted — skipping');
    return 0;
  }

  const chunks = chunkText(text);
  console.log(`    ${chunks.length} chunks`);

  // Embed in batches
  const allEmbeddings: number[][] = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch = chunks.slice(i, i + EMBED_BATCH);
    const embeddings = await embedBatch(batch);
    allEmbeddings.push(...embeddings);
    process.stdout.write(`    embedded ${Math.min(i + EMBED_BATCH, chunks.length)}/${chunks.length}\r`);
  }
  console.log();

  // Build vector objects
  const vectors = chunks.map((chunk, i) => ({
    id: safeId(fileName, i),
    values: allEmbeddings[i],
    metadata: {
      text: chunk,
      source: fileName,
      namespace: ns,
      chunkIndex: i,
      totalChunks: chunks.length,
    },
  }));

  await upsertVectors(index, ns, vectors);
  console.log(`    ✓ upserted ${vectors.length} vectors`);
  return vectors.length;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\nEstate Plan Ingest`);
  console.log(`  directory : ${dir}`);
  console.log(`  namespace : ${namespace}`);
  console.log(`  index     : ${indexName}\n`);

  const files = fs
    .readdirSync(dir!)
    .filter(f => ['.pdf', '.docx'].includes(path.extname(f).toLowerCase()))
    .map(f => path.join(dir!, f));

  if (files.length === 0) {
    console.log('No PDF or DOCX files found in directory.');
    return;
  }

  console.log(`Found ${files.length} file(s):\n`);

  const pinecone = new Pinecone({ apiKey: pineconeKey! });
  const index = pinecone.index(indexName!);

  let totalChunks = 0;
  for (const filePath of files) {
    totalChunks += await processFile(filePath, namespace!, index);
  }

  console.log(`\n✅ Done — ${files.length} file(s), ${totalChunks} chunks upserted to namespace "${namespace}"\n`);
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
