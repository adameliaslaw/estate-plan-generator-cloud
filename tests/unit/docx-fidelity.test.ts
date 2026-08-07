/**
 * tests/unit/docx-fidelity.test.ts
 *
 * High-fidelity DOCX fill: builds a real (minimal) .docx in memory with
 * PizZip, fills it with fillDocxTemplate, and verifies substitution,
 * missing-tag reporting, and that the output is still a valid .docx zip.
 */

import { describe, expect, it } from 'vitest';
import PizZip from '../../functions/node_modules/pizzip';
import {
  buildDocxTemplateData,
  fillDocxTemplate,
} from '../../functions/src/docx-fidelity';
import type { ClientContext } from '../../functions/src/client-context-aggregator';

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

describe('fillDocxTemplate', () => {
  it('substitutes {{placeholders}} while keeping a valid docx structure', () => {
    const template = buildFixtureDocx(
      'I, {{clientFullName}}, of {{clientCity}}, appoint {{poaAgentName}} as my Agent.',
    );
    const { buffer, missingTags } = fillDocxTemplate(template, {
      clientFullName: 'Daniel Robert Carter',
      clientCity: 'Cherry Hill',
      poaAgentName: 'Maria Elena Carter',
    });
    const xml = extractDocumentXml(buffer);
    expect(xml).toContain('Daniel Robert Carter');
    expect(xml).toContain('Cherry Hill');
    expect(xml).toContain('Maria Elena Carter');
    expect(xml).not.toContain('{{');
    expect(missingTags).toEqual([]);
    // Zip integrity: required parts survive the round trip.
    const zip = new PizZip(buffer);
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
    expect(zip.file('_rels/.rels')).toBeTruthy();
  });

  it('renders missing placeholders blank and reports them', () => {
    const template = buildFixtureDocx(
      'Executor: {{executorName}}; Guardian: {{guardianName}}.',
    );
    const { buffer, missingTags } = fillDocxTemplate(template, {
      executorName: 'Maria Elena Carter',
    });
    const xml = extractDocumentXml(buffer);
    expect(xml).toContain('Executor: Maria Elena Carter; Guardian: .');
    expect(missingTags).toEqual(['guardianName']);
  });

  it('throws a descriptive error for malformed templates', () => {
    const template = buildFixtureDocx('Broken {{unclosed tag');
    expect(() => fillDocxTemplate(template, {})).toThrow();
  });
});

describe('buildDocxTemplateData', () => {
  it('maps ClientContext into the documented placeholder contract', () => {
    const ctx = {
      client: {
        personalInfo: {
          address: '48 Winding Brook Lane',
          city: 'Cherry Hill',
          county: 'Camden',
          state: 'NJ',
          zip: '08034',
          dob: '1968-04-12',
          maritalStatus: 'Married',
        },
        children: [
          { firstName: 'Sophia', lastName: 'Carter' },
          { firstName: 'Lucas', lastName: 'Carter' },
        ],
        fiduciaries: {
          executor: { primary: { name: 'Maria Elena Carter' } },
          powerOfAttorney: { agent: { name: 'Maria Elena Carter' } },
          guardian: { primary: { name: 'Peter Carter' } },
          healthcareProxy: { primary: { name: 'Maria Elena Carter' } },
          trustee: {},
        },
        assets: { bankAccounts: [{ estimatedBalance: 1000 }] },
      },
      firm: { name: 'Adam Elias Law LLC', attorneyName: 'Adam Elias' },
      computed: {
        clientFullName: 'Daniel Robert Carter',
        spouseFullName: 'Maria Elena Carter',
        childCount: 2,
        hasMinorChildren: true,
        todayFormatted: 'July 26, 2026',
        todayISO: '2026-07-26',
      },
      notes: [],
      existingDocuments: [],
      knowledgeResources: [],
    } as unknown as ClientContext;

    const data = buildDocxTemplateData(ctx);
    expect(data.clientFullName).toBe('Daniel Robert Carter');
    expect(data.clientCounty).toBe('Camden');
    expect(data.executorName).toBe('Maria Elena Carter');
    expect(data.guardianName).toBe('Peter Carter');
    expect(data.poaAgentName).toBe('Maria Elena Carter');
    expect(data.childrenNames).toBe('Sophia Carter, Lucas Carter');
    expect(data.estimatedTotalAssets).toBe(1000);
    expect(data.firmName).toBe('Adam Elias Law LLC');
  });

  it('exposes each fiduciary\'s own relationship and address', () => {
    // The templates render "I appoint my {{executorRelation}}, {{executorName}},
    // of {{executorAddress}}" — an executor who is not the spouse and does not
    // live with the client is the case that breaks when these are missing.
    const ctx = {
      client: {
        personalInfo: { address: '8 Larch Way', city: 'Cherry Hill', state: 'NJ' },
        fiduciaries: {
          executor: {
            primary: {
              name: 'Margaret Vance',
              relationship: 'Daughter',
              address: '3 Oak Lane',
              city: 'Trenton',
              state: 'New Jersey',
            },
            alternate: { name: 'Paul Reyes', relationship: 'Friend' },
            successor: { name: 'Nina Okafor', relationship: 'Niece' },
          },
          powerOfAttorney: {
            agent: { name: 'Margaret Vance', relationship: 'Daughter' },
            successorAgent: { name: 'Paul Reyes', relationship: 'Friend' },
          },
          healthcareProxy: {
            agent: { name: 'Margaret Vance', relationship: 'Daughter' },
            alternateAgent: { name: 'Nina Okafor', relationship: 'Niece' },
          },
        },
      },
      firm: {},
      computed: {
        clientFullName: 'Daniel Carter',
        spouseTitle: 'wife',
        spousePronouns: { subject: 'she', object: 'her', possessive: 'her' },
      },
      notes: [],
      existingDocuments: [],
      knowledgeResources: [],
    } as unknown as ClientContext;

    const data = buildDocxTemplateData(ctx);
    // Lowercased, so a document cannot read "my Daughter" in one article and
    // "my daughter" in the next.
    expect(data.executorRelation).toBe('daughter');
    expect(data.alternateExecutorRelation).toBe('friend');
    expect(data.executorAddress).toBe('3 Oak Lane, Trenton, New Jersey');
    // The third executor level in the sample will has no slot in the model.
    expect(data.secondAlternateExecutorName).toBe('Nina Okafor');
    expect(data.thirdAlternateExecutorName).toBeUndefined();
    expect(data.poaSecondAlternateAgentName).toBe('Paul Reyes');
    expect(data.healthcareAlternateAgentName).toBe('Nina Okafor');
    // Spouse's defined term and pronoun, shared with the .hbs path.
    expect(data.spouseRelation).toBe('wife');
    expect(data.spouseRelationCapitalized).toBe('Wife');
    expect(data.spousePronounObject).toBe('her');
  });

  it('exposes the co-appointee and funeral-representative slots', () => {
    // Two people in one slot ("my parents, A and B, as guardians") and the
    // N.J.S.A. 45:27-22 appointment, which had no field at all and left the
    // article rendering "I appoint , to act as my representative".
    const ctx = {
      client: {
        personalInfo: {},
        fiduciaries: {
          executor: { primary: { name: 'A' } },
          guardian: {
            primary: { name: 'Ruth Vance', relationship: 'Mother' },
            coGuardian: { name: 'Alan Vance', relationship: 'Father' },
            alternate: { name: 'Kim Osei', relationship: 'Sister' },
            coAlternate: { name: 'Tomas Osei', relationship: 'Brother-in-law' },
          },
          trustee: {
            primary: { name: 'Ruth Vance' },
            coTrustee: { name: 'Alan Vance' },
          },
          funeralRepresentative: {
            primary: { name: 'Ruth Vance', relationship: 'Mother' },
            alternate: { name: 'Kim Osei', relationship: 'Sister' },
          },
        },
      },
      firm: {},
      computed: { clientFullName: 'Client', spouseTitle: '', spousePronouns: undefined },
      notes: [],
      existingDocuments: [],
      knowledgeResources: [],
    } as unknown as ClientContext;

    const data = buildDocxTemplateData(ctx);
    expect(data.coGuardianName).toBe('Alan Vance');
    expect(data.coAlternateGuardianName).toBe('Tomas Osei');
    expect(data.coGuardianRelation).toBe('father');
    expect(data.coTrusteeName).toBe('Alan Vance');
    expect(data.funeralRepresentativeName).toBe('Ruth Vance');
    expect(data.successorFuneralRepresentativeName).toBe('Kim Osei');
    expect(data.funeralRepresentativeRelation).toBe('mother');
  });

  it('reads guardians from the top-level slot the questionnaire writes', () => {
    // children_guardian writes guardianPrimary / guardianCoPrimary at the top
    // level, not under fiduciaries.guardian. Reading only the nested slot left
    // {{guardianName}} blank for every questionnaire-collected guardian.
    const ctx = {
      client: {
        personalInfo: {},
        fiduciaries: { executor: { primary: { name: 'A' } } },
        guardianPrimary: { name: 'Ruth Vance', relationship: 'Mother' },
        guardianCoPrimary: { name: 'Alan Vance', relationship: 'Father' },
        guardianAlternate: { name: 'Kim Osei', relationship: 'Sister' },
        guardianCoAlternate: { name: 'Tomas Osei', relationship: 'Brother-in-law' },
        funeralWishes: 'To be buried at sea.',
      },
      firm: {},
      computed: { clientFullName: 'Client', spouseTitle: '', spousePronouns: undefined },
      notes: [],
      existingDocuments: [],
      knowledgeResources: [],
    } as unknown as ClientContext;

    const data = buildDocxTemplateData(ctx);
    expect(data.guardianName).toBe('Ruth Vance');
    expect(data.coGuardianName).toBe('Alan Vance');
    expect(data.alternateGuardianName).toBe('Kim Osei');
    expect(data.coAlternateGuardianName).toBe('Tomas Osei');
    expect(data.guardianRelation).toBe('mother');
    expect(data.funeralWishes).toBe('To be buried at sea.');
  });

  it('prefers the nested fiduciaries.guardian slot when both are present', () => {
    const ctx = {
      client: {
        personalInfo: {},
        fiduciaries: {
          executor: { primary: { name: 'A' } },
          guardian: { primary: { name: 'Nested Guardian' } },
        },
        guardianPrimary: { name: 'Top Level Guardian' },
      },
      firm: {},
      computed: { clientFullName: 'Client', spouseTitle: '', spousePronouns: undefined },
      notes: [],
      existingDocuments: [],
      knowledgeResources: [],
    } as unknown as ClientContext;

    expect(buildDocxTemplateData(ctx).guardianName).toBe('Nested Guardian');
  });

  it('returns an empty relation rather than a partial address when unset', () => {
    const ctx = {
      client: { personalInfo: {}, fiduciaries: { executor: { primary: { name: 'A' } } } },
      firm: {},
      computed: { clientFullName: 'A', spouseTitle: '', spousePronouns: undefined },
      notes: [],
      existingDocuments: [],
      knowledgeResources: [],
    } as unknown as ClientContext;

    const data = buildDocxTemplateData(ctx);
    // Blank, so {{#executorRelation}} omits the phrase instead of the
    // template printing "I appoint my , A".
    expect(data.executorRelation).toBe('');
    expect(data.executorAddress).toBe('');
    expect(data.spouseRelationCapitalized).toBe('');
    expect(data.spousePronounObject).toBe('them');
  });
});
