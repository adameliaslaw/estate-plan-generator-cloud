/**
 * functions/src/clause-selection.ts
 *
 * Wires the clause catalog into document generation.
 *
 * Until now the catalog was a lookup table for humans: `ClauseLibraryDialog`
 * let an attorney insert a clause by hand while editing, and nothing in the
 * generation path read `firms/{firmId}/clauseCatalog` at all. The mining and
 * canonicalization work produced a form bank, not a drafting system.
 *
 * This module closes that gap. At generation time it selects the firm's
 * approved clauses for the document being drafted, resolves their placeholders
 * against the same client context the templates use, and hands them to the
 * generator as REQUIRED VERBATIM text — the same treatment the NJ apportionment
 * clause gets, and for the same reason: attorney-approved prose should displace
 * model-invented prose, and it can only do that if it arrives byte-exact.
 *
 * ---------------------------------------------------------------------------
 * THE DRAFTABILITY GATE
 *
 * A clause may be drafted with only when:
 *
 *     origin === 'manual'                               (attorney wrote it)
 *   OR (status === 'approved' AND piiScanStatus !== 'blocked')
 *
 * That is the identical rule `ClauseLibraryDialog` applies to decide what a
 * human may insert, and it is deliberately duplicated rather than loosened.
 * A `mined` clause has not been reviewed. A `blocked` clause failed the PII
 * scan, meaning its text plausibly contains a real client's name from the
 * source corpus — shipping it into a different client's will would be a
 * confidentiality breach, not a drafting error. Tombstones (`removed`) are
 * excluded by the same expression.
 *
 * ---------------------------------------------------------------------------
 * WHY FULLY-RESOLVED CLAUSES ONLY
 *
 * The picker leaves an unresolved `{{TAG}}` visible on purpose: the attorney is
 * sitting there and can see what still needs a value. Generation has no such
 * reader. An unresolved token reaching a generated document would (correctly)
 * trip the `unresolved-token` check in package-review.ts at HIGH severity, and
 * since several registry placeholders are 'attorney-supplied' by design
 * (CHILD, BENEFICIARY, WITNESS, NAME, SUPPLEMENTAL_NAME), injecting them would
 * manufacture a high-severity finding on nearly every document.
 *
 * So automated injection takes only clauses whose placeholders ALL resolve.
 * The rest are not dropped silently — `selectClausesForDocument` returns them
 * under `skipped` with the tokens that blocked each one, so the caller can log
 * it and the attorney knows there is approved language the picker can still
 * supply by hand. Automated path stays clean; manual path keeps its full reach.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The catalog fields this module needs. Mirrors ENTRY_FIELDS in clause-library.ts. */
export interface ClauseEntry {
  id: string;
  title?: string;
  functionSummary?: string;
  category?: string;
  canonicalText?: string;
  status?: string;
  origin?: string;
  state?: string;
  piiScanStatus?: string;
  /** Written by the catalog stage; not surfaced by the picker but present on the doc. */
  docType?: string;
}

export interface SelectedClause {
  id: string;
  title: string;
  category?: string;
  /** canonicalText with every placeholder resolved. */
  text: string;
}

export interface SkippedClause {
  id: string;
  title: string;
  /** Placeholder tokens that had no value, e.g. ['BENEFICIARY', 'WITNESS']. */
  unresolved: string[];
}

export interface ClauseSelection {
  clauses: SelectedClause[];
  skipped: SkippedClause[];
  /** Draftable clauses that did not match this docType. Not a problem — context. */
  otherDocTypeCount: number;
}

export interface SelectClausesOptions {
  entries: ClauseEntry[];
  docType: string;
  /** Resolved client values, keyed by placeholder base (GRANTOR_NAME, …). */
  values: Record<string, string | undefined>;
  /** Two-letter state; when set, clauses tagged for another state are excluded. */
  state?: string;
  /** Upper bound on injected clauses. See MAX_INJECTED_CLAUSES. */
  limit?: number;
}

/**
 * Prompt budget guard. Each clause is real prose and the generators already
 * carry a template, a client data block, and KB context. Injecting an
 * unbounded catalog would crowd out the instructions that make the document
 * correct. Truncation is reported, never silent.
 */
export const MAX_INJECTED_CLAUSES = 25;

// ---------------------------------------------------------------------------
// Placeholder resolution
// ---------------------------------------------------------------------------

const PLACEHOLDER_RX = /\{\{([A-Z0-9_]+)\}\}/g;

/**
 * Any {{…}} residue at all, whatever its alphabet. PLACEHOLDER_RX deliberately
 * matches only registry-shaped tokens, which leaves two ways for a token to
 * survive resolution: an ordinal ({{TRUSTEE_1}}) that the gate folds to its
 * base but the resolver — correctly — does not fill, since TRUSTEE_1 and
 * TRUSTEE_2 may be different people; and a token outside the registry alphabet
 * entirely, like the miner's {{XREF:Article FOURTH}}. Either would ship raw
 * into a client document as docxtemplater DATA, where missingTags cannot see
 * it. So selection re-checks the RESOLVED text against this broader pattern.
 */
const RESIDUAL_TOKEN_RX = /\{\{([^{}]+)\}\}/g;

/**
 * Fill {{PLACEHOLDER}} tokens from known values.
 *
 * Mirrors `resolveClausePlaceholders` in src/services/clause-library-service.ts
 * so the picker's preview and the generator's injection cannot diverge.
 * Duplicated rather than imported: functions/ and src/ are separate packages,
 * the same way clause-miner constants are mirrored elsewhere in functions/.
 */
export function resolveClausePlaceholders(
  text: string,
  values: Record<string, string | undefined>,
): string {
  return text.replace(PLACEHOLDER_RX, (whole, tag: string) => {
    const v = values[tag];
    return v !== undefined && v !== '' ? v : whole;
  });
}

/**
 * Placeholder bases left unresolved by `values`.
 *
 * Ordinal suffixes fold to their base the way the mining registry does —
 * {{TRUSTEE_2}} is a TRUSTEE — so a value supplied for the base satisfies the
 * numbered form too.
 */
export function unresolvedPlaceholders(
  text: string,
  values: Record<string, string | undefined>,
): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER_RX)) {
    const tag = m[1];
    const base = tag.replace(/_\d+$/, '');
    const v = values[tag] ?? values[base];
    if (v === undefined || v === '') out.add(tag);
  }
  return [...out];
}

/**
 * Build the placeholder value map from `buildDocxTemplateData`'s flat contract.
 *
 * The mapping mirrors PLACEHOLDER_REGISTRY in clause-miner/src/fill-contract.ts
 * for every entry whose fillSource is 'clientContext'. Registry entries marked
 * 'attorney' are deliberately absent — they have no client-context value, which
 * is exactly what routes those clauses to `skipped` instead of into a document
 * with a hole in it.
 */
export function buildClausePlaceholderValues(
  templateData: Record<string, unknown>,
): Record<string, string | undefined> {
  const s = (k: string): string | undefined => {
    const v = templateData[k];
    if (v === undefined || v === null) return undefined;
    const str = String(v).trim();
    return str === '' ? undefined : str;
  };

  return {
    GRANTOR_NAME: s('clientFullName'),
    GRANTOR: s('clientFullName'),
    SETTLOR: s('clientFullName'),
    TESTATOR: s('clientFullName'),
    PRINCIPAL: s('clientFullName'),
    SPOUSE_NAME: s('spouseFullName'),
    SPOUSE: s('spouseFullName'),
    TRUSTEE: s('trusteeName'),
    SUCCESSOR_TRUSTEE: s('alternateTrusteeName'),
    EXECUTOR: s('executorName'),
    SUCCESSOR_EXECUTOR: s('alternateExecutorName'),
    GUARDIAN: s('guardianName'),
    SUCCESSOR_GUARDIAN: s('alternateGuardianName'),
    AGENT: s('poaAgentName'),
    SUCCESSOR_AGENT: s('poaAlternateAgentName'),
    HEALTHCARE_AGENT: s('healthcareAgentName'),
    CHILDREN_LIST: s('childrenNames'),
    CHILD_COUNT: s('childCount'),
    DATE: s('todayFormatted'),
    STATE: s('clientState'),
    COUNTY: s('clientCounty'),
    JURISDICTION: s('clientState'),
    FIRM_NAME: s('firmName'),
    ATTORNEY_NAME: s('attorneyName'),
  };
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * The picker's rule, restated server-side. See THE DRAFTABILITY GATE above.
 */
export function isDraftable(entry: ClauseEntry): boolean {
  if (entry.origin === 'manual') return true;
  return entry.status === 'approved' && entry.piiScanStatus !== 'blocked';
}

/**
 * Choose the clauses to inject for one document.
 *
 * Untyped clauses (no `docType`) are treated as applying to every document —
 * that is how manually authored entries arrive, since the picker's add form
 * captures title, text, category, and state but not docType.
 */
export function selectClausesForDocument(options: SelectClausesOptions): ClauseSelection {
  const { entries, docType, values, state, limit = MAX_INJECTED_CLAUSES } = options;

  const draftable = entries.filter(isDraftable);

  let otherDocTypeCount = 0;
  const applicable = draftable.filter((e) => {
    if (e.docType && e.docType !== docType) {
      otherDocTypeCount++;
      return false;
    }
    // A clause tagged for another jurisdiction must not be drafted into a
    // document governed by this one.
    if (state && e.state && e.state.toUpperCase() !== state.toUpperCase()) return false;
    return typeof e.canonicalText === 'string' && e.canonicalText.trim().length > 0;
  });

  const clauses: SelectedClause[] = [];
  const skipped: SkippedClause[] = [];

  for (const e of applicable) {
    const raw = e.canonicalText!;
    const missing = unresolvedPlaceholders(raw, values);
    const title = e.title?.trim() || e.functionSummary?.trim() || `Clause ${e.id}`;

    if (missing.length > 0) {
      skipped.push({ id: e.id, title, unresolved: missing });
      continue;
    }

    const text = resolveClausePlaceholders(raw, values).trim();
    const residual = [...new Set([...text.matchAll(RESIDUAL_TOKEN_RX)].map((m) => m[1]))];
    if (residual.length > 0) {
      skipped.push({ id: e.id, title, unresolved: residual });
      continue;
    }

    clauses.push({ id: e.id, title, category: e.category, text });
  }

  // Stable order so the same client regenerates the same document.
  clauses.sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.id.localeCompare(b.id));

  return { clauses: clauses.slice(0, limit), skipped, otherDocTypeCount };
}

// ---------------------------------------------------------------------------
// Prompt block
// ---------------------------------------------------------------------------

/**
 * Render the selected clauses as a prompt block.
 *
 * The instructions matter as much as the text. Two failure modes are worth
 * guarding against explicitly:
 *
 *   1. The model paraphrases the clause. Then the firm's approved language is
 *      not what ships, and the whole exercise is pointless.
 *   2. The model treats the clause bank as a replacement for the template's
 *      statutory scaffolding and drops an attestation, a self-proving
 *      affidavit, or a durability clause to make room. That would turn an
 *      improvement into an invalid instrument.
 */
export function buildClausePromptBlock(selection: ClauseSelection): string {
  if (selection.clauses.length === 0) return '';

  const header = [
    'FIRM CLAUSE LIBRARY — APPROVED LANGUAGE:',
    'The clauses below are this firm\'s attorney-approved language for this document type.',
    'Rules:',
    '  • Where a clause below covers a subject this document addresses, use its text VERBATIM.',
    '    Do not paraphrase, condense, re-order its sentences, or restate it in your own words.',
    '  • Integrate each clause under an appropriate article or section heading, and renumber',
    '    surrounding sections as needed. Changing a heading or a section number is fine;',
    '    changing the clause text is not.',
    '  • These SUPPLEMENT the required document structure. Never drop a statutory provision,',
    '    execution block, witness attestation, self-proving affidavit, or notary block to make',
    '    room for one.',
    '  • If a clause does not fit this client\'s facts, omit it entirely rather than adapting it.',
    '',
  ].join('\n');

  const body = selection.clauses
    .map((c, i) => `--- CLAUSE ${i + 1}: ${c.title}${c.category ? ` (${c.category})` : ''} ---\n${c.text}`)
    .join('\n\n');

  return `${header}${body}`;
}

/**
 * One-line summary for the generation log. Names what was injected AND what
 * was held back — a skipped clause is approved firm language that did not make
 * it into the draft, which the attorney may want to add via the picker.
 */
export function describeSelection(selection: ClauseSelection): string {
  const parts = [`${selection.clauses.length} clause(s) injected`];
  if (selection.skipped.length > 0) {
    const sample = selection.skipped
      .slice(0, 3)
      .map((s) => `"${s.title}" needs ${s.unresolved.join('/')}`)
      .join('; ');
    parts.push(
      `${selection.skipped.length} skipped for unresolved placeholders (${sample}` +
      `${selection.skipped.length > 3 ? '; …' : ''})`,
    );
  }
  if (selection.otherDocTypeCount > 0) {
    parts.push(`${selection.otherDocTypeCount} for other doc types`);
  }
  return parts.join(' · ');
}
