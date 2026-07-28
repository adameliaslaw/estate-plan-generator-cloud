/**
 * tests/emulator/docx-package-fill.test.ts
 *
 * High-fidelity package fill against live Firestore + Storage emulators:
 * mapping load (tenant-boundary filtering), per-spouse fill via the real
 * Storage download path, deterministic docIds, generationMode provenance,
 * and consistency/unresolved-placeholder warnings on the saved document.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { admin, uniq } from './_emulator';
import PizZip from '../../functions/node_modules/pizzip';
import {
  DOCX_TEMPLATE_MAP_COLLECTION,
  fillDocxForEntry,
  loadDocxTemplateMap,
} from '../../functions/src/docx-package-fill';

const FIRM_ID = uniq('hf-firm');
const CLIENT_ID = uniq('hf-client');
const TEMPLATE_PATH = `firms/${FIRM_ID}/templates/will.docx`;

// ── Minimal real .docx fixture (same construction as docx-fidelity.test.ts) ──

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

function buildFixtureDocx(bodyText: string): Buffer {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t xml:space="preserve">${bodyText}</w:t></w:r></w:p></w:body>
</w:document>`;
  const zip = new PizZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/document.xml', documentXml);
  return zip.generate({ type: 'nodebuffer' }) as Buffer;
}

function extractDocumentXml(docx: Buffer): string {
  const zip = new PizZip(docx);
  return zip.file('word/document.xml')!.asText();
}

// ── Seed ─────────────────────────────────────────────────────────────────────

async function seed(): Promise<void> {
  const db = admin.firestore();
  await db.doc(`firms/${FIRM_ID}`).set({
    name: 'HF Test Firm', state: 'NJ', attorneyName: 'Adam Elias',
    createdAt: admin.firestore.Timestamp.now(),
  });
  await db.doc(`firms/${FIRM_ID}/clients/${CLIENT_ID}`).set({
    firmId: FIRM_ID,
    isActive: true,
    personalInfo: {
      firstName: 'Karen', lastName: 'Carter', gender: 'Female',
      maritalStatus: 'Married', address: '12 Main St', city: 'Haddonfield',
      state: 'NJ', zip: '08033', county: 'Camden',
    },
    spouseInfo: { firstName: 'Adam', lastName: 'Carter' },
    children: [],
    fiduciaries: {
      executor: { primary: { name: 'Beth Smith', relationship: 'Sister' } },
    },
  });
  await db
    .doc(`firms/${FIRM_ID}/${DOCX_TEMPLATE_MAP_COLLECTION}/will`)
    .set({ templateStoragePath: TEMPLATE_PATH, templateFileName: 'will.docx' });
  // Invalid mappings must be ignored by the loader, not filled.
  await db
    .doc(`firms/${FIRM_ID}/${DOCX_TEMPLATE_MAP_COLLECTION}/poa`)
    .set({ templateStoragePath: 'firms/OTHER-FIRM/templates/poa.docx' });
  await db
    .doc(`firms/${FIRM_ID}/${DOCX_TEMPLATE_MAP_COLLECTION}/trust`)
    .set({ templateStoragePath: `firms/${FIRM_ID}/templates/trust.pdf` });

  const fixture = buildFixtureDocx(
    'I, {{clientFullName}}, married to {{spouseFullName}}, appoint {{executorName}} as Executor. {{unmappedTag}}',
  );
  await admin.storage().bucket().file(TEMPLATE_PATH).save(fixture, {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('docx-package-fill (emulator)', () => {
  beforeAll(seed);

  it('loadDocxTemplateMap keeps only firm-scoped .docx mappings', async () => {
    const map = await loadDocxTemplateMap(FIRM_ID);
    expect([...map.keys()]).toEqual(['will']); // poa (other firm) + trust (.pdf) dropped
    expect(map.get('will')?.templateStoragePath).toBe(TEMPLATE_PATH);
  });

  it('fills the mapped template for the primary client and saves to the vault', async () => {
    const map = await loadDocxTemplateMap(FIRM_ID);
    const result = await fillDocxForEntry({
      firmId: FIRM_ID,
      clientId: CLIENT_ID,
      docType: 'will',
      mapping: map.get('will')!,
      createdBy: 'attorney-1',
    });

    expect(result.docId).toBe('will');
    expect(result.status).toBe('draft');
    expect(result.title).toContain('Karen Carter');
    // Unresolved placeholder is reported, not fatal.
    expect(result.warnings?.join(' ')).toContain('{{unmappedTag}}');

    const docSnap = await admin.firestore()
      .doc(`firms/${FIRM_ID}/clients/${CLIENT_ID}/documents/will`).get();
    expect(docSnap.exists).toBe(true);
    const data = docSnap.data()!;
    expect(data.generationMode).toBe('high-fidelity');
    expect(data.warnings.join(' ')).toContain('unresolved-placeholder');

    // The stored binary is the filled firm template.
    expect(data.storagePath).toBeTruthy();
    const [bytes] = await admin.storage().bucket().file(data.storagePath).download();
    const xml = extractDocumentXml(bytes);
    expect(xml).toContain('I, Karen Carter, married to Adam Carter');
    expect(xml).toContain('appoint Beth Smith as Executor');
    expect(xml).not.toContain('{{clientFullName}}');
  });

  it('generates the spouse variant via the extracted spouse swap', async () => {
    const map = await loadDocxTemplateMap(FIRM_ID);
    const result = await fillDocxForEntry({
      firmId: FIRM_ID,
      clientId: CLIENT_ID,
      docType: 'will',
      spouseRole: 'spouse',
      mapping: map.get('will')!,
      createdBy: 'attorney-1',
    });

    expect(result.docId).toBe('will_spouse');
    expect(result.title).toContain('Adam Carter');

    const docSnap = await admin.firestore()
      .doc(`firms/${FIRM_ID}/clients/${CLIENT_ID}/documents/will_spouse`).get();
    const [bytes] = await admin.storage().bucket().file(docSnap.data()!.storagePath).download();
    const xml = extractDocumentXml(bytes);
    // Testator and spouse swapped; household lastName backfilled.
    expect(xml).toContain('I, Adam Carter, married to Karen Carter');
  });

  it('fails loudly for a spouse entry when no spouse data is on file (R5-034)', async () => {
    const soloId = uniq('hf-solo');
    await admin.firestore().doc(`firms/${FIRM_ID}/clients/${soloId}`).set({
      firmId: FIRM_ID,
      personalInfo: { firstName: 'Solo', lastName: 'Person', maritalStatus: 'Single' },
    });
    const map = await loadDocxTemplateMap(FIRM_ID);
    await expect(fillDocxForEntry({
      firmId: FIRM_ID,
      clientId: soloId,
      docType: 'will',
      spouseRole: 'spouse',
      mapping: map.get('will')!,
      createdBy: 'attorney-1',
    })).rejects.toThrow(/no spouse information/i);
  });
});
