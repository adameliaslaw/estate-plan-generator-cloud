#!/usr/bin/env node
/**
 * Spot-fix: Adam J. Elias's client doc is missing gender + address, which
 * causes "I, Adam J. Elias, of , , , revoke any prior Wills" and
 * "my husband, Karen K. Elias" (wrong title for male testator).
 *
 * Inspects the client doc and prints what's missing. Pass --execute to
 * backfill from Karen Elias's client doc (they share an address per the
 * generated will's funeral-rep section).
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');

admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))),
});

const FIRM_ID = 'elias-counsel';
const EXECUTE = process.argv.includes('--execute');

(async () => {
  const db = admin.firestore();
  const clients = await db.collection('firms').doc(FIRM_ID).collection('clients').get();

  const adam = clients.docs.find((d) => {
    const pi = d.data().personalInfo ?? {};
    const fn = (pi.firstName ?? '').toLowerCase();
    const ln = (pi.lastName ?? '').toLowerCase();
    return fn.startsWith('adam') && ln === 'elias';
  });
  const karen = clients.docs.find((d) => {
    const pi = d.data().personalInfo ?? {};
    return (pi.firstName ?? '').toLowerCase() === 'karen' && (pi.lastName ?? '').toLowerCase() === 'elias';
  });

  if (!adam) { console.error('Adam Elias not found'); process.exit(1); }
  if (!karen) { console.error('Karen Elias not found'); process.exit(1); }

  const adamData = adam.data();
  const karenData = karen.data();
  const adamPi = adamData.personalInfo ?? {};
  const karenPi = karenData.personalInfo ?? {};

  console.log(`Adam doc id: ${adam.id}`);
  console.log(`  gender:   ${adamPi.gender ?? '(MISSING)'}`);
  console.log(`  isFemale: ${adamData.isFemale ?? '(unset)'}`);
  console.log(`  address:  ${adamPi.address ?? '(MISSING)'}`);
  console.log(`  city:     ${adamPi.city ?? '(MISSING)'}`);
  console.log(`  state:    ${adamPi.state ?? '(MISSING)'}`);
  console.log(`  zip:      ${adamPi.zip ?? '(MISSING)'}`);
  console.log(`  county:   ${adamPi.county ?? '(MISSING)'}`);

  console.log(`\nKaren (source for backfill):`);
  console.log(`  address:  ${karenPi.address ?? '(MISSING)'}`);
  console.log(`  city:     ${karenPi.city ?? '(MISSING)'}`);
  console.log(`  state:    ${karenPi.state ?? '(MISSING)'}`);
  console.log(`  zip:      ${karenPi.zip ?? '(MISSING)'}`);
  console.log(`  county:   ${karenPi.county ?? '(MISSING)'}`);

  const update = {};
  if (!adamPi.gender) update['personalInfo.gender'] = 'male';
  if (!adamPi.address && karenPi.address) update['personalInfo.address'] = karenPi.address;
  if (!adamPi.city && karenPi.city) update['personalInfo.city'] = karenPi.city;
  if (!adamPi.state && karenPi.state) update['personalInfo.state'] = karenPi.state;
  if (!adamPi.zip && karenPi.zip) update['personalInfo.zip'] = karenPi.zip;
  if (!adamPi.county && karenPi.county) update['personalInfo.county'] = karenPi.county;

  if (Object.keys(update).length === 0) {
    console.log('\nNothing to backfill — Adam already has all fields.');
    process.exit(0);
  }

  console.log(`\nProposed updates (${Object.keys(update).length}):`);
  for (const [k, v] of Object.entries(update)) console.log(`  ${k} = ${v}`);

  if (!EXECUTE) {
    console.log('\nDry run. Re-run with --execute to apply.');
    process.exit(0);
  }

  await adam.ref.update(update);
  console.log('\nApplied.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
