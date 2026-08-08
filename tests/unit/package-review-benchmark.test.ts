import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import mammoth from 'mammoth';
import {
  reviewPackage,
  type PackageDoc,
  type PackageFinding,
  type PackageContext,
} from '../../functions/src/package-review';

/**
 * J2 — benchmark of the #280 package-review engine against the four finding
 * classes Statular's Analysis & Review panel was observed catching on a
 * generated will package (STATULAR-VIDEO-REVIEW.md §7):
 *
 *   (a) unfilled placeholders surviving into rendered output
 *   (b) cross-party inconsistency
 *   (c) statutory conflict, with citation
 *   (d) logical dead-ends across cross-referenced provisions
 *
 * Unlike package-review.test.ts (synthetic fixtures), this suite runs the
 * engine over a REAL will package: the three Jessica Byrnes instruments in
 * samples/interactivelegal (will, POA, healthcare directive — the same trio a
 * production `foundation` package generates), converted to HTML the same way
 * the app renders DOCX (mammoth). Defects are then seeded into that real prose,
 * replicating the exact examples observed in Statular's panel, and the suite
 * asserts what the engine catches and what it (currently, knowingly) misses.
 *
 * An expected-miss assertion is a BENCHMARK RESULT, not an endorsement: if a
 * later change makes the engine catch one of these, the test fails so the
 * benchmark read-out gets updated rather than silently going stale.
 *
 * Skips (does not fail) when the samples are absent — B6 may remove
 * samples/interactivelegal from the repo, and this benchmark must not pin
 * those files in place.
 */

const SAMPLES = path.resolve(__dirname, '../../samples/interactivelegal');
const SAMPLE_FILES = {
  will: 'Jessica Byrnes - LW&T 11.3.25.docx',
  poa: 'Jessica Byrnes- POA 11.3.25.docx',
  livingWill: 'Jessica Byrnes- HC 11.3.25.docx',
} as const;

const samplesPresent = Object.values(SAMPLE_FILES).every((f) =>
  fs.existsSync(path.join(SAMPLES, f)),
);

/**
 * Roster for the Byrnes matter, transcribed from the instruments themselves
 * (the same people scripts/diagnostics/templatize-samples.cjs maps). These are
 * real names from real documents already in this repo — no new exposure.
 */
const BYRNES_CONTEXT: PackageContext = {
  people: [
    { name: 'Jessica Byrnes', role: 'client', label: 'client' },
    { name: 'Sean Byrnes', role: 'spouse', label: 'spouse', njTaxClass: 'A', isBeneficiary: true },
    { name: 'Jack Byrnes', role: 'child', label: 'child', njTaxClass: 'A', isBeneficiary: true },
    { name: 'Lyla Byrnes', role: 'child', label: 'child', njTaxClass: 'A', isBeneficiary: true },
    { name: 'Madelyn Byrnes', role: 'child', label: 'child', njTaxClass: 'A', isBeneficiary: true },
    { name: 'Anthony Esernio', role: 'fiduciary', label: 'alternate executor' },
    { name: 'Cathleen Esernio', role: 'fiduciary', label: 'second alternate executor' },
    { name: 'Jeana Esernio', role: 'fiduciary', label: 'third alternate executor' },
    { name: 'James Esernio', role: 'fiduciary', label: 'trustee' },
    { name: 'Olivia Esernio', role: 'fiduciary', label: 'alternate guardian' },
  ],
};

let realDocs: PackageDoc[] = [];

/** Deep-copy the package so a seeded scenario cannot leak into the next. */
function freshPackage(): PackageDoc[] {
  return realDocs.map((d) => ({ ...d }));
}

function byReason(findings: PackageFinding[], reason: PackageFinding['reason']): PackageFinding[] {
  return findings.filter((f) => f.reason === reason);
}

/**
 * Seed a defect into one document by exact-string replacement. Throws when the
 * anchor is not found, so a change to the sample files fails loudly instead of
 * silently turning a seeded test vacuous.
 */
function seed(docs: PackageDoc[], docType: string, anchor: string, replacement: string): void {
  const doc = docs.find((d) => d.docType === docType);
  if (!doc) throw new Error(`seed: no ${docType} in package`);
  if (!doc.content.includes(anchor)) throw new Error(`seed: anchor not found in ${docType}: ${anchor}`);
  doc.content = doc.content.replace(anchor, replacement);
}

describe.skipIf(!samplesPresent)('J2 benchmark — reviewPackage on the real Byrnes will package', () => {
  beforeAll(async () => {
    realDocs = await Promise.all(
      (Object.entries(SAMPLE_FILES) as Array<[string, string]>).map(async ([docType, file]) => {
        const { value } = await mammoth.convertToHtml({ path: path.join(SAMPLES, file) });
        return { docType, title: file.replace(/\.docx$/, ''), content: value };
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Baseline — the unmodified real package
  // -------------------------------------------------------------------------

  describe('baseline (unmodified package)', () => {
    it('reports no blank-field findings — execution and acknowledgment blanks are correct blanks', () => {
      const findings = reviewPackage(freshPackage(), BYRNES_CONTEXT);
      console.log(
        '[J2 baseline]',
        JSON.stringify(
          findings.map((f) => ({ docType: f.docType, location: f.location, severity: f.severity, reason: f.reason, summary: f.summary })),
          null,
          2,
        ),
      );

      // The corpus's only underscore runs are execution-date blanks — in the
      // will next to "subscribed"/"sworn", and in the POA/HC inside attorney
      // acknowledgment lines ("On December _____, 2025, before me … personally
      // appeared"). All are correct blanks, filled by hand at signing. The
      // first benchmark run reported the POA/HC pair as blank-field findings
      // (benchmark defect BM-FP1) because SIGNATURE_CONTEXT knew jurat
      // vocabulary but not acknowledgment vocabulary; this pins the fix.
      expect(byReason(findings, 'blank-field')).toHaveLength(0);
    });

    it('BM-A3: colon-form assembly artifacts ([OBJ:WILL 1069]) are caught like space-form ones', () => {
      const docs = freshPackage();
      // The corpus genuinely contains dozens of colon-form tokens. (They are
      // hidden text in the source .docx — w:vanish via the "Object" character
      // style, InteractiveLegal's clause-provenance markers — which mammoth
      // surfaces. Counted as corpus artifacts, not engine false positives: in
      // production this check runs over our own generated HTML, which never
      // carries them unless something is genuinely broken.)
      expect(docs.some((d) => /\[OBJ:[A-Z]/.test(d.content))).toBe(true);

      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      const tokens = byReason(findings, 'unresolved-token');

      // The first benchmark run caught exactly 2 of the corpus's ~70 assembly
      // artifacts: the token character class had no ":", so "[OBJ WILL 1001]"
      // (space form) was caught while "[OBJ:WILL 1069]" and every other colon
      // form sailed through — the same gap-shape as the {{XREF:Article FOURTH}}
      // finding in the clause fill contract (HOMEWORK A2). This pins the fix.
      expect(tokens.some((f) => f.summary.includes('[OBJ:WILL 1069]'))).toBe(true);
      // Distinct tokens per document, measured on the frozen samples:
      // will 35 (incl. the 2 space-form ones), poa 30, livingWill 12.
      const byDoc = (t: string) => tokens.filter((f) => f.docType === t).length;
      expect(byDoc('will')).toBe(35);
      expect(byDoc('poa')).toBe(30);
      expect(byDoc('livingWill')).toBe(12);
    });

    it('BM-A3 guard: a bracketed statutory citation is NOT mistaken for an assembly token', () => {
      const docs = freshPackage();
      // Digits touch the colon in a citation; letters touch it in a token.
      seed(
        docs,
        'will',
        'Payments to Minors',
        'Payments to Minors. Distributions to minors are governed by [N.J.S.A. 46:38A-1] and ' +
          'may be apportioned under [3B:3-2] where applicable. ',
      );
      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      const citations = byReason(findings, 'unresolved-token').filter(
        (f) => f.summary.includes('46:38A') || f.summary.includes('3B:3'),
      );
      expect(citations).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Class (a) — unfilled placeholders surviving into rendered output
  // Statular's observed examples: an execution line reading "in , New Jersey"
  // with the municipality blank; a literal [SIGNING CITY] in three documents.
  // -------------------------------------------------------------------------

  describe('class (a) — unfilled placeholders in rendered output', () => {
    it('CATCHES a1: execution line "in , New Jersey" (empty merge value)', () => {
      const docs = freshPackage();
      seed(
        docs,
        'will',
        'IN WITNESS WHEREOF, I have hereunto subscribed my name on December',
        'IN WITNESS WHEREOF, I have hereunto subscribed my name in , New Jersey on December',
      );
      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      const hit = byReason(findings, 'empty-substitution').find((f) => f.docType === 'will');
      expect(hit).toBeDefined();
      expect(hit!.severity).toBe('high');
      expect(hit!.detail).toContain('in , New Jersey');
    });

    it('a-guard: a genuine blank inside a disinheritance acknowledgment is still flagged', () => {
      const docs = freshPackage();
      seed(
        docs,
        'will',
        'Funeral Representative and Arrangements',
        'Omissions. I acknowledge that I have intentionally omitted my sibling ______ from this Will ' +
          'and direct that no share pass to them. Funeral Representative and Arrangements',
      );
      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      // "acknowledge" is operative-clause vocabulary too — suppressing every
      // neighbourhood containing the stem would hide real unfilled blanks.
      // Found by adversarial verification of the BM-FP1 fix.
      expect(byReason(findings, 'blank-field').filter((f) => f.docType === 'will')).toHaveLength(1);
    });

    it('CATCHES a2: a literal [SIGNING CITY] placeholder in all three documents', () => {
      const docs = freshPackage();
      seed(docs, 'will', 'IN WITNESS WHEREOF', 'Executed at [SIGNING CITY], New Jersey. IN WITNESS WHEREOF');
      seed(docs, 'poa', 'IN WITNESS WHEREOF', 'Executed at [SIGNING CITY], New Jersey. IN WITNESS WHEREOF');
      seed(docs, 'livingWill', 'Executed on December', 'Executed at [SIGNING CITY], New Jersey on December');

      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      const hits = byReason(findings, 'unresolved-token').filter((f) =>
        f.summary.includes('[SIGNING CITY]'),
      );
      expect(hits.map((f) => f.docType).sort()).toEqual(['livingWill', 'poa', 'will']);
      for (const hit of hits) expect(hit.severity).toBe('high');
    });
  });

  // -------------------------------------------------------------------------
  // Class (b) — cross-party inconsistency
  // Statular's observed example: one individual listed with no relationship
  // descriptor while another is identified as "my spouse", in two sections of
  // the same document.
  // -------------------------------------------------------------------------

  describe('class (b) — cross-party inconsistency', () => {
    it('MISSES b1: a party named with no relationship descriptor while another carries one', () => {
      const docs = freshPackage();
      // The will consistently writes "my Husband, SEAN BYRNES". Seed a section
      // naming a party bare — Statular flagged exactly this shape. "Robert
      // Colicchio" is INVENTED (synthetic); he appears nowhere in the real matter.
      seed(
        docs,
        'will',
        'Funeral Representative and Arrangements',
        'Funeral Representative and Arrangements. I direct that Robert Colicchio and my Husband consult on all arrangements. ',
      );
      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      // EXPECTED MISS — benchmark result. No check compares how parties are
      // introduced (with vs. without a relationship descriptor). The engine's
      // cross-party checks are identity-based (name-collision, suffix-dropped),
      // not descriptor-based. If this starts failing, coverage grew — update
      // the read-out.
      expect(findings.filter((f) => f.summary.includes('Colicchio'))).toHaveLength(0);
    });

    it('CATCHES b2 (identity half): two roster people under one name → name-collision', () => {
      const context: PackageContext = {
        people: [
          ...BYRNES_CONTEXT.people,
          // A daughter recorded under the client's own name (the Rios-case
          // shape that motivated the check). Synthetic addition to the roster.
          { name: 'Jessica Byrnes', role: 'child', label: 'child', njTaxClass: 'A', isBeneficiary: true },
        ],
      };
      const findings = reviewPackage(freshPackage(), context);
      const hit = byReason(findings, 'name-collision')[0];
      expect(hit).toBeDefined();
      expect(hit.severity).toBe('high');
      expect(hit.summary).toContain('Jessica Byrnes');
    });

    it('CATCHES b2 (rendering half): a dropped suffix that collides with another person', () => {
      const context: PackageContext = {
        people: [
          ...BYRNES_CONTEXT.people,
          // SYNTHETIC roster addition — no such child exists in the real
          // Byrnes matter. Invented so that the spouse's real bare-name
          // references become ambiguous with a "Jr." the documents drop.
          { name: 'Sean Byrnes Jr.', role: 'child', label: 'child', njTaxClass: 'A', isBeneficiary: true },
        ],
      };
      const findings = reviewPackage(freshPackage(), context);
      const high = byReason(findings, 'suffix-dropped').filter((f) => f.severity === 'high');
      expect(high.length).toBeGreaterThan(0);
      expect(high[0].summary).toContain('matching the spouse');
    });
  });

  // -------------------------------------------------------------------------
  // Class (c) — statutory conflict, with citation
  // Statular's observed example: UTMA custodianship to 25 where NJ caps
  // termination at 21, with the statute cited.
  // -------------------------------------------------------------------------

  describe('class (c) — statutory conflict with citation', () => {
    it('CATCHES c1: UTMA custodianship to age 25, citing N.J.S.A. 46:38A', () => {
      const docs = freshPackage();
      seed(
        docs,
        'will',
        'Payments to Minors',
        'Payments to Minors. My Executor may distribute a minor beneficiary’s share to a custodian ' +
          'under the New Jersey Uniform Transfers to Minors Act until the beneficiary reaches 25 years of age. ',
      );
      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      const hit = byReason(findings, 'statutory-limit')[0];
      expect(hit).toBeDefined();
      expect(hit.summary).toContain('25');
      expect(hit.detail).toContain('N.J.S.A. 46:38A-1');
      expect(hit.detail).toContain('21');
    });

    it('CATCHES c2: the same defect written "twenty-five (25)" — spelled age, digits in parens', () => {
      const docs = freshPackage();
      seed(
        docs,
        'will',
        'Payments to Minors',
        'Payments to Minors. My Executor may distribute a minor beneficiary’s share to a custodian ' +
          'under the New Jersey Uniform Transfers to Minors Act until the beneficiary attains the age of ' +
          'twenty-five (25) years. ',
      );
      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      // The first benchmark run MISSED this: AGE_AFTER_UTMA required bare
      // digits directly after the trigger word, while formal drafting
      // overwhelmingly writes "twenty-five (25)" — the identical defect in the
      // identical spot was caught in digit form (c1) and missed in the form
      // attorneys actually write. This pins the fix. A pure-spelled age with
      // no parenthesized digits ("twenty-five years") is still a known miss.
      const hit = byReason(findings, 'statutory-limit')[0];
      expect(hit).toBeDefined();
      expect(hit.summary).toContain('25');
      expect(hit.detail).toContain('N.J.S.A. 46:38A-1');
    });

    it('c-guard: a spelled DURATION near a UTMA reference does not read as an age', () => {
      const docs = freshPackage();
      seed(
        docs,
        'will',
        'Payments to Minors',
        'Payments to Minors. My Executor may transfer a minor beneficiary’s share to a custodian under ' +
          'the New Jersey Uniform Transfers to Minors Act if the share is not claimed until thirty (30) ' +
          'days after my death. ',
      );
      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      // "thirty (30) days" is a duration, not a custodianship age — a
      // statutory-limit finding here would assert a violation the text does
      // not contain. Found by adversarial verification of the c2 fix.
      expect(byReason(findings, 'statutory-limit')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Class (d) — logical dead-ends across cross-referenced provisions
  // Statular's observed example: a guardianship clause that disqualifies a
  // guardian on marriage and sends the office to "the next nominated successor
  // guardian as set forth above" — who is last in the list, so the provision
  // appoints no one.
  // -------------------------------------------------------------------------

  describe('class (d) — cross-reference dead-ends', () => {
    it('MISSES d1: a successor-guardian chain that appoints no one', () => {
      const docs = freshPackage();
      seed(
        docs,
        'will',
        'Fiduciary Provisions',
        'Guardianship. I appoint my sister-in-law Olivia Esernio as guardian of the person of my minor ' +
          'children. If Olivia Esernio is unable or unwilling to serve, I appoint Jeana Esernio as successor ' +
          'guardian. If any guardian named above shall marry, that guardian shall be disqualified from ' +
          'serving, and the guardianship shall pass to the next nominated successor guardian as set forth ' +
          'above. Fiduciary Provisions',
      );
      const findings = reviewPackage(docs, BYRNES_CONTEXT);
      // EXPECTED MISS — benchmark result. Jeana Esernio is the LAST nominee, so
      // on her disqualification "the next nominated successor guardian" names
      // nobody and the provision dead-ends. Detecting this requires reasoning
      // over the document's own internal reference structure, which no current
      // check attempts (inoperative-provision is scoped to the SNT pattern).
      // If this starts failing, coverage grew — update the read-out.
      expect(
        findings.filter((f) => f.reason === 'inoperative-provision' || f.summary.toLowerCase().includes('guardian')),
      ).toHaveLength(0);
    });
  });
});
