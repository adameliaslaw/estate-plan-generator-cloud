/**
 * Stage 3 — Fact extraction + gazetteer (§3 Stage 3): sonnet batch per trust
 * doc, BEFORE normalization (the gazetteer needs the names). Forced tool use
 * against the shared fact vocabulary (src/facts-vocabulary.ts) and the
 * wills-schema controlled vocabularies (TRUST_STRUCTURES values).
 *
 * The few-shot examples below are REAL examples written for this pipeline
 * (dummy JOHN DOE / MARY ROE families only) — replacing the placeholder
 * few-shots the design flagged as prerequisite P0.2 (wills-extractor.ts:10).
 *
 * Output per doc → firms/{firmId}/clauseMining/{runId}/docFacts/{driveFileId}
 * — a functions-only workspace collection that DOES contain names; never
 * read by the recommender or UI (§3).
 */

import { docFactsPath, filesCollection, runLedgerPath, textPath } from '../paths.js';
import { sanitizeFactVector, type FactVector } from '../facts-vocabulary.js';
import { extractVersionLabel } from '../counting-units.js';
import { isPilotDoc } from './triage.js';
import type { Env } from '../env.js';
import type {
  BatchClient,
  BatchRequest,
  BlobStore,
  DocData,
  DocStore,
} from '../clients/interfaces.js';

/** Gazetteer roles (normalize.ts consumes these as placeholder bases). */
export const PARTY_ROLES = [
  'GRANTOR_NAME',
  'SPOUSE_NAME',
  'TRUSTEE_1',
  'TRUSTEE_2',
  'SUCCESSOR_TRUSTEE_1',
  'SUCCESSOR_TRUSTEE_2',
  'CHILD_1',
  'CHILD_2',
  'CHILD_3',
  'CHILD_4',
  'BENEFICIARY_1',
  'BENEFICIARY_2',
  'GUARDIAN_1',
  'WITNESS_1',
  'WITNESS_2',
] as const;

export const EXTRACTION_TOOL = {
  name: 'extract_trust_facts',
  description: 'Extract parties, execution date, fact vector, and version label from a trust document.',
  input_schema: {
    type: 'object' as const,
    properties: {
      parties: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: PARTY_ROLES as unknown as string[] },
            names: {
              type: 'array',
              items: { type: 'string' },
              description: 'All surface forms of this party seen in the text (full name, name with middle initial, etc.).',
            },
          },
          required: ['role', 'names'],
        },
      },
      executionDate: {
        type: ['string', 'null'],
        description: 'Execution date FROM THE DOCUMENT TEXT as YYYY-MM-DD, or null when the date line is blank (drafts). Never infer from file metadata.',
      },
      facts: {
        type: 'object',
        properties: {
          married: { type: 'string', enum: ['true', 'false', 'unknown'] },
          childCountBand: { type: 'string', enum: ['0', '1', '2', '3+', 'unknown'] },
          hasMinorChildren: { type: 'string', enum: ['true', 'false', 'unknown'] },
          blendedFamily: { type: 'string', enum: ['true', 'false', 'unknown'] },
          specialNeedsBeneficiary: { type: 'string', enum: ['true', 'false', 'unknown'] },
          charitableBeneficiary: { type: 'string', enum: ['true', 'false', 'unknown'] },
          businessInterests: { type: 'string', enum: ['true', 'false', 'unknown'] },
          outOfStateRealProperty: { type: 'string', enum: ['true', 'false', 'unknown'] },
          trustStructures: {
            type: 'array',
            items: { type: 'string' },
            description: 'Values from: QTIP, Spendthrift, GST, Bypass, Credit-Shelter, Special-Needs, Marital-Deduction, Generation-Skipping, Charitable-Remainder, Pour-Over, Testamentary, Inter-Vivos-Reference, ILIT, IDGT, Other',
          },
          distributionStandard: {
            type: 'string',
            enum: ['HEMS', 'Ascertainable', 'Discretionary', 'Mandatory', 'Hybrid', 'Other', 'unknown'],
          },
          fundedStatus: { type: 'string', enum: ['funded', 'unfunded', 'unknown'] },
          estateSizeBand: {
            type: 'string',
            enum: ['<1M', '1M-5M', '5M-13.6M', '>13.6M', 'unknown'],
            description: 'PROVISIONAL — only when Schedule A carries real values; conventional "$10 and other property" schedules are unknown.',
          },
        },
        required: [
          'married', 'childCountBand', 'hasMinorChildren', 'blendedFamily',
          'specialNeedsBeneficiary', 'charitableBeneficiary', 'businessInterests',
          'outOfStateRealProperty', 'trustStructures', 'distributionStandard',
          'fundedStatus', 'estateSizeBand',
        ],
      },
      versionLabel: {
        type: ['string', 'null'],
        description: "From the document text/title: 'executed' | 'final' | 'signed' | 'draft' | 'v2' … or null.",
      },
    },
    required: ['parties', 'executionDate', 'facts', 'versionLabel'],
  },
};

/* ------------------------------------------------------------------ */
/* Few-shot examples (P0.2 replacement) — dummy names only.           */
/* ------------------------------------------------------------------ */

interface FewShot {
  label: string;
  excerpt: string;
  output: string;
}

const FEW_SHOTS: FewShot[] = [
  {
    label: 'Example 1 — married couple, two minor children, joint revocable trust',
    excerpt: `THE JOHN DOE AND MARY DOE REVOCABLE LIVING TRUST

DECLARATION OF TRUST made this 14th day of March, 2019, by JOHN DOE and MARY DOE, husband and wife, of the County of Monmouth, State of New Jersey (the "Grantors"), and JOHN DOE and MARY DOE, as initial Co-Trustees.

ARTICLE I — FAMILY. The Grantors are married to each other. The Grantors have two (2) children now living: EMILY DOE, born June 2, 2011, and JACOB DOE, born September 19, 2014. All references to "the Grantors' children" include the foregoing and any children hereafter born to or adopted by the Grantors.

ARTICLE IV — SUCCESSOR TRUSTEES. If both Grantors fail or cease to serve as Trustee, RICHARD ROE shall serve as sole successor Trustee, and if RICHARD ROE is unable or unwilling to serve, SUSAN ROE shall serve.

ARTICLE VII — DISTRIBUTIONS. Until each child attains the age of twenty-five (25) years, the Trustee shall distribute to or for the benefit of such child so much of the net income and principal as the Trustee deems necessary for the child's health, education, maintenance and support. Each trust share shall be protected by the spendthrift provisions of Article X.

SCHEDULE A: Ten dollars ($10.00) and such other property as may hereafter be conveyed.`,
    output: JSON.stringify({
      parties: [
        { role: 'GRANTOR_NAME', names: ['JOHN DOE', 'John Doe'] },
        { role: 'SPOUSE_NAME', names: ['MARY DOE', 'Mary Doe'] },
        { role: 'TRUSTEE_1', names: ['JOHN DOE'] },
        { role: 'TRUSTEE_2', names: ['MARY DOE'] },
        { role: 'SUCCESSOR_TRUSTEE_1', names: ['RICHARD ROE'] },
        { role: 'SUCCESSOR_TRUSTEE_2', names: ['SUSAN ROE'] },
        { role: 'CHILD_1', names: ['EMILY DOE'] },
        { role: 'CHILD_2', names: ['JACOB DOE'] },
      ],
      executionDate: '2019-03-14',
      facts: {
        married: 'true',
        childCountBand: '2',
        hasMinorChildren: 'true',
        blendedFamily: 'unknown',
        specialNeedsBeneficiary: 'false',
        charitableBeneficiary: 'false',
        businessInterests: 'unknown',
        outOfStateRealProperty: 'unknown',
        trustStructures: ['Spendthrift'],
        distributionStandard: 'HEMS',
        fundedStatus: 'unfunded',
        estateSizeBand: 'unknown',
      },
      versionLabel: null,
    }),
  },
  {
    label: 'Example 2 — single grantor, first amendment to an existing trust',
    excerpt: `FIRST AMENDMENT TO THE MARY ROE LIVING TRUST

THIS FIRST AMENDMENT is made this ____ day of ________, 20__, by MARY ROE, of Ocean County, New Jersey, as Grantor and as Trustee of THE MARY ROE LIVING TRUST dated August 3, 2007.

RECITALS. Under Article XI of the Trust, the Grantor reserved the right to amend the Trust in whole or in part by written instrument delivered to the Trustee. The Grantor is unmarried and has one (1) adult child, PETER ROE.

NOW, THEREFORE, the Grantor amends the Trust as follows:

1. Article V, Section 5.2 is deleted in its entirety and replaced with the following: "Upon the Grantor's death, the Trustee shall distribute the sum of Twenty-Five Thousand Dollars ($25,000.00) to ST. ANNE'S PARISH FOOD PANTRY, if it is then in existence, and the remainder of the trust estate, outright and free of trust, to the Grantor's son, PETER ROE, per stirpes."

2. In all other respects the Trust as heretofore executed is ratified and confirmed.`,
    output: JSON.stringify({
      parties: [
        { role: 'GRANTOR_NAME', names: ['MARY ROE'] },
        { role: 'TRUSTEE_1', names: ['MARY ROE'] },
        { role: 'CHILD_1', names: ['PETER ROE'] },
        { role: 'BENEFICIARY_1', names: ["ST. ANNE'S PARISH FOOD PANTRY"] },
      ],
      executionDate: null,
      facts: {
        married: 'false',
        childCountBand: '1',
        hasMinorChildren: 'false',
        blendedFamily: 'false',
        specialNeedsBeneficiary: 'false',
        charitableBeneficiary: 'true',
        businessInterests: 'unknown',
        outOfStateRealProperty: 'unknown',
        trustStructures: [],
        distributionStandard: 'Mandatory',
        fundedStatus: 'unknown',
        estateSizeBand: 'unknown',
      },
      versionLabel: 'draft',
    }),
  },
  {
    label: 'Example 3 — blended family, amended and restated trust',
    excerpt: `AMENDED AND RESTATED DECLARATION OF TRUST OF THE JOHN SMITH FAMILY TRUST

This Amended and Restated Declaration of Trust is made the 2nd day of October, 2021, by JOHN SMITH, of Middlesex County, New Jersey ("Grantor"), amending and restating in its entirety the Declaration of Trust dated May 11, 2009.

ARTICLE II — FAMILY. The Grantor is married to JANE SMITH. The Grantor has three (3) children: ROBERT SMITH and LAURA SMITH, children of the Grantor's prior marriage, and TYLER SMITH, a child of the Grantor's present marriage. TYLER SMITH is a minor.

ARTICLE VI — MARITAL AND FAMILY SHARES. Upon the Grantor's death the Trustee shall divide the trust estate into a Marital Share qualifying for the federal estate tax marital deduction under a QTIP election, and a Family Share to be held for the Grantor's children in equal shares. The Trustee may distribute income and principal of a child's share in the Trustee's sole and absolute discretion. The Grantor's interest in SMITH HARDWARE, LLC, a New Jersey limited liability company, shall be allocated to the Family Share. The Grantor's condominium located in Naples, Florida shall be held in the Marital Share.

ARTICLE IX — SUCCESSOR TRUSTEE. Upon the Grantor's incapacity or death, FIRST FIDELITY TRUST COMPANY shall serve as Trustee.`,
    output: JSON.stringify({
      parties: [
        { role: 'GRANTOR_NAME', names: ['JOHN SMITH'] },
        { role: 'SPOUSE_NAME', names: ['JANE SMITH'] },
        { role: 'CHILD_1', names: ['ROBERT SMITH'] },
        { role: 'CHILD_2', names: ['LAURA SMITH'] },
        { role: 'CHILD_3', names: ['TYLER SMITH'] },
        { role: 'SUCCESSOR_TRUSTEE_1', names: ['FIRST FIDELITY TRUST COMPANY'] },
      ],
      executionDate: '2021-10-02',
      facts: {
        married: 'true',
        childCountBand: '3+',
        hasMinorChildren: 'true',
        blendedFamily: 'true',
        specialNeedsBeneficiary: 'false',
        charitableBeneficiary: 'false',
        businessInterests: 'true',
        outOfStateRealProperty: 'true',
        trustStructures: ['QTIP', 'Marital-Deduction'],
        distributionStandard: 'Discretionary',
        fundedStatus: 'unknown',
        estateSizeBand: 'unknown',
      },
      versionLabel: null,
    }),
  },
];

export function extractionSystemPrompt(): string {
  const shots = FEW_SHOTS.map(
    (s) => `${s.label}\n---INPUT---\n${s.excerpt}\n---OUTPUT---\n${s.output}`,
  ).join('\n\n');
  return [
    'You extract structured facts from trust documents for a mining pipeline (NOT the live drafting pipeline).',
    'Report parties with EVERY surface form of each name you see — the list becomes a redaction gazetteer, so missing a form leaks a name.',
    'Execution dates come from the document TEXT only (Drive dates are meaningless — files were bulk-migrated). Blank date lines ⇒ null.',
    'Facts follow the controlled vocabulary exactly; when the document does not answer a fact, use "unknown" — never guess.',
    'estateSizeBand is provisional: only report a band when Schedule A lists real values.',
    '',
    'Worked examples:',
    '',
    shots,
  ].join('\n');
}

export interface ExtractedFacts {
  parties: Array<{ role: string; names: string[] }>;
  executionDate: string | null;
  facts: FactVector;
  versionLabel: string | null;
}

export function parseExtraction(toolInput: DocData | undefined): ExtractedFacts {
  const partiesRaw = Array.isArray(toolInput?.parties) ? toolInput.parties : [];
  const parties: Array<{ role: string; names: string[] }> = [];
  for (const p of partiesRaw as Array<Record<string, unknown>>) {
    if (typeof p.role !== 'string') continue;
    const names = Array.isArray(p.names)
      ? p.names.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      : [];
    if (names.length > 0) parties.push({ role: p.role, names });
  }
  const executionDate =
    typeof toolInput?.executionDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(toolInput.executionDate)
      ? toolInput.executionDate
      : null;
  const versionLabel = typeof toolInput?.versionLabel === 'string' ? toolInput.versionLabel : null;
  return {
    parties,
    executionDate,
    facts: sanitizeFactVector((toolInput?.facts ?? {}) as Record<string, unknown>),
    versionLabel,
  };
}

export function buildExtractionRequest(driveFileId: string, text: string): BatchRequest {
  return {
    customId: `extract:${driveFileId}`,
    model: 'sonnet',
    maxTokens: 2048,
    system: extractionSystemPrompt(),
    userText: text.slice(0, 60_000),
    tool: EXTRACTION_TOOL,
  };
}

export interface ExtractDeps {
  store: DocStore;
  blobs: BlobStore;
  batches: BatchClient;
}

export interface ExtractSummary {
  submitted: number;
  extracted: number;
  failed: number;
  skipped: number;
}

export async function runExtract(deps: ExtractDeps, env: Env): Promise<ExtractSummary> {
  const rows = await deps.store.listDocs(filesCollection(env.firmId, env.runId));
  const doneIds = new Set(await deps.store.listIds(`${runLedgerPath(env.firmId, env.runId)}/docFacts`));
  const pending = rows.filter(
    (r) => r.data.status === 'converted' && isPilotDoc(r.data) && !doneIds.has(r.id),
  );
  const summary: ExtractSummary = {
    submitted: 0,
    extracted: 0,
    failed: 0,
    skipped: rows.length - pending.length,
  };
  if (pending.length === 0) return summary;

  // Resume (§3): same shape as triage — a prior execution may have submitted
  // the batch and outlived its launcher before applying results. Re-poll the
  // ledgered batch first; resubmitting the same trusts would double-bill the
  // most expensive per-document stage in the pilot.
  const ledger = await deps.store.get(runLedgerPath(env.firmId, env.runId));
  const priorBatchId = (ledger?.batches as Record<string, string> | undefined)?.extract;
  if (priorBatchId !== undefined) {
    const priorResults = await deps.batches.pollBatch(priorBatchId);
    const covered = new Set<string>();
    const rowByIdPrior = new Map(rows.map((r) => [r.id, r.data]));
    for (const result of priorResults) {
      covered.add(result.customId.replace(/^extract:/, ''));
      await applyExtractResult(deps, env, summary, rowByIdPrior, result);
    }
    const stillPending = pending.filter((r) => !covered.has(r.id));
    summary.skipped += pending.length - stillPending.length;
    pending.length = 0;
    pending.push(...stillPending);
    if (pending.length === 0) {
      await writeExtractLedger(deps, env, summary);
      return summary;
    }
  }

  const requests: BatchRequest[] = [];
  for (const row of pending) {
    const text = (await deps.blobs.read(textPath(env.firmId, row.id))).toString('utf8');
    requests.push(buildExtractionRequest(row.id, text));
  }
  summary.submitted = requests.length;

  const batchId = await deps.batches.submitBatch('extract', requests);
  const results = await deps.batches.pollBatch(batchId);

  const rowById = new Map(rows.map((r) => [r.id, r.data]));
  for (const result of results) {
    await applyExtractResult(deps, env, summary, rowById, result);
  }

  await writeExtractLedger(deps, env, summary);
  return summary;
}

async function applyExtractResult(
  deps: ExtractDeps,
  env: Env,
  summary: ExtractSummary,
  rowById: Map<string, DocData>,
  result: { customId: string; ok: boolean; toolInput: DocData | undefined; error?: string },
): Promise<void> {
  const driveFileId = result.customId.replace(/^extract:/, '');
  if (!result.ok) {
    summary.failed++;
    await deps.store.set(docFactsPath(env.firmId, env.runId, driveFileId), {
      status: 'error',
      error: result.error ?? 'unknown',
    });
    return;
  }
  const parsed = parseExtraction(result.toolInput);
  // Deterministic version-label fallback from path + filename
  // (wills-processor._extractVersionLabel convention).
  const row = rowById.get(driveFileId) ?? {};
  const pathLabel = extractVersionLabel(
    `${typeof row.drivePath === 'string' ? row.drivePath : ''} ${typeof row.fileName === 'string' ? row.fileName : ''}`,
  );
  summary.extracted++;
  await deps.store.set(docFactsPath(env.firmId, env.runId, driveFileId), {
    status: 'extracted',
    parties: parsed.parties,
    executionDate: parsed.executionDate,
    facts: parsed.facts as unknown as DocData,
    versionLabel: parsed.versionLabel ?? pathLabel,
    updatedAt: new Date().toISOString(),
  });
}

async function writeExtractLedger(deps: ExtractDeps, env: Env, summary: ExtractSummary): Promise<void> {
  await deps.store.set(runLedgerPath(env.firmId, env.runId), {
    stage: 'extract',
    status: 'completed',
    extract: { ...summary },
    updatedAt: new Date().toISOString(),
  });
}
