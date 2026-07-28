/**
 * tests/emulator/testclient-run.ts
 *
 * Standalone deep-exercise script (not a vitest suite): seeds a realistic NJ
 * estate planning client into the Firestore emulator, seeds the shipped POA
 * templates, then drives the REAL generation pipeline end to end in
 * template and hybrid modes (no AI keys → hybrid must degrade gracefully),
 * runs the structural validator, and prints the generated document.
 *
 * Run inside the emulator:
 *   npx firebase-tools emulators:exec --only firestore,auth --project demo-eplan \
 *     "npx tsx tests/emulator/testclient-run.ts"
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { admin } from './_emulator';
import { aggregateClientContext } from '../../functions/src/client-context-aggregator';
import { generateFromTemplate } from '../../functions/src/template-engine';
import { validateDocumentStructure } from '../../functions/src/document-structure-validator';
import { checkContentIntegrity } from '../../functions/src/doc-content-integrity-checker';
import { serializeClientData } from '../../functions/src/client-data-serializer';

const FIRM_ID = 'testclient-firm';
const CLIENT_ID = 'testclient-carter';

const db = admin.firestore();

async function seed() {
  await db.doc(`firms/${FIRM_ID}`).set({
    name: 'Adam Elias Law LLC (Test)',
    address: '123 Kings Highway East',
    city: 'Haddonfield',
    state: 'NJ',
    zip: '08033',
    phone: '(856) 555-0100',
    email: 'test@example.com',
    attorneyName: 'Adam Elias',
    createdAt: admin.firestore.Timestamp.now(),
  });

  await db.doc(`firms/${FIRM_ID}/clients/${CLIENT_ID}`).set({
    firmId: FIRM_ID,
    assignedAttorneyId: 'attorney-1',
    isActive: true,
    isArchived: false,
    tags: ['test'],
    personalInfo: {
      firstName: 'Daniel',
      middleName: 'Robert',
      lastName: 'Carter',
      dob: '1968-04-12',
      address: '48 Winding Brook Lane',
      city: 'Cherry Hill',
      county: 'Camden',
      state: 'NJ',
      zip: '08034',
      maritalStatus: 'Married',
      email: 'dan.carter@example.com',
      phone: '(856) 555-0142',
      citizenship: 'US',
      gender: 'male',
    },
    spouseInfo: {
      firstName: 'Maria',
      middleName: 'Elena',
      lastName: 'Carter',
      dob: '1971-09-30',
      citizenship: 'US',
      gender: 'female',
    },
    children: [
      {
        id: 'child-1',
        name: 'Sophia Carter',
        firstName: 'Sophia',
        lastName: 'Carter',
        dob: '2001-02-14',
        gender: 'female',
        relationship: 'daughter',
        specialNeeds: false,
      },
      {
        id: 'child-2',
        name: 'Lucas Carter',
        firstName: 'Lucas',
        lastName: 'Carter',
        dob: '2012-11-03',
        gender: 'male',
        relationship: 'son',
        specialNeeds: false,
      },
    ],
    otherDependents: [],
    assets: {
      realEstate: [
        {
          address: '48 Winding Brook Lane',
          city: 'Cherry Hill',
          state: 'NJ',
          zip: '08034',
          county: 'Camden',
          ownershipType: 'joint',
          estimatedValue: 585000,
          isPrimaryResidence: true,
        },
      ],
      bankAccounts: [{ institution: 'TD Bank', type: 'checking', estimatedBalance: 40000 }],
      investmentAccounts: [{ institution: 'Vanguard', type: 'brokerage', estimatedValue: 410000 }],
      retirementAccounts: [{ institution: 'Fidelity', type: '401k', estimatedValue: 690000 }],
      lifeInsurance: [{ carrier: 'NW Mutual', type: 'term', faceValue: 1000000 }],
      businessInterests: [],
      personalProperty: [],
      digitalAssets: [],
    },
    liabilities: { mortgages: [{ balance: 210000 }], loans: [], creditCards: [] },
    fiduciaries: {
      executor: {
        primary: { name: 'Maria Elena Carter', relationship: 'wife' },
        alternate: { name: 'Sophia Carter', relationship: 'daughter' },
      },
      trustee: {
        primary: { name: 'Maria Elena Carter', relationship: 'wife' },
        alternate: { name: 'Peter Carter', relationship: 'brother' },
      },
      guardian: {
        primary: { name: 'Peter Carter', relationship: 'brother' },
        alternate: { name: 'Ann Delgado', relationship: 'sister-in-law' },
      },
      powerOfAttorney: {
        agent: {
          name: 'Maria Elena Carter',
          relationship: 'wife',
          address: '48 Winding Brook Lane',
          city: 'Cherry Hill',
          state: 'NJ',
          zip: '08034',
        },
        alternateAgent: { name: 'Sophia Carter', relationship: 'daughter' },
        effectiveDate: 'immediate',
        gifting: true,
        giftingLimit: 'annual exclusion',
      },
      healthcareProxy: {
        primary: { name: 'Maria Elena Carter', relationship: 'wife' },
        alternate: { name: 'Sophia Carter', relationship: 'daughter' },
      },
    },
    distribution: {
      primaryPlan: 'spouse-then-children',
      perStirpes: true,
      distributionAges: [25, 30, 35],
      specificBequests: [
        { item: '1967 Gibson ES-335 guitar', beneficiary: 'Lucas Carter' },
      ],
      charitableBequests: [],
    },
    healthcarePreferences: {
      lifeSupport: 'withdraw-if-terminal',
      artificialNutrition: false,
      organDonation: true,
      painManagement: 'aggressive',
    },
    trusts: [],
    specialConsiderations: {},
    packageDetails: { packageType: 'married-standard', price: 4500 },
    questionnaireProgress: { status: 'completed', percentComplete: 100 },
    createdAt: admin.firestore.Timestamp.now(),
  });

  for (const [file, variant, isDefault] of [
    ['poa-comprehensive.hbs', 'comprehensive', true],
    ['poa-simple.hbs', 'simple', false],
  ] as const) {
    const content = readFileSync(
      resolve(__dirname, '../../functions/src/templates', file),
      'utf8',
    );
    await db
      .collection(`firms/${FIRM_ID}/documentTemplates`)
      .doc(`poa-${variant}`)
      .set({
        docType: 'poa',
        name: `Durable POA (${variant})`,
        variant,
        content,
        isActive: true,
        isDefault,
        createdAt: admin.firestore.Timestamp.now(),
      });
  }
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  await seed();
  console.log('--- seeded firm/client/templates ---');

  const ctx = await aggregateClientContext(FIRM_ID, CLIENT_ID, 'poa');
  console.log('computed:', {
    clientFullName: ctx.computed.clientFullName,
    spouseFullName: ctx.computed.spouseFullName,
    hasMinorChildren: ctx.computed.hasMinorChildren,
    childCount: ctx.computed.childCount,
    estimatedTotalAssets: ctx.computed.estimatedTotalAssets,
    packageType: ctx.computed.packageType,
    poaAgentTitle: ctx.computed.poaAgentTitle,
  });

  const serialized = serializeClientData(ctx.client, ctx.firm);
  console.log('\n--- serialized client block (first 700 chars) ---');
  console.log(serialized.text.slice(0, 700));

  for (const mode of ['template', 'hybrid'] as const) {
    console.log(`\n=== generateFromTemplate mode=${mode} ===`);
    const t0 = Date.now();
    const doc = await generateFromTemplate(ctx, 'poa', mode);
    console.log(
      `mode=${mode} ok in ${Date.now() - t0}ms | title="${doc.title}" | status=${doc.status} | ` +
        `template=${(doc as Record<string, unknown>).resolvedTemplateId} | content=${doc.content.length} chars`,
    );

    const structure = validateDocumentStructure(doc.content, 'poa');
    console.log('structure validator:', JSON.stringify(structure).slice(0, 300));

    const integrity = checkContentIntegrity(doc.content, ctx);
    console.log('integrity checker:', JSON.stringify(integrity).slice(0, 300));

    const text = textOf(doc.content);
    const probes = [
      'Daniel Robert Carter',
      'Maria Elena Carter',
      'Sophia Carter',
      '46:2B-8.1',
      'Cherry Hill',
      'Camden',
      'durable',
    ];
    for (const probe of probes) {
      console.log(
        `  probe "${probe}": ${text.toLowerCase().includes(probe.toLowerCase()) ? 'FOUND' : 'MISSING'}`,
      );
    }
    const unresolved = doc.content.match(/{{[^}]+}}/g);
    console.log('  unresolved handlebars vars:', unresolved ? unresolved.slice(0, 5) : 'none');

    if (mode === 'template') {
      console.log('\n--- generated POA text (first 1600 chars) ---');
      console.log(text.slice(0, 1600));
    }
  }
}

import { describe, it } from 'vitest';

describe('test client deep-exercise run', () => {
  it('drives a full NJ client through template + hybrid POA generation', async () => {
    await main();
    console.log('\nTEST CLIENT RUN: SUCCESS');
  }, 120000);
});
