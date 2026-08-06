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

// ---------------------------------------------------------------------------
// Roster-driven checks — name collision and dropped generational suffix
// ---------------------------------------------------------------------------

import { normalizeName, splitSuffix, type PackageContext } from '../../functions/src/package-review';
import { buildPackageContext, personName } from '../../functions/src/package-review-roster';
import { renderApportionmentClause } from '../../functions/src/nj-inheritance-tax';

describe('name utilities', () => {
  it('normalizes case, punctuation, and spacing', () => {
    expect(normalizeName('  Constantine   RIOS,  Jr. ')).toBe('constantine rios jr');
  });

  it('splits a trailing generational suffix off the base name', () => {
    expect(splitSuffix('Constantine Rios Jr.')).toEqual({ base: 'constantine rios', suffix: 'jr' });
    expect(splitSuffix('Howard Moore III')).toEqual({ base: 'howard moore', suffix: 'iii' });
  });

  it('does not treat a middle initial as a suffix', () => {
    // "V" is a valid suffix token, but only as the trailing one.
    expect(splitSuffix('Adam V. Elias')).toEqual({ base: 'adam v elias' });
    expect(splitSuffix('Adam Elias V')).toEqual({ base: 'adam elias', suffix: 'v' });
  });
});

describe('name-collision', () => {
  const ROSTER: PackageContext = {
    people: [
      { name: 'Constantine Rios', role: 'client', label: 'settlor' },
      { name: 'Denissie Rios', role: 'spouse', label: 'spouse' },
      { name: 'Constantine Rios', role: 'child', label: 'child' },
      { name: 'Dominick Rios', role: 'child', label: 'child' },
    ],
  };

  const TRUST = doc(
    'trust',
    `<h2>DISPOSITION</h2>
     <p>The trustee shall distribute 33.3% of the final trust estate to a separate trust for
     CONSTANTINE RIOS. When CONSTANTINE RIOS reaches 40 years of age, they shall become
     vested in the entire principal.</p>`,
    'The Rios Family Living Trust',
  );

  it('flags a beneficiary whose full name equals the settlor\'s', () => {
    const hits = reviewPackage([TRUST], ROSTER).filter((f) => f.reason === 'name-collision');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('high');
    expect(hits[0].summary).toContain('settlor');
    expect(hits[0].summary).toContain('child');
  });

  it('reports one finding per collision, not one per document', () => {
    const hits = reviewPackage([TRUST, { ...TRUST, docType: 'pourOverWill' }], ROSTER)
      .filter((f) => f.reason === 'name-collision');
    expect(hits).toHaveLength(1);
    expect(hits[0].detail).toMatch(/2 documents overall/);
  });

  it('locates a collision honestly rather than defaulting to a stock label', () => {
    const once = reviewPackage(
      [doc('trust', '<h3>Section 4.02</h3><p>A share for CONSTANTINE RIOS.</p>')],
      ROSTER,
    ).filter((f) => f.reason === 'name-collision');
    expect(once[0].location).toBe('Section 4.02');

    const pervasive = doc('trust', '<p>CONSTANTINE RIOS shall take. </p>'.repeat(6));
    const many = reviewPackage([pervasive], ROSTER).filter((f) => f.reason === 'name-collision');
    expect(many[0].location).toBe('Throughout');
  });

  it('stays silent once the suffix distinguishes them', () => {
    const fixed: PackageContext = {
      people: ROSTER.people.map((p) =>
        p.role === 'child' && p.name === 'Constantine Rios' ? { ...p, name: 'Constantine Rios Jr.' } : p,
      ),
    };
    expect(reviewPackage([TRUST], fixed).filter((f) => f.reason === 'name-collision')).toHaveLength(0);
  });

  it('does not flag one person holding several fiduciary roles', () => {
    // The spouse is routinely also the executor and the POA agent. That is one
    // person in three roles, not three people sharing a name.
    const ctx: PackageContext = {
      people: [
        { name: 'Adam Elias', role: 'client', label: 'testator' },
        { name: 'Karen Elias', role: 'spouse', label: 'spouse' },
        { name: 'Karen Elias', role: 'fiduciary', label: 'executor' },
        { name: 'Karen Elias', role: 'fiduciary', label: 'power of attorney' },
      ],
    };
    const docs = [doc('will', '<p>I appoint KAREN ELIAS as my executor.</p>')];
    expect(reviewPackage(docs, ctx).filter((f) => f.reason === 'name-collision')).toHaveLength(0);
  });

  it('stays silent when the shared name never appears in any document', () => {
    const docs = [doc('poa', '<p>I appoint an agent to act for me.</p>')];
    expect(reviewPackage(docs, ROSTER).filter((f) => f.reason === 'name-collision')).toHaveLength(0);
  });

  it('runs no roster checks at all without a roster', () => {
    const all = reviewPackage([TRUST]);
    expect(all.filter((f) => f.reason === 'name-collision')).toHaveLength(0);
    expect(all.filter((f) => f.reason === 'suffix-dropped')).toHaveLength(0);
  });
});

describe('suffix-dropped', () => {
  const ROSTER: PackageContext = {
    people: [
      { name: 'Constantine Rios', role: 'client', label: 'settlor' },
      { name: 'Constantine Rios Jr.', role: 'child', label: 'child' },
    ],
  };

  it('flags a bare reference that collides with another person, at high severity', () => {
    const hits = reviewPackage(
      [doc('trust', '<p>A share for CONSTANTINE RIOS, to vest at 40.</p>', 'Rios Trust')],
      ROSTER,
    ).filter((f) => f.reason === 'suffix-dropped');

    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('high');
    expect(hits[0].detail).toMatch(/ambiguous between two people/);
  });

  it('does not count the correctly suffixed name as a dropped reference', () => {
    const hits = reviewPackage(
      [doc('trust', '<p>A share for CONSTANTINE RIOS JR., to vest at 40.</p>')],
      ROSTER,
    ).filter((f) => f.reason === 'suffix-dropped');
    expect(hits).toHaveLength(0);
  });

  it('tolerates the punctuation and spacing rendering introduces', () => {
    const hits = reviewPackage(
      [doc('trust', '<p>A share for Constantine\n  Rios,  Jr. shall vest at 40.</p>')],
      ROSTER,
    ).filter((f) => f.reason === 'suffix-dropped');
    expect(hits).toHaveLength(0);
  });

  it('treats a harmless inconsistency as low severity', () => {
    const ctx: PackageContext = {
      people: [
        { name: 'Adam Elias', role: 'client', label: 'testator' },
        { name: 'Howard Moore III', role: 'fiduciary', label: 'executor' },
      ],
    };
    const hits = reviewPackage(
      [doc('will', '<p>I appoint HOWARD MOORE as my executor.</p>')],
      ctx,
    ).filter((f) => f.reason === 'suffix-dropped');

    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('low');
    expect(hits[0].summary).toContain('III');
  });

  it('flags a possessive reference, which is still a dropped suffix', () => {
    const hits = reviewPackage(
      [doc('trust', "<p>CONSTANTINE RIOS's share shall be held in trust.</p>")],
      ROSTER,
    ).filter((f) => f.reason === 'suffix-dropped');
    expect(hits).toHaveLength(1);
  });

  it('quotes the name in its original casing, never the normalized form', () => {
    // The normalized string is for comparison only. An attorney reading
    // 'constantine rios' in a finding would take it for a bug.
    const hits = reviewPackage(
      [doc('trust', '<p>A share for CONSTANTINE RIOS, to vest at 40.</p>')],
      ROSTER,
    ).filter((f) => f.reason === 'suffix-dropped');
    expect(hits[0].detail).toContain('"Constantine Rios"');
    expect(hits[0].detail).not.toContain('constantine rios');
  });

  it('says "Throughout" rather than pinpointing a pervasive name', () => {
    // Pinning to whichever heading preceded the first hit — often letterhead —
    // claims a precision the finding does not have.
    const body = '<p>CONSTANTINE RIOS shall take. </p>'.repeat(6);
    const hits = reviewPackage([doc('trust', `<h2>ELIAS COUNSEL LLC</h2>${body}`)], ROSTER)
      .filter((f) => f.reason === 'suffix-dropped');
    expect(hits[0].location).toBe('Throughout');
  });

  it('still pinpoints a section when the name appears only once or twice', () => {
    const hits = reviewPackage(
      [doc('trust', '<h3>Section 4.02</h3><p>A share for CONSTANTINE RIOS.</p>')],
      ROSTER,
    ).filter((f) => f.reason === 'suffix-dropped');
    expect(hits[0].location).toBe('Section 4.02');
  });

  it('says nothing about people whose names carry no suffix', () => {
    const ctx: PackageContext = {
      people: [
        { name: 'Adam Elias', role: 'client' },
        { name: 'Karen Elias', role: 'spouse' },
      ],
    };
    const hits = reviewPackage([doc('will', '<p>I give all to KAREN ELIAS.</p>')], ctx)
      .filter((f) => f.reason === 'suffix-dropped');
    expect(hits).toHaveLength(0);
  });
});

describe('buildPackageContext', () => {
  it('prefers split name parts and includes the suffix', () => {
    expect(personName({ firstName: 'Constantine', lastName: 'Rios', suffix: 'Jr.' }))
      .toBe('Constantine Rios Jr.');
  });

  it('falls back to the legacy joined name for pre-refactor records', () => {
    expect(personName({ name: 'Dominick Rios' })).toBe('Dominick Rios');
  });

  it('collects client, spouse, children, and fiduciaries with readable labels', () => {
    const { people } = buildPackageContext({
      personalInfo: { firstName: 'Constantine', lastName: 'Rios' },
      spouseInfo: { firstName: 'Denissie', lastName: 'Rios' },
      children: [
        { firstName: 'Constantine', lastName: 'Rios', suffix: 'Jr.' },
        { name: 'Dominick Rios' },
      ],
      fiduciaries: { powerOfAttorney: { name: 'Denissie Rios' } },
    });

    expect(people.map((p) => `${p.role}:${p.name}`)).toEqual([
      'client:Constantine Rios',
      'spouse:Denissie Rios',
      'child:Constantine Rios Jr.',
      'child:Dominick Rios',
      'fiduciary:Denissie Rios',
    ]);
    expect(people.find((p) => p.role === 'fiduciary')?.label).toBe('power of attorney');
  });

  it('drops single-token and empty names rather than comparing them', () => {
    const { people } = buildPackageContext({
      personalInfo: { firstName: 'Cher' },
      children: [{ name: '' }, { name: '   ' }],
    });
    expect(people).toEqual([]);
  });

  it('survives a client record with nothing on it', () => {
    expect(buildPackageContext(null).people).toEqual([]);
    expect(buildPackageContext({}).people).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Check — Class C/D beneficiary with no apportionment direction
// ---------------------------------------------------------------------------

describe('missing-apportionment', () => {
  const WITH_NIECE: PackageContext = {
    people: [
      { name: 'Adam Elias', role: 'client', label: 'testator', njTaxClass: 'A' },
      { name: 'Karen Elias', role: 'spouse', label: 'spouse', njTaxClass: 'A', isBeneficiary: true },
      { name: 'Sherif Elias', role: 'fiduciary', label: 'executor', njTaxClass: 'C', isBeneficiary: true },
    ],
  };

  const SILENT_WILL = doc(
    'will',
    '<h2>DEBTS</h2><p>My executor may pay my debts and funeral expenses.</p>',
    'Last Will and Testament',
  );

  it('flags a plan with a Class C taker and no direction', () => {
    const hits = reviewPackage([SILENT_WILL], WITH_NIECE)
      .filter((f) => f.reason === 'missing-apportionment');
    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('medium');
    expect(hits[0].detail).toContain('54:35-6');
    expect(hits[0].detail).toContain('Sherif Elias (Class C)');
  });

  it('stays silent on an all-Class-A plan, where there is no tax to apportion', () => {
    const ctx: PackageContext = {
      people: [
        { name: 'Adam Elias', role: 'client', njTaxClass: 'A' },
        { name: 'Karen Elias', role: 'spouse', njTaxClass: 'A', isBeneficiary: true },
        { name: 'Alina Elias', role: 'child', njTaxClass: 'A', isBeneficiary: true },
      ],
    };
    expect(reviewPackage([SILENT_WILL], ctx).filter((f) => f.reason === 'missing-apportionment'))
      .toHaveLength(0);
  });

  it('stays silent once the document carries an apportionment direction', () => {
    const covered = doc(
      'will',
      renderApportionmentClause({ mode: 'hybrid', instrument: 'will' }),
      'Last Will and Testament',
    );
    expect(reviewPackage([covered], WITH_NIECE).filter((f) => f.reason === 'missing-apportionment'))
      .toHaveLength(0);
  });

  it('accepts traditional boilerplate as a direction, even though we would draft it differently', () => {
    const covered = doc(
      'will',
      '<p>All death taxes shall be paid out of my residuary estate as an expense of administration.</p>',
    );
    expect(reviewPackage([covered], WITH_NIECE).filter((f) => f.reason === 'missing-apportionment'))
      .toHaveLength(0);
  });

  it('does not treat an unclassified relationship as taxable', () => {
    // classifyBeneficiary returns null for anything it does not recognise, and
    // null must never behave like Class D.
    const ctx: PackageContext = {
      people: [
        { name: 'Adam Elias', role: 'client', njTaxClass: 'A' },
        { name: 'Pat Quinn', role: 'fiduciary', label: 'trusted advisor', njTaxClass: null, isBeneficiary: true },
      ],
    };
    expect(reviewPackage([SILENT_WILL], ctx).filter((f) => f.reason === 'missing-apportionment'))
      .toHaveLength(0);
  });

  it('ignores non-dispositive documents, which cannot carry the direction', () => {
    const poaOnly = [doc('poa', '<p>I appoint an agent.</p>'), doc('hipaaRelease', '<p>Release.</p>')];
    expect(reviewPackage(poaOnly, WITH_NIECE).filter((f) => f.reason === 'missing-apportionment'))
      .toHaveLength(0);
  });

  it('does not fire for a Class C person who takes nothing', () => {
    const ctx: PackageContext = {
      people: [
        { name: 'Adam Elias', role: 'client', njTaxClass: 'A' },
        // Named executor but not a beneficiary — serving is not inheriting.
        { name: 'Sherif Elias', role: 'fiduciary', label: 'executor', njTaxClass: 'C' },
      ],
    };
    expect(reviewPackage([SILENT_WILL], ctx).filter((f) => f.reason === 'missing-apportionment'))
      .toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Check — contents page that promises sections the document lacks
// ---------------------------------------------------------------------------

describe('toc-mismatch', () => {
  const toc = (titles: string[]) =>
    titles.map((t, i) => `<p>1.${String(i + 1).padStart(2, '0')} ${t}</p>`).join('');
  const body = (titles: string[]) =>
    titles.map((t) => `<h3>${t}</h3><p>${'Operative provision text. '.repeat(20)}</p>`).join('');

  const LISTED = [
    'Opening Declaration', 'Family', 'Trust Estate', 'Successor Trustees',
    'Waiver of Bond', 'Trustee Powers', 'Marital Trust', 'Bypass Trust',
    'Disclaimer Trust', 'Family Pot Trust',
  ];
  const PRESENT = LISTED.slice(0, 6);

  it('flags a contents page listing sections that appear nowhere in the body', () => {
    const hits = reviewPackage([doc('trust', toc(LISTED) + body(PRESENT), 'The Family Trust')])
      .filter((f) => f.reason === 'toc-mismatch');

    expect(hits).toHaveLength(1);
    expect(hits[0].severity).toBe('medium');
    expect(hits[0].location).toBe('Table of Contents');
    expect(hits[0].summary).toContain('4 section(s)');
    expect(hits[0].detail).toContain('Marital Trust');
  });

  it('stays silent when the contents page matches the document', () => {
    const hits = reviewPackage([doc('trust', toc(PRESENT) + body(PRESENT))])
      .filter((f) => f.reason === 'toc-mismatch');
    expect(hits).toHaveLength(0);
  });

  it('tolerates dot leaders, page numbers, and tab artifacts', () => {
    // Real contents pages carry this debris; the body headings do not. Comparing
    // raw titles reported EVERY entry as missing on both real trusts (78 of 78).
    const noisy = LISTED.map(
      (t, i) => `<p>1.${String(i + 1).padStart(2, '0')} ${t}[ ] ...... ${i + 3}</p>`,
    ).join('');
    const hits = reviewPackage([doc('trust', noisy + body(LISTED))])
      .filter((f) => f.reason === 'toc-mismatch');
    expect(hits).toHaveLength(0);
  });

  it('ignores a document with no contents page', () => {
    const hits = reviewPackage([doc('will', body(PRESENT))])
      .filter((f) => f.reason === 'toc-mismatch');
    expect(hits).toHaveLength(0);
  });

  it('does not treat a couple of reworded headings as a broken contents page', () => {
    // Ordinary drift in how a heading was phrased is not the defect this looks
    // for; a systematically wrong contents page is.
    const hits = reviewPackage([doc('trust', toc(LISTED) + body(LISTED.slice(0, 8)))])
      .filter((f) => f.reason === 'toc-mismatch');
    expect(hits).toHaveLength(0);
  });

  it('needs a real run of numbered lines, not a few numbered paragraphs', () => {
    const few = '<p>1.01 Opening Declaration</p><p>1.02 Family</p>' + body(['Something Else']);
    expect(reviewPackage([doc('trust', few)]).filter((f) => f.reason === 'toc-mismatch'))
      .toHaveLength(0);
  });
});
