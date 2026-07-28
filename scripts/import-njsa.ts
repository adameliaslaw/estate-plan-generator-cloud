/**
 * scripts/import-njsa.ts
 *
 * Import the New Jersey Statutes into Firestore.
 *
 * Downloads the official bulk statute file published by the NJ Legislature
 * (refreshed every weekday), parses it into ~55k sections, and loads them
 * into the `njsaStatutes` collection via BulkWriter. Safe to re-run — each
 * run replaces the prior import and prunes repealed/renumbered sections.
 *
 * Usage:
 *   npx tsx scripts/import-njsa.ts                     # against production
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     GCLOUD_PROJECT=demo-eplan npx tsx scripts/import-njsa.ts   # emulator
 *
 * Optional: NJSA_ZIP_PATH=/path/to/STATUTES-TEXT.zip skips the download
 * (useful for CI and offline runs).
 */

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import {
  NJSA_DOWNLOAD_URL,
  importNjsaSections,
  parseNjsaStatutesText,
} from '../functions/src/njsa-statutes';

// Resolve the exact packages the functions code uses (root has neither), in a
// way that works under both ESM and CJS loaders.
const requireFromFunctions = createRequire(
  new URL('../functions/package.json', import.meta.url),
);
const admin = requireFromFunctions('firebase-admin') as typeof import('firebase-admin');
const JSZip = requireFromFunctions('jszip') as typeof import('jszip');

async function loadZipBytes(): Promise<Buffer> {
  const localPath = process.env.NJSA_ZIP_PATH;
  if (localPath) {
    console.log(`Reading local zip: ${localPath}`);
    return readFileSync(localPath);
  }
  console.log(`Downloading ${NJSA_DOWNLOAD_URL} ...`);
  const response = await fetch(NJSA_DOWNLOAD_URL, {
    signal: AbortSignal.timeout(300_000),
  });
  if (!response.ok) throw new Error(`Download failed (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function main(): Promise<void> {
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const zipBytes = await loadZipBytes();
  console.log(`Zip: ${(zipBytes.length / 1024 / 1024).toFixed(1)} MB`);

  const zip = await JSZip.loadAsync(zipBytes);
  const entry = zip.file(/statutes\.txt$/i)[0];
  if (!entry) throw new Error('STATUTES.TXT not found inside the zip.');

  // The source file is Windows-1252 (curly quotes, section marks) — decoding
  // as UTF-8 would corrupt those characters.
  const bytes = await entry.async('uint8array');
  const text = new TextDecoder('windows-1252').decode(bytes);

  const parsed = parseNjsaStatutesText(text);
  console.log(
    `Parsed ${parsed.sections.length} sections across ${parsed.titleCount} titles` +
      (parsed.updatedThrough ? ` (updated through ${parsed.updatedThrough})` : ''),
  );

  const started = Date.now();
  const meta = await importNjsaSections(parsed);
  console.log(
    `Imported ${meta.sectionCount} sections in ${((Date.now() - started) / 1000).toFixed(1)}s. ` +
      `Currency: ${meta.updatedThrough ?? 'unknown'}.`,
  );
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
