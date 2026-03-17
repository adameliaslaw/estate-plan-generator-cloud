#!/usr/bin/env ts-node
/**
 * NJ Estate Plan Generator — Firestore Test Data Seeder
 * Elias Counsel, LLC
 *
 * Seeds Firestore with realistic NJ-specific test data for local development
 * and emulator testing.
 *
 * Usage:
 *   npx ts-node scripts/seed-test-data.ts
 *
 * Requires FIRESTORE_EMULATOR_HOST to be set when targeting the emulator, e.g.:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npx ts-node scripts/seed-test-data.ts
 */

import admin from 'firebase-admin';

// Initialize Firebase Admin globally
admin.initializeApp();
// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log(`Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  admin.app().options.projectId = 'nj-estate-plan-dev'; // Set project ID for emulator
} else {
  admin.initializeApp(); // uses GOOGLE_APPLICATION_CREDENTIALS / ADC
}

const db = admin.firestore();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Address {
  street: string;
  city: string;
  state: 'NJ';
  zip: string;
  county: string;
}

interface Person {
  firstName: string;
  lastName: string;
  dateOfBirth: string; // ISO
  email: string;
  phone: string;
  address: Address;
  ssn?: string; // last 4 only for test data
}

interface Property {
  description: string;
  address: Address;
  block: string;
  lot: string;
  deedBook: string;
  deedPage: string;
  estimatedValue: number;
  mortgage: boolean;
  mortgageBalance?: number;
  mortgageLender?: string;
}

interface Fiduciaries {
  executor: { primary: string; alternate: string };
  trustee?: { primary: string; alternate: string };
  guardian?: { primary: string; alternate: string };
  healthcareProxy: { primary: string; alternate: string };
  financialPoa: { primary: string; alternate: string };
}

interface ClientData {
  clientId: string;
  firmId: string;
  status: string;
  package: string;
  maritalStatus: 'single' | 'married';
  client1: Person;
  client2?: Person;
  children?: Array<{ firstName: string; lastName: string; dateOfBirth: string; minor: boolean }>;
  properties?: Property[];
  fiduciaries: Fiduciaries;
  healthcareDirectives: {
    livingWill: boolean;
    dnr: boolean;
    organDonor: boolean;
    specificInstructions?: string;
  };
  trustFunding?: {
    assets: Array<{ description: string; estimatedValue: number; type: string }>;
    distributionSchedule?: Array<{ age: number; percentage: number }>;
  };
  notes?: string;
  createdAt: admin.firestore.FieldValue;
  updatedAt: admin.firestore.FieldValue;
}

// ---------------------------------------------------------------------------
// Test data definitions
// ---------------------------------------------------------------------------

const FIRM_ID = 'test-firm';
const NOW = admin.firestore.FieldValue.serverTimestamp();

// ── Scenario A: Single, no children (Basic Estate Plan) ──────────────────
const scenarioA: ClientData = {
  clientId: 'test-single-no-children',
  firmId: FIRM_ID,
  status: 'intake',
  package: 'foundation',
  maritalStatus: 'single',
  client1: {
    firstName: 'Margaret',
    lastName: 'Holloway',
    dateOfBirth: '1968-04-15',
    email: 'margaret.holloway.test@example.com',
    phone: '(609) 555-0142',
    address: {
      street: '47 Mercer Street',
      city: 'Princeton',
      state: 'NJ',
      zip: '08540',
      county: 'Mercer',
    },
    ssn: '3391',
  },
  fiduciaries: {
    executor: {
      primary: 'Robert Holloway (Brother), 12 Oak Lane, Lawrenceville, NJ 08648',
      alternate: 'Susan Park (Friend), 88 Nassau Street, Princeton, NJ 08542',
    },
    healthcareProxy: {
      primary: 'Robert Holloway (Brother)',
      alternate: 'Susan Park (Friend)',
    },
    financialPoa: {
      primary: 'Robert Holloway (Brother)',
      alternate: 'Susan Park (Friend)',
    },
  },
  healthcareDirectives: {
    livingWill: true,
    dnr: false,
    organDonor: true,
    specificInstructions:
      'If in a persistent vegetative state with no reasonable chance of recovery, I do not wish to have artificial life support continued.',
  },
  notes: 'Client owns a condo in Princeton. Beneficiaries: 50% to brother Robert, 50% to Princeton Area Community Foundation.',
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Scenario B: Single, 2 children (Revocable Trust) ─────────────────────
const scenarioB: ClientData = {
  clientId: 'test-single-with-children',
  firmId: FIRM_ID,
  status: 'documents-drafted',
  package: 'guardian',
  maritalStatus: 'single',
  client1: {
    firstName: 'Darnell',
    lastName: 'Washington',
    dateOfBirth: '1981-09-22',
    email: 'darnell.washington.test@example.com',
    phone: '(732) 555-0283',
    address: {
      street: '215 Broad Street',
      city: 'Red Bank',
      state: 'NJ',
      zip: '07701',
      county: 'Monmouth',
    },
    ssn: '7714',
  },
  children: [
    { firstName: 'Aaliyah', lastName: 'Washington', dateOfBirth: '2015-03-10', minor: true },
    { firstName: 'Marcus', lastName: 'Washington', dateOfBirth: '2018-07-04', minor: true },
  ],
  fiduciaries: {
    executor: {
      primary: 'Patricia Washington (Mother), 44 Elm Avenue, Asbury Park, NJ 07712',
      alternate: 'James Carter (Brother), 19 Shore Drive, Long Branch, NJ 07740',
    },
    guardian: {
      primary: 'Patricia Washington (Maternal Grandmother)',
      alternate: 'James Carter (Paternal Uncle)',
    },
    healthcareProxy: {
      primary: 'Patricia Washington (Mother)',
      alternate: 'James Carter (Brother)',
    },
    financialPoa: {
      primary: 'Patricia Washington (Mother)',
      alternate: 'James Carter (Brother)',
    },
  },
  healthcareDirectives: {
    livingWill: true,
    dnr: false,
    organDonor: true,
    specificInstructions:
      'I wish to receive all reasonable medical treatment until there is no reasonable medical probability of recovery.',
  },
  notes: 'Client is primary caregiver for two minor children. Guardian nomination is critical. Trust for minors to distribute at ages 25 and 30.',
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Scenario C: Married, no children (Basic Estate Plan) ─────────────────
const scenarioC: ClientData = {
  clientId: 'test-married-no-children',
  firmId: FIRM_ID,
  status: 'pending-signing',
  package: 'foundation',
  maritalStatus: 'married',
  client1: {
    firstName: 'Thomas',
    lastName: 'Brennan',
    dateOfBirth: '1972-11-08',
    email: 'thomas.brennan.test@example.com',
    phone: '(848) 555-0397',
    address: {
      street: '8 Colonial Drive',
      city: 'Flemington',
      state: 'NJ',
      zip: '08822',
      county: 'Hunterdon',
    },
    ssn: '5528',
  },
  client2: {
    firstName: 'Claire',
    lastName: 'Brennan',
    dateOfBirth: '1974-02-19',
    email: 'claire.brennan.test@example.com',
    phone: '(908) 555-0461',
    address: {
      street: '8 Colonial Drive',
      city: 'Flemington',
      state: 'NJ',
      zip: '08822',
      county: 'Hunterdon',
    },
    ssn: '9903',
  },
  properties: [
    {
      description: 'Primary residence — single-family home',
      address: {
        street: '8 Colonial Drive',
        city: 'Flemington',
        state: 'NJ',
        zip: '08822',
        county: 'Hunterdon',
      },
      block: '42',
      lot: '7',
      deedBook: 'OR 891',
      deedPage: '214',
      estimatedValue: 485000,
      mortgage: true,
      mortgageBalance: 212000,
      mortgageLender: 'Provident Bank',
    },
  ],
  fiduciaries: {
    executor: {
      primary: 'Surviving Spouse',
      alternate: 'Kevin Brennan (Brother of Thomas), 33 Raritan Road, Somerville, NJ 08876',
    },
    healthcareProxy: {
      primary: 'Spouse',
      alternate: 'Kevin Brennan (Brother)',
    },
    financialPoa: {
      primary: 'Spouse',
      alternate: 'Kevin Brennan (Brother)',
    },
  },
  healthcareDirectives: {
    livingWill: true,
    dnr: false,
    organDonor: false,
  },
  notes: 'Mutual wills with pour-over provisions. Residuary estate passes outright to surviving spouse, then equally to siblings.',
  createdAt: NOW,
  updatedAt: NOW,
};

// ── Scenario D: Married, 3 children (Irrevocable Trust) ──────────────────
const scenarioD: ClientData = {
  clientId: 'test-married-with-children',
  firmId: FIRM_ID,
  status: 'active',
  package: 'fortress',
  maritalStatus: 'married',
  client1: {
    firstName: 'Sophia',
    lastName: 'Deluca',
    dateOfBirth: '1975-06-30',
    email: 'sophia.deluca.test@example.com',
    phone: '(732) 555-0512',
    address: {
      street: '14 Birchwood Terrace',
      city: 'Metuchen',
      state: 'NJ',
      zip: '08840',
      county: 'Middlesex',
    },
    ssn: '2247',
  },
  client2: {
    firstName: 'Vincent',
    lastName: 'Deluca',
    dateOfBirth: '1973-03-14',
    email: 'vincent.deluca.test@example.com',
    phone: '(732) 555-0513',
    address: {
      street: '14 Birchwood Terrace',
      city: 'Metuchen',
      state: 'NJ',
      zip: '08840',
      county: 'Middlesex',
    },
    ssn: '6681',
  },
  children: [
    { firstName: 'Isabella', lastName: 'Deluca', dateOfBirth: '2005-08-12', minor: true },
    { firstName: 'Nicholas', lastName: 'Deluca', dateOfBirth: '2008-01-27', minor: true },
    { firstName: 'Olivia', lastName: 'Deluca', dateOfBirth: '2011-11-03', minor: true },
  ],
  properties: [
    {
      description: 'Primary residence — colonial, 4BR/2.5BA',
      address: {
        street: '14 Birchwood Terrace',
        city: 'Metuchen',
        state: 'NJ',
        zip: '08840',
        county: 'Middlesex',
      },
      block: '118',
      lot: '22',
      deedBook: 'OR 4412',
      deedPage: '087',
      estimatedValue: 725000,
      mortgage: true,
      mortgageBalance: 310000,
      mortgageLender: 'TD Bank',
    },
    {
      description: 'Rental property — duplex',
      address: {
        street: '302 Amboy Avenue',
        city: 'Perth Amboy',
        state: 'NJ',
        zip: '08861',
        county: 'Middlesex',
      },
      block: '55',
      lot: '9.01',
      deedBook: 'OR 3887',
      deedPage: '412',
      estimatedValue: 380000,
      mortgage: false,
    },
  ],
  fiduciaries: {
    executor: {
      primary: 'Surviving Spouse',
      alternate: 'Anthony Deluca (Brother of Vincent), 7 Maple Court, Edison, NJ 08817',
    },
    trustee: {
      primary: 'Surviving Spouse',
      alternate: 'Anthony Deluca (Brother of Vincent)',
    },
    guardian: {
      primary: 'Maria Conti (Sister of Sophia), 29 Glenwood Ave, South Amboy, NJ 08879',
      alternate: 'Anthony Deluca (Brother of Vincent), 7 Maple Court, Edison, NJ 08817',
    },
    healthcareProxy: {
      primary: 'Spouse',
      alternate: 'Maria Conti (Sister of Sophia)',
    },
    financialPoa: {
      primary: 'Spouse',
      alternate: 'Anthony Deluca (Brother of Vincent)',
    },
  },
  healthcareDirectives: {
    livingWill: true,
    dnr: false,
    organDonor: true,
    specificInstructions:
      'In the event of a terminal condition, end-stage condition, or persistent vegetative state, I direct that life-prolonging procedures be withheld or withdrawn.',
  },
  trustFunding: {
    assets: [
      { description: 'Primary residence at 14 Birchwood Terrace, Metuchen, NJ', estimatedValue: 725000, type: 'real_property' },
      { description: 'Rental property at 302 Amboy Avenue, Perth Amboy, NJ', estimatedValue: 380000, type: 'real_property' },
      { description: 'TD Bank checking account x-4521', estimatedValue: 45000, type: 'bank_account' },
      { description: 'Fidelity brokerage account x-8839', estimatedValue: 210000, type: 'investment_account' },
      { description: 'Whole life insurance policy — MetLife, face value $500,000', estimatedValue: 500000, type: 'life_insurance' },
    ],
    distributionSchedule: [
      { age: 25, percentage: 33 },
      { age: 30, percentage: 33 },
      { age: 35, percentage: 34 },
    ],
  },
  notes:
    'Revocable living trust (joint). Pour-over wills for both spouses. Trust to remain in place for minor children. Assets to be held in trust until each child reaches 25/30/35 per schedule. Umbrella policy in place ($2M).',
  createdAt: NOW,
  updatedAt: NOW,
};

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedFirm(): Promise<void> {
  const firmRef = db.collection('firms').doc(FIRM_ID);
  await firmRef.set({
    firmId: FIRM_ID,
    name: 'Elias Counsel, LLC',
    email: 'adam@adameliaslaw.com',
    phone: '(609) 555-0100',
    address: {
      street: '100 Overlook Center, Suite 200',
      city: 'Princeton',
      state: 'NJ',
      zip: '08540',
      county: 'Mercer',
    },
    website: 'https://adameliaslaw.com',
    barNumber: 'NJ-123456',
    plan: 'professional',
    active: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  console.log(`  ✓ firms/${FIRM_ID}`);
}

async function seedNotes(clientRef: admin.firestore.DocumentReference, clientName: string): Promise<void> {
  const notesRef = clientRef.collection('notes');

  await notesRef.doc('note-001').set({
    noteId: 'note-001',
    content: `Initial intake completed for ${clientName}. Client reviewed package options and selected accordingly. Identification documents collected.`,
    createdBy: 'adam@adameliaslaw.com',
    createdAt: NOW,
    pinned: true,
  });

  await notesRef.doc('note-002').set({
    noteId: 'note-002',
    content: `Follow-up call scheduled. Client had questions about the role of a successor trustee and the difference between a healthcare proxy and a living will. Explained both concepts. Client satisfied with explanation.`,
    createdBy: 'adam@adameliaslaw.com',
    createdAt: NOW,
    pinned: false,
  });

  console.log(`      ✓ notes (2 documents)`);
}

async function seedPayment(clientRef: admin.firestore.DocumentReference, amount: number): Promise<void> {
  const paymentsRef = clientRef.collection('payments');

  await paymentsRef.doc('payment-001').set({
    paymentId: 'payment-001',
    amount,
    currency: 'usd',
    status: 'succeeded',
    method: 'card',
    last4: '4242',
    brand: 'Visa',
    receiptEmail: 'client@example.com',
    stripePaymentIntentId: `pi_test_${Math.random().toString(36).substring(2, 18)}`,
    paidAt: NOW,
    createdAt: NOW,
  });

  console.log(`      ✓ payments (1 document, $${amount})`);
}

async function seedCalendarEvent(clientRef: admin.firestore.DocumentReference, clientName: string): Promise<void> {
  const eventsRef = clientRef.collection('calendarEvents');

  // Signing appointment ~2 weeks from "now" (static ISO for repeatability)
  const signingDate = new Date('2026-03-14T14:00:00-05:00').toISOString();

  await eventsRef.doc('event-001').set({
    eventId: 'event-001',
    title: `Document Signing — ${clientName}`,
    type: 'signing',
    startTime: signingDate,
    durationMinutes: 60,
    location: '100 Overlook Center, Suite 200, Princeton, NJ 08540',
    attendees: ['adam@adameliaslaw.com'],
    notes: 'Bring two forms of government-issued photo ID. Notary will be present.',
    createdAt: NOW,
  });

  console.log(`      ✓ calendarEvents (1 document)`);
}

async function seedClient(data: ClientData, packagePrice: number): Promise<void> {
  const clientRef = db
    .collection('firms')
    .doc(FIRM_ID)
    .collection('clients')
    .doc(data.clientId);

  await clientRef.set(data);

  const displayName =
    data.maritalStatus === 'married' && data.client2
      ? `${data.client1.firstName} & ${data.client2.firstName} ${data.client1.lastName}`
      : `${data.client1.firstName} ${data.client1.lastName}`;

  console.log(`  ✓ firms/${FIRM_ID}/clients/${data.clientId}  (${data.package}, ${data.maritalStatus})`);

  await seedNotes(clientRef, displayName);
  await seedPayment(clientRef, packagePrice);
  await seedCalendarEvent(clientRef, displayName);
}

// ---------------------------------------------------------------------------
// Package pricing (test values)
// ---------------------------------------------------------------------------
const PACKAGE_PRICES: Record<string, number> = {
  foundation: 1500,
  guardian: 2500,
  fortress: 4500,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
(async () => {
  console.log('');
  console.log('============================================================');
  console.log(' NJ Estate Plan Generator — Seeding Test Data');
  console.log(' Target: Firestore' + (process.env.FIRESTORE_EMULATOR_HOST ? ' (emulator)' : ' (production — are you sure?)'));
  console.log('============================================================');
  console.log('');

  try {
    // Firm
    console.log('Seeding firm...');
    await seedFirm();
    console.log('');

    // Clients
    const scenarios: Array<[ClientData, number]> = [
      [scenarioA, PACKAGE_PRICES['foundation']],
      [scenarioB, PACKAGE_PRICES['guardian']],
      [scenarioC, PACKAGE_PRICES['foundation']],
      [scenarioD, PACKAGE_PRICES['fortress']],
    ];

    console.log('Seeding clients...');
    for (const [data, price] of scenarios) {
      await seedClient(data, price);
      console.log('');
    }

    // Summary
    console.log('============================================================');
    console.log(' Seeding Complete — Summary');
    console.log('============================================================');
    console.log('');
    console.log(` Firm:     firms/${FIRM_ID}`);
    console.log('');
    console.log(' Clients:');
    for (const [data] of scenarios) {
      const label =
        data.maritalStatus === 'married' && data.client2
          ? `${data.client1.firstName} & ${data.client2.firstName} ${data.client1.lastName}`
          : `${data.client1.firstName} ${data.client1.lastName}`;
      const childCount = data.children?.length ?? 0;
      console.log(
        `   • ${data.clientId.padEnd(34)} ${label.padEnd(36)} package=${data.package}, children=${childCount}, status=${data.status}`
      );
    }
    console.log('');
    console.log(' Subcollections per client: notes (×2), payments (×1), calendarEvents (×1)');
    console.log('');
    console.log(' To view in the emulator UI: http://127.0.0.1:4000/firestore');
    console.log('============================================================');
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('\n[ERROR] Seeding failed:', message);
    process.exit(1);
  }
})();
