/**
 * functions/src/docx-fidelity.ts
 *
 * High-fidelity DOCX generation (v1) — the "high-fidelity" mode that was
 * planned but unimplemented: instead of rendering HTML and reconstructing a
 * .docx on export, this fills a firm's real binary .docx template in place,
 * preserving the original file's styles, numbering, headers/footers, and
 * layout exactly.
 *
 * Pipeline:
 *   1. Load the firm's .docx template bytes from Cloud Storage.
 *   2. Fill {{placeholders}} with docxtemplater (delimiters match the HBS
 *      convention used elsewhere), from a flat data map built off the same
 *      ClientContext the rest of the pipeline uses.
 *   3. Convert the filled .docx to HTML with mammoth for the in-app preview.
 *   4. Save through document-save-helper — the binary lands in the client
 *      vault (`.docx` in Storage) and the HTML preview in Firestore, so the
 *      document behaves like any other vault document.
 *
 * Unresolved placeholders never fail the run: they render blank, are
 * reported as warnings on the saved document, and are returned to the
 * caller — same philosophy as the template engine's missing-field marking.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import mammoth from 'mammoth';
import { assertFirmStaff } from './auth-guards';
import { aggregateClientContext, ClientContext } from './client-context-aggregator';
import { formatFullName } from './client-data-serializer';
import { checkClientFactConsistency, estimateTotalAssets } from './client-facts';
import { saveDocumentToVault } from './document-save-helper';
import { loadClauseCatalog } from './clause-loader';
import {
  selectClausesForDocument,
  buildClausePlaceholderValues,
  describeSelection,
} from './clause-selection';

// ---------------------------------------------------------------------------
// Core fill (pure — unit-testable without Firebase)
// ---------------------------------------------------------------------------

export interface FillDocxResult {
  buffer: Buffer;
  /** Placeholder tags that had no value and rendered blank. */
  missingTags: string[];
}

/**
 * Fill a binary .docx template's {{placeholders}} with the given data.
 * Never throws on missing tags — they render blank and are reported.
 */
export function fillDocxTemplate(
  templateBytes: Buffer,
  data: Record<string, unknown>,
): FillDocxResult {
  const missing = new Set<string>();
  const zip = new PizZip(templateBytes);
  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: (part: { value?: string }) => {
      if (part.value) missing.add(part.value);
      return '';
    },
  });
  doc.render(data);
  const buffer = doc
    .getZip()
    .generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
  return { buffer, missingTags: [...missing].sort() };
}

/**
 * Build the flat placeholder data map from ClientContext. Field names are
 * the documented contract for firm-authored .docx templates; extend here
 * (one place) rather than ad hoc.
 */
export function buildDocxTemplateData(
  ctx: ClientContext,
): Record<string, unknown> {
  const client = ctx.client;
  const pi = (client.personalInfo ?? {}) as Record<string, unknown>;
  const fiduciaries = (client.fiduciaries ?? {}) as Record<string, unknown>;
  const poa = (fiduciaries.powerOfAttorney ?? {}) as Record<string, unknown>;
  const executor = (fiduciaries.executor ?? {}) as Record<string, unknown>;
  const trustee = (fiduciaries.trustee ?? {}) as Record<string, unknown>;
  const guardian = (fiduciaries.guardian ?? {}) as Record<string, unknown>;
  // Guardians are collected by the questionnaire into TOP-LEVEL guardianPrimary
  // / guardianAlternate, not under fiduciaries.guardian — client-data-serializer
  // falls back the same way. Reading only the nested slot left {{guardianName}}
  // blank for every client whose guardian came through the questionnaire.
  const guardianPrimary = guardian.primary ?? client.guardianPrimary;
  const guardianAlternate = guardian.alternate ?? client.guardianAlternate;
  const guardianCo = guardian.coGuardian ?? client.guardianCoPrimary;
  const guardianCoAlternate = guardian.coAlternate ?? client.guardianCoAlternate;
  const healthcare = (fiduciaries.healthcareProxy ?? {}) as Record<string, unknown>;
  const funeral = (fiduciaries.funeralRepresentative ?? {}) as Record<string, unknown>;
  const person = (p: unknown): string =>
    formatFullName(p as Record<string, unknown> | null | undefined);

  /**
   * The relationship word a document uses as an appositive: "I appoint my
   * husband, NAME, to serve as Executor". Required on FiduciaryPerson, so a
   * template can render the phrase conditionally and drop it when a firm has
   * not captured one, rather than printing "I appoint my , NAME".
   *
   * Lowercased to match ctx.computed.*Title, which derives the same words for
   * the .hbs templates — same source field, same casing, so a document does
   * not read "my Husband" in one article and "my husband" in the next.
   */
  const relation = (p: unknown): string => {
    const rel = (p as Record<string, unknown> | null | undefined)?.relationship;
    return typeof rel === 'string' ? rel.trim().toLowerCase() : '';
  };

  /** "12 Vine Street, Camden, New Jersey" from a fiduciary's own address. */
  const address = (p: unknown): string => {
    const f = (p ?? {}) as Record<string, unknown>;
    return [f.address, f.city, f.state].map((v) => (v ?? '').toString().trim())
      .filter(Boolean)
      .join(', ');
  };

  const capitalize = (s: string): string =>
    s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

  const healthcarePrimary = healthcare.primary ?? healthcare.agent;

  return {
    // Client + spouse
    clientFullName: ctx.computed.clientFullName,
    spouseFullName: ctx.computed.spouseFullName,
    clientAddress: pi.address ?? '',
    clientCity: pi.city ?? '',
    clientCounty: pi.county ?? '',
    clientState: pi.state ?? 'NJ',
    clientZip: pi.zip ?? '',
    clientDob: pi.dob ?? '',
    maritalStatus: pi.maritalStatus ?? '',
    funeralWishes: client.funeralWishes ?? '',
    // Fiduciaries
    executorName: person(executor.primary),
    alternateExecutorName: person(executor.alternate),
    // Executor/PowerOfAttorney/HealthcareProxy each carry three levels
    // (primary, alternate, successor). The sample will appoints a fourth,
    // "Third Level Successor Executor"; the model has no such slot, so that
    // article stays suppressed rather than printing an appointment with no
    // appointee.
    secondAlternateExecutorName: person(executor.successor),
    trusteeName: person(trustee.primary),
    alternateTrusteeName: person(trustee.alternate),
    coTrusteeName: person(trustee.coTrustee),
    guardianName: person(guardianPrimary),
    alternateGuardianName: person(guardianAlternate),
    poaAgentName: person(poa.agent),
    poaAlternateAgentName: person(poa.alternateAgent),
    poaSecondAlternateAgentName: person(poa.successorAgent),
    healthcareAgentName: person(healthcarePrimary),
    healthcareAlternateAgentName: person(healthcare.alternateAgent),
    coGuardianName: person(guardianCo),
    coAlternateGuardianName: person(guardianCoAlternate),
    // N.J.S.A. 45:27-22 — a statutory appointment separate from the executor.
    funeralRepresentativeName: person(funeral.primary),
    successorFuneralRepresentativeName: person(funeral.alternate),
    // Relationship words. A template renders these as
    // {{#executorRelation}}my {{executorRelation}}, {{/executorRelation}}
    // so the phrase disappears rather than leaving a dangling "my ,".
    spouseRelation: ctx.computed.spouseTitle,
    spouseRelationCapitalized: capitalize(ctx.computed.spouseTitle),
    spousePronounObject: ctx.computed.spousePronouns?.object ?? 'them',
    executorRelation: relation(executor.primary),
    alternateExecutorRelation: relation(executor.alternate),
    trusteeRelation: relation(trustee.primary),
    alternateTrusteeRelation: relation(trustee.alternate),
    coTrusteeRelation: relation(trustee.coTrustee),
    guardianRelation: relation(guardianPrimary),
    alternateGuardianRelation: relation(guardianAlternate),
    poaAgentRelation: relation(poa.agent),
    poaAlternateAgentRelation: relation(poa.alternateAgent),
    healthcareAgentRelation: relation(healthcarePrimary),
    secondAlternateExecutorRelation: relation(executor.successor),
    poaSecondAlternateAgentRelation: relation(poa.successorAgent),
    healthcareAlternateAgentRelation: relation(healthcare.alternateAgent),
    coGuardianRelation: relation(guardianCo),
    coAlternateGuardianRelation: relation(guardianCoAlternate),
    funeralRepresentativeRelation: relation(funeral.primary),
    successorFuneralRepresentativeRelation: relation(funeral.alternate),
    // Fiduciaries' own addresses. The executor need not live with the client;
    // in the sample set the successor executor lives in another state.
    executorAddress: address(executor.primary),
    alternateExecutorAddress: address(executor.alternate),
    trusteeAddress: address(trustee.primary),
    guardianAddress: address(guardianPrimary),
    poaAgentAddress: address(poa.agent),
    poaAlternateAgentAddress: address(poa.alternateAgent),
    healthcareAgentAddress: address(healthcarePrimary),
    secondAlternateExecutorAddress: address(executor.successor),
    poaSecondAlternateAgentAddress: address(poa.successorAgent),
    healthcareAlternateAgentAddress: address(healthcare.alternateAgent),
    // Family
    childCount: ctx.computed.childCount,
    childrenNames: (Array.isArray(client.children) ? client.children : [])
      .map((c: Record<string, unknown>) => person(c))
      .filter(Boolean)
      .join(', '),
    hasMinorChildren: ctx.computed.hasMinorChildren,
    // Estate + firm + dates
    estimatedTotalAssets: estimateTotalAssets(client.assets),
    firmName: ctx.firm.name ?? '',
    attorneyName: ctx.firm.attorneyName ?? '',
    todayFormatted: ctx.computed.todayFormatted,
    todayISO: ctx.computed.todayISO,
  };
}

/**
 * The firm's approved clauses for this document, ready for a
 * {{#firmClauses}} region in the template.
 *
 * The clause library's only route into a document until now was
 * buildClausePromptBlock, which hands the text to a model and asks it not to
 * paraphrase — a request that module's own header calls out as the failure
 * mode that would make the whole exercise pointless. Placed through a
 * template region instead, the approved language reaches the page verbatim
 * with no model in the loop.
 *
 * Selection is the same call the generator makes, so a clause that is drafted
 * into an AI-generated will is the same clause, resolved from the same values,
 * that a high-fidelity .docx gets.
 *
 * Non-fatal by design, matching unified-generator: any failure here degrades
 * to filling the template without firm clauses, which is how every document
 * generated before today behaved.
 */
async function loadFirmClauses(
  firmId: string,
  ctx: ClientContext,
  docType: string | undefined,
): Promise<Array<{ title: string; text: string }>> {
  try {
    const entries = await loadClauseCatalog(firmId);
    if (entries.length === 0) return [];
    const selection = selectClausesForDocument({
      entries,
      docType: docType ?? 'custom',
      values: buildClausePlaceholderValues(buildDocxTemplateData(ctx)),
      state: (ctx.client?.personalInfo as Record<string, unknown> | undefined)
        ?.state as string | undefined,
    });
    console.log(
      `[generateHighFidelityDocx] Clause library (${docType ?? 'custom'}): ${describeSelection(selection)}`,
    );
    return selection.clauses.map((c) => ({ title: c.title, text: c.text }));
  } catch (err) {
    console.warn(
      '[generateHighFidelityDocx] Clause library injection failed (non-blocking):',
      err,
    );
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateHighFidelityDocx = onCall(
  {
    region: 'us-east1',
    memory: '1GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    const { firmId, clientId, templateStoragePath, docType, displayName } =
      request.data as {
        firmId?: string;
        clientId?: string;
        templateStoragePath?: string;
        docType?: string;
        displayName?: string;
      };
    if (!firmId || !clientId || !templateStoragePath) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required fields: firmId, clientId, templateStoragePath.',
      );
    }
    const caller = assertFirmStaff(request, firmId);

    // Tenant boundary on the template read: only this firm's storage tree.
    if (!templateStoragePath.startsWith(`firms/${firmId}/`)) {
      throw new HttpsError(
        'permission-denied',
        'templateStoragePath must be inside this firm\'s storage area.',
      );
    }
    if (!templateStoragePath.toLowerCase().endsWith('.docx')) {
      throw new HttpsError(
        'invalid-argument',
        'templateStoragePath must point to a .docx file.',
      );
    }

    const file = admin.storage().bucket().file(templateStoragePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError('not-found', `Template not found: ${templateStoragePath}`);
    }
    const [templateBytes] = await file.download();

    const ctx = await aggregateClientContext(firmId, clientId, docType);
    const data = {
      ...buildDocxTemplateData(ctx),
      firmClauses: await loadFirmClauses(firmId, ctx, docType),
    };

    let filled: FillDocxResult;
    try {
      filled = fillDocxTemplate(templateBytes, data);
    } catch (err) {
      throw new HttpsError(
        'failed-precondition',
        `Template could not be rendered: ${err instanceof Error ? err.message : 'unknown error'}. ` +
          'Check the template for malformed {{placeholders}}.',
      );
    }

    // HTML preview so the vault document renders in the existing editor.
    let previewHtml = '';
    try {
      const converted = await mammoth.convertToHtml({ buffer: filled.buffer });
      previewHtml = converted.value;
    } catch (convErr) {
      console.warn('[generateHighFidelityDocx] mammoth preview failed:', convErr);
    }

    // Same pre-generation consistency check the unified pipeline runs —
    // contradictory client facts surface on the saved document, not silently.
    const warnings = checkClientFactConsistency(ctx.client).map(
      (f) => `[${f.severity}] ${f.code}: ${f.message}`,
    );
    warnings.push(...filled.missingTags.map(
      (tag) => `[warning] unresolved-placeholder: {{${tag}}} rendered blank.`,
    ));

    const resolvedDocType = docType ?? 'custom';
    const saveResult = await saveDocumentToVault({
      firmId,
      clientId,
      docType: resolvedDocType,
      displayName:
        displayName ??
        `High-Fidelity ${resolvedDocType} — ${ctx.computed.clientFullName}`,
      content:
        previewHtml ||
        '<p>[Binary .docx document — preview conversion unavailable. Download the file to review.]</p>',
      binaryBuffer: filled.buffer,
      status: 'draft',
      createdBy: caller.uid,
      generationMode: 'high-fidelity',
      triggerSource: 'single',
      warnings: warnings.length > 0 ? warnings : undefined,
      changeNotes: `High-fidelity fill from ${templateStoragePath}`,
    });

    return {
      documentId: saveResult.docId,
      currentVersion: saveResult.currentVersion,
      storagePath: saveResult.storagePath ?? null,
      missingTags: filled.missingTags,
    };
  },
);
