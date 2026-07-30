/**
 * §5.3 — PII gates net 2 (corpus-wide Aho-Corasick roster sweep) and net 3
 * (haiku PII gate), run over EVERY canonical and EVERY variant normText
 * before catalog write. Any hit ⇒ piiScanStatus 'blocked' — fail closed.
 *
 * Roster sweep engineering for false positives (§5.3):
 *  - case-sensitive whole-word matching;
 *  - an English/legal-term dictionary subtracted from the automaton
 *    (Young, White, Park, Church, Grant, Trust, Wills, Banks, …);
 *  - stoplisted surnames match on FULL NAME only; matters belonging to
 *    stoplist-surnamed clients are reported for mandatory human PII review
 *    instead of a silent pass.
 *
 * The automaton is implemented here (goto/fail Aho-Corasick) — no dependency.
 * Pure module except for the batch-request builders (which only construct
 * request objects; the caller owns the BatchClient).
 */

import type { BatchRequest } from './clients/interfaces.js';

/** §5.3 stoplist: surnames that are English/legal terms. */
export const SURNAME_STOPLIST: ReadonlySet<string> = new Set(
  [
    'Young', 'White', 'Park', 'Church', 'Grant', 'Trust', 'Wills', 'Banks',
    'Law', 'Case', 'Justice', 'Judge', 'Rich', 'Berry', 'Field', 'Fields',
    'Brown', 'Green', 'Gray', 'Grey', 'Stone', 'Wood', 'Woods', 'Hill',
    'Bond', 'Deeds', 'Held', 'Little', 'Long', 'Short', 'Small', 'Best',
    'Power', 'Powers', 'Price', 'Christian', 'May', 'June', 'Article',
    'Section', 'Will', 'Estate', 'Living', 'Family', 'Marital', 'Residual',
  ].map((w) => w.toLowerCase()),
);

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[A-Za-z0-9'’-]/.test(ch);
}

/* ------------------------------------------------------------------ */
/* Aho-Corasick                                                       */
/* ------------------------------------------------------------------ */

interface AcNode {
  next: Map<string, number>;
  fail: number;
  /** Terms ending at this node. */
  outputs: string[];
}

export interface RosterMatch {
  term: string;
  /** Start offset of the match in the swept text. */
  index: number;
}

export class AhoCorasick {
  private readonly nodes: AcNode[] = [{ next: new Map(), fail: 0, outputs: [] }];

  constructor(terms: Iterable<string>) {
    for (const term of terms) this.addTerm(term);
    this.buildFailLinks();
  }

  private addTerm(term: string): void {
    if (term.length === 0) return;
    let cur = 0;
    for (const ch of term) {
      let nxt = this.nodes[cur].next.get(ch);
      if (nxt === undefined) {
        nxt = this.nodes.length;
        this.nodes.push({ next: new Map(), fail: 0, outputs: [] });
        this.nodes[cur].next.set(ch, nxt);
      }
      cur = nxt;
    }
    this.nodes[cur].outputs.push(term);
  }

  private buildFailLinks(): void {
    const queue: number[] = [];
    for (const child of this.nodes[0].next.values()) {
      this.nodes[child].fail = 0;
      queue.push(child);
    }
    while (queue.length > 0) {
      const cur = queue.shift() as number;
      for (const [ch, child] of this.nodes[cur].next) {
        let f = this.nodes[cur].fail;
        while (f !== 0 && !this.nodes[f].next.has(ch)) {
          f = this.nodes[f].fail;
        }
        const candidate = this.nodes[f].next.get(ch) ?? 0;
        const failTo = candidate === child ? 0 : candidate;
        this.nodes[child].fail = failTo;
        this.nodes[child].outputs.push(...this.nodes[failTo].outputs);
        queue.push(child);
      }
    }
  }

  /** Case-sensitive scan; whole-word boundaries enforced at match time. */
  scan(text: string): RosterMatch[] {
    const matches: RosterMatch[] = [];
    let state = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      while (state !== 0 && !this.nodes[state].next.has(ch)) {
        state = this.nodes[state].fail;
      }
      state = this.nodes[state].next.get(ch) ?? 0;
      for (const term of this.nodes[state].outputs) {
        const start = i - term.length + 1;
        const before = text[start - 1];
        const after = text[i + 1];
        if (!isWordChar(before) && !isWordChar(after)) {
          matches.push({ term, index: start });
        }
      }
    }
    return matches;
  }
}

/* ------------------------------------------------------------------ */
/* Roster construction + sweep                                        */
/* ------------------------------------------------------------------ */

export interface RosterSweep {
  automaton: AhoCorasick;
  /**
   * Surnames that were stoplist-suppressed as bare tokens. Any matter whose
   * client carries one of these must be routed to MANDATORY human PII review
   * (§5.3) — the sweep alone cannot clear it.
   */
  stoplistSuppressed: string[];
}

/**
 * Build the sweep automaton from every folder-name token and every extracted
 * party name (§5.3). Full multi-word names always enter the automaton;
 * single tokens enter unless stoplisted (those match full-name only).
 */
export function buildRosterSweep(names: Iterable<string>): RosterSweep {
  const terms = new Set<string>();
  const suppressed = new Set<string>();
  for (const raw of names) {
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name.length < 2) continue;
    const tokens = name.split(' ');
    if (tokens.length > 1) {
      terms.add(name); // full name always matches, stoplisted surname or not
    }
    for (const token of tokens) {
      const clean = token.replace(/[.,;:]+$/g, '');
      if (clean.length < 3) continue;
      if (/^\d+$/.test(clean)) continue;
      if (SURNAME_STOPLIST.has(clean.toLowerCase())) {
        suppressed.add(clean);
        continue; // stoplisted surname: full-name-only matching
      }
      terms.add(clean);
    }
  }
  return {
    automaton: new AhoCorasick(terms),
    stoplistSuppressed: [...suppressed].sort(),
  };
}

export interface SweepResult {
  clean: boolean;
  hits: RosterMatch[];
}

export function sweepText(sweep: RosterSweep, text: string): SweepResult {
  const hits = sweep.automaton.scan(text);
  return { clean: hits.length === 0, hits };
}

/* ------------------------------------------------------------------ */
/* Net 3 — haiku PII gate (batch request construction)                */
/* ------------------------------------------------------------------ */

const PII_GATE_SYSTEM = `You are a privacy gate for a law firm's clause catalog. The text you receive is supposed to be a fully anonymized estate-planning clause: every client name, address, SSN, and account identifier must already be replaced by {{PLACEHOLDER}} tokens. Report ANY residual personally identifying information: personal names (other than obvious form dummies like JOHN DOE), street addresses, phone numbers, email addresses, SSNs/EINs, account numbers, or dates of birth. Placeholders like {{GRANTOR_NAME}} and legal boilerplate are NOT PII. Be conservative: when a capitalized word could plausibly be a person's surname, report it.`;

export const PII_GATE_TOOL = {
  name: 'report_pii',
  description: 'Report whether the clause text contains residual PII.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pii_found: { type: 'boolean' },
      findings: {
        type: 'array',
        items: { type: 'string' },
        description: 'Each residual PII string found, verbatim.',
      },
    },
    required: ['pii_found', 'findings'],
  },
};

export function buildPiiGateRequests(
  texts: Array<{ id: string; text: string }>,
): BatchRequest[] {
  return texts.map(({ id, text }) => ({
    customId: `pii:${id}`,
    model: 'haiku',
    maxTokens: 512,
    system: PII_GATE_SYSTEM,
    userText: text.slice(0, 8000),
    tool: PII_GATE_TOOL,
  }));
}

export type PiiScanStatus = 'clean' | 'blocked';

/**
 * Fail closed (§5.3 net 3): a hit blocks; an errored/unparseable gate result
 * ALSO blocks — publication is impossible until a human clears it.
 */
export function gateVerdict(result: {
  ok: boolean;
  toolInput: Record<string, unknown> | undefined;
}): PiiScanStatus {
  if (!result.ok || result.toolInput === undefined) return 'blocked';
  return result.toolInput.pii_found === false ? 'clean' : 'blocked';
}
