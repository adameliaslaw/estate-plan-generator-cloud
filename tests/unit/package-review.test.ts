import { describe, it, expect } from 'vitest';
import {
  reviewPackage,
  summarizeFindings,
  htmlToText,
  locateSection,
  type PackageDoc,
} from '../../functions/src/package-review';

/**
 * Cross-document package review.
 *
 * The defect patterns exercised below were observed in a real generated estate
 * plan produced by a competing platform, whose own per-document AI reviewer
 * caught six of them and missed the cross-document ones entirely. The fixtures
 * here are synthetic re-creations of those patterns — no client data.
 *
 * Roughly half these tests assert SILENCE. That is deliberate: a review queue
 * is only worth reading if it does not cry wolf, so the correct-drafting cases
 * are as load-bearing as the defect cases.
 */

function doc(docType: string, content: string, title = docType): PackageDoc {
  return { docType, title, content };
}

// ---------------------------------------------------------------------------
// htmlToText / locateSection
// ---------------------------------------------------------------------------

describe('htmlToText', () => {
  it('turns block elements into line breaks and decodes entities', () => {
    const text = htmlToText('<h2>ARTICLE ONE</h2><p>Smith &amp; Jones</p><p>Second&nbsp;line</p>');
    expect(text).toBe('ARTICLE ONE\nSmith & Jones\nSecond line');
  });

  it('drops script and style bodies so they cannot trip a check', () => {
    const text = htmlToText('<p>Real text</p><script>var x = "{{token}}";</script>');
    expect(text).not.toContain('{{token}}');
    expect(text).toContain('Real text');
  });
});

describe('locateSection', () => {
  const text = 'ARTICLE THREE\nSection 3.06\nThe trustee shall administer the fund.';

  it('reports the nearest preceding numbered section', () => {
    expect(locateSection(text, text.indexOf('The trustee'))).toBe('Section 3.06');
  });

  it('falls back to an all-caps heading, title-cased', () => {
    const t = 'DISPOSITION OF PROPERTY\nI give all of my estate to my spouse.';
    expect(locateSection(t, t.indexOf('I give'))).toBe('Disposition Of Property');
  });

  it('falls back to a structural label when nothing heading-like precedes', () => {
    expect(locateSection('just a sentence here', 5)).toBe('Body Paragraph');
  });
});

// ---------------------------------------------------------------------------
// Check — references to an instrument the package does not contain
// ---------------------------------------------------------------------------

describe('missing-instrument', () => {
  const ACKNOWLEDGMENT = doc(
    'engagementLetter',
    `<p>By signing below, you acknowledge and agree to the following:</p>
     <p>You understand that your trust only avoids probate for assets that are properly
     transferred or made payable to the trust. It is your responsibility to ensure that
     your trust is funded.</p>`,
    'Client Acknowledgment Letter',
  );

  it('flags a letter that speaks of a trust when the package has none', () => {
    const findings = reviewPackage([
      doc('will', '<p>I revoke all my previous wills and codicils.</p>'),
      doc('poa', '<p>I appoint my spouse as my agent.</p>'),
      ACKNOWLEDGMENT,
    ]);

    const hit = findings.find((f) => f.reason === 'missing-instrument');
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe('high');
    expect(hit!.docType).toBe('engagementLetter');
    expect(hit!.detail).toMatch(/no trust, certification of trust, or trust amendment/);
  });

  it('stays silent once a trust document is actually in the package', () => {
    const findings = reviewPackage([
      doc('trust', '<p>The Smith Family Revocable Living Trust.</p>'),
      ACKNOWLEDGMENT,
    ]);
    expect(findings.filter((f) => f.reason === 'missing-instrument')).toHaveLength(0);
  });

  it('does not mistake a will-created Special Needs Trust for a living trust', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<p>Any Special Needs Trust created under this instrument shall be held as follows.
         The trustee of that Special Needs Trust shall have sole discretion. Each share
         shall be held in a Special Needs Trust if the beneficiary receives public benefits.</p>`,
      ),
    ]);
    expect(findings.filter((f) => f.reason === 'missing-instrument')).toHaveLength(0);
  });

  it('does not fire on a pour-over will, which speaks of a trust by design', () => {
    const findings = reviewPackage([
      doc('pourOverWill', '<p>I give the residue of my estate to the trustee of my trust.</p>'),
    ]);
    expect(findings.filter((f) => f.reason === 'missing-instrument')).toHaveLength(0);
  });

  it('does not fire on incidental statutory prose mentioning trusts generally', () => {
    const findings = reviewPackage([
      doc(
        'poa',
        `<p>Litigation. Initiate, defend, and oppose litigation to ascertain the meaning,
         validity, or effect of a deed, will, declaration of trust, or other instrument
         affecting my interest.</p>`,
      ),
    ]);
    expect(findings.filter((f) => f.reason === 'missing-instrument')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Check — cover letter enclosure list vs. package contents
// ---------------------------------------------------------------------------

describe('enclosure-mismatch', () => {
  const LETTER = doc(
    'coverLetter',
    `<p>Please review the enclosed documents, which include the following:</p>
     <ul>
       <li>Last Will and Testament</li>
       <li>A Durable Power of Attorney for each of you</li>
       <li>A HIPAA Authorization for each of you</li>
     </ul>`,
    'Cover Letter',
  );

  it('flags an enclosure the package does not contain', () => {
    const findings = reviewPackage([
      LETTER,
      doc('will', '<p>I revoke all prior wills.</p>'),
      doc('poa', '<p>I appoint an agent.</p>'),
    ]);

    const hits = findings.filter((f) => f.reason === 'enclosure-mismatch');
    expect(hits).toHaveLength(1);
    expect(hits[0].summary).toContain('HIPAA Authorization');
    expect(hits[0].location).toBe('Enclosure List');
    expect(hits[0].severity).toBe('medium');
  });

  it('stays silent when every listed enclosure is present', () => {
    const findings = reviewPackage([
      LETTER,
      doc('will', '<p>I revoke all prior wills.</p>'),
      doc('poa', '<p>I appoint an agent.</p>'),
      doc('hipaaRelease', '<p>I authorize release of my health information.</p>'),
    ]);
    expect(findings.filter((f) => f.reason === 'enclosure-mismatch')).toHaveLength(0);
  });

  it('ignores document names it cannot confidently map', () => {
    const findings = reviewPackage([
      doc(
        'coverLetter',
        '<p>Enclosed please find the following:</p><ul><li>Bespoke Legacy Memorandum</li></ul>',
      ),
    ]);
    expect(findings.filter((f) => f.reason === 'enclosure-mismatch')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Check — unfilled blanks
// ---------------------------------------------------------------------------

describe('blank-field', () => {
  it('flags a blank sitting inside an operative provision', () => {
    const findings = reviewPackage([
      doc(
        'custom',
        `<p>I, JANE DOE, hereby give notice that if I should be hospitalized, it is my wish
         that ______________________________ be given first preference in being admitted
         to visit me in such facility.</p>`,
        'Visitation Authorization',
      ),
    ]);

    const hits = findings.filter((f) => f.reason === 'blank-field');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('high');
  });

  it('does not flag signature, notary, or date lines', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<p>Signature ______________________________</p>
         <p>Dated: ____________</p>
         <p>Subscribed and sworn before me this ______ day of ____________</p>
         <p>Print Name ______________________________ Signature ______________</p>`,
      ),
    ]);
    expect(findings.filter((f) => f.reason === 'blank-field')).toHaveLength(0);
  });

  it('does not flag a horizontal rule made of underscores', () => {
    const findings = reviewPackage([
      doc('will', '<p>________________________________________________</p><p>Real text follows.</p>'),
    ]);
    expect(findings.filter((f) => f.reason === 'blank-field')).toHaveLength(0);
  });

  it('reports at most one blank per line to keep the queue readable', () => {
    const findings = reviewPackage([
      doc('custom', '<p>I appoint ______ as agent and ______ as successor agent today.</p>'),
    ]);
    expect(findings.filter((f) => f.reason === 'blank-field')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Check — unresolved template tokens
// ---------------------------------------------------------------------------

describe('unresolved-token', () => {
  it('flags Handlebars expressions that survived rendering', () => {
    const findings = reviewPackage([
      doc('will', '<p>I, {{client.fullName}}, declare this to be my Will.</p>'),
    ]);
    const hits = findings.filter((f) => f.reason === 'unresolved-token');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('high');
    expect(hits[0].summary).toContain('{{client.fullName}}');
  });

  it('flags drafting markers', () => {
    const findings = reviewPackage([doc('will', '<p>TODO confirm the executor address.</p>')]);
    expect(findings.filter((f) => f.reason === 'unresolved-token')).toHaveLength(1);
  });

  it('reports each distinct token once, not once per occurrence', () => {
    const findings = reviewPackage([
      doc('will', '<p>{{name}} and {{name}} and {{name}} again.</p>'),
    ]);
    expect(findings.filter((f) => f.reason === 'unresolved-token')).toHaveLength(1);
  });

  it('stays silent on clean output', () => {
    const findings = reviewPackage([doc('will', '<p>I, Jane Doe, declare this to be my Will.</p>')]);
    expect(findings.filter((f) => f.reason === 'unresolved-token')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Check — NJ UTMA custodianship age ceiling
// ---------------------------------------------------------------------------

describe('statutory-limit (NJ UTMA)', () => {
  it('flags a custodianship directed past 21', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<p>Such distribution may be made to a custodian selected by the executor for a minor
         beneficiary under the New Jersey Uniform Transfers to Minors Act, N.J. Stat. Ann.
         &sect; 46:38A-1 et seq., until the beneficiary reaches 25 years of age.</p>`,
      ),
    ]);

    const hits = findings.filter((f) => f.reason === 'statutory-limit');
    expect(hits).toHaveLength(1);
    expect(hits[0].summary).toContain('age 25');
    expect(hits[0].detail).toContain('46:38A-1');
    expect(hits[0].severity).toBe('medium');
  });

  it('accepts a custodianship that ends at 21', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<p>Held by a custodian under the New Jersey Uniform Transfers to Minors Act until
         the beneficiary reaches 21 years of age.</p>`,
      ),
    ]);
    expect(findings.filter((f) => f.reason === 'statutory-limit')).toHaveLength(0);
  });

  it('accepts a non-UTMA trust that runs to 25', () => {
    const findings = reviewPackage([
      doc('will', '<p>The trustee shall hold each share in trust until the beneficiary reaches 25.</p>'),
    ]);
    expect(findings.filter((f) => f.reason === 'statutory-limit')).toHaveLength(0);
  });

  it('does not read an unrelated age from far outside the UTMA sentence', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<p>Custodial property under the New Jersey Uniform Transfers to Minors Act shall be
         delivered at 21.</p>
         <p>${'Filler prose about executor powers. '.repeat(30)}</p>
         <p>My spouse attains the age of 62 for purposes of the retirement election.</p>`,
      ),
    ]);
    expect(findings.filter((f) => f.reason === 'statutory-limit')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Check — administration provisions with nothing to administer
// ---------------------------------------------------------------------------

describe('inoperative-provision', () => {
  const ADMIN_PROSE = `
    <h3>Administration of Special Needs Trust</h3>
    <p>Any Special Needs Trust created under this instrument shall be held, administered,
    and distributed as follows. The trustee shall have sole discretion to apply income for
    the beneficiary's supplemental needs.</p>`;

  it('flags an SNT article that no dispositive clause ever triggers', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<h2>DISPOSITION OF PROPERTY</h2>
         <p>Each share created for a living child shall be distributed to that child
         outright and free of trust.</p>
         ${ADMIN_PROSE}`,
      ),
    ]);

    const hits = findings.filter((f) => f.reason === 'inoperative-provision');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('medium');
    expect(hits[0].detail).toMatch(/no operative effect/);
    // Hedged, not asserted — the creation language varies by drafter.
    expect(hits[0].detail).toMatch(/Verify/);
  });

  it('stays silent when a clause does create the trust', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<p>If any beneficiary is receiving public benefits, that beneficiary's share shall
         be held in a Special Needs Trust.</p>
         ${ADMIN_PROSE}`,
      ),
    ]);
    expect(findings.filter((f) => f.reason === 'inoperative-provision')).toHaveLength(0);
  });

  it('stays silent on a will with no SNT provisions at all', () => {
    const findings = reviewPackage([
      doc('will', '<p>I give my entire estate to my spouse, outright and free of trust.</p>'),
    ]);
    expect(findings.filter((f) => f.reason === 'inoperative-provision')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

describe('reviewPackage', () => {
  it('returns nothing for a clean, coherent package', () => {
    const findings = reviewPackage([
      doc(
        'coverLetter',
        '<p>Enclosed are the following:</p><ul><li>Last Will and Testament</li><li>Power of Attorney</li></ul>',
      ),
      doc('will', '<p>I, Jane Doe, revoke all prior wills. I give my estate to my spouse.</p>'),
      doc('poa', '<p>I appoint my spouse as my agent under this durable power of attorney.</p>'),
    ]);
    expect(findings).toEqual([]);
  });

  it('skips documents that failed to generate', () => {
    const findings = reviewPackage([
      { docType: 'will', title: 'Error — Will', status: 'error', content: '<p>{{oops}} TODO</p>' },
    ]);
    expect(findings).toEqual([]);
  });

  it('skips empty content without throwing', () => {
    expect(reviewPackage([doc('will', '   ')])).toEqual([]);
    expect(reviewPackage([])).toEqual([]);
  });

  it('sorts high severity ahead of medium', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<p>Custodian under the New Jersey Uniform Transfers to Minors Act until the
         beneficiary reaches 25 years of age.</p>
         <p>I, {{client.name}}, declare this my Will.</p>`,
      ),
    ]);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings[0].severity).toBe('high');
    expect(findings[findings.length - 1].severity).toBe('medium');
  });

  it('catches the full defect set of a mis-assembled wills-only package', () => {
    // Every defect below was present simultaneously in a real generated package.
    const findings = reviewPackage([
      doc(
        'coverLetter',
        `<p>Please review the enclosed documents, which include the following:</p>
         <ul><li>Last Will and Testament</li><li>A Revocable Living Trust</li></ul>`,
        'Cover Letter',
      ),
      doc(
        'will',
        `<h2>DISPOSITION OF PROPERTY</h2>
         <p>Each share shall be distributed to that child outright and free of trust.</p>
         <h3>Section 5.02</h3>
         <p>To a custodian under the New Jersey Uniform Transfers to Minors Act until the
         beneficiary reaches 25 years of age.</p>
         <h3>Administration of Special Needs Trust</h3>
         <p>Any Special Needs Trust created under this instrument shall be administered
         as follows.</p>`,
        'Last Will and Testament',
      ),
      doc(
        'engagementLetter',
        '<p>It is your responsibility to ensure that your trust is funded.</p>',
        'Client Acknowledgment Letter',
      ),
    ]);

    const reasons = new Set(findings.map((f) => f.reason));
    expect(reasons).toContain('missing-instrument');   // acknowledgment letter vs. no trust
    expect(reasons).toContain('enclosure-mismatch');   // cover letter promises a trust
    expect(reasons).toContain('statutory-limit');      // UTMA to 25
    expect(reasons).toContain('inoperative-provision'); // orphaned SNT article

    const summary = summarizeFindings(findings);
    expect(summary.total).toBe(findings.length);
    expect(summary.high).toBeGreaterThan(0);
    expect(summary.medium).toBeGreaterThan(0);
  });

  it('reports a section citation for a located finding', () => {
    const findings = reviewPackage([
      doc(
        'will',
        `<h3>Section 5.02</h3>
         <p>To a custodian under the New Jersey Uniform Transfers to Minors Act until the
         beneficiary reaches 25 years of age.</p>`,
      ),
    ]);
    expect(findings[0].location).toBe('Section 5.02');
  });
});

describe('summarizeFindings', () => {
  it('counts an empty review as zero across the board', () => {
    expect(summarizeFindings([])).toEqual({ total: 0, high: 0, medium: 0, low: 0 });
  });
});

describe('locateSection — letterhead is not a heading', () => {
  it('skips an address block and reports the real section', () => {
    const t = [
      'ELIAS COUNSEL LLC',
      '168 PROSPECT PLAINS ROAD, MONROE TOWNSHIP, NEW JERSEY 08831',
      'A provision about custodial property follows here.',
    ].join('\n');
    expect(locateSection(t, t.indexOf('A provision'))).toBe('Elias Counsel Llc');
  });
});
