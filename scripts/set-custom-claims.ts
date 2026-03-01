#!/usr/bin/env ts-node
/**
 * Set Firebase Auth custom claims for a user.
 * Usage: npx ts-node scripts/set-custom-claims.ts <uid> <role> <firmId> [clientId]
 *
 * Roles: admin, attorney, paralegal, client
 *
 * Examples:
 *   npx ts-node scripts/set-custom-claims.ts abc123 attorney test-firm
 *   npx ts-node scripts/set-custom-claims.ts def456 client test-firm test-client-1
 */

import * as admin from 'firebase-admin';

admin.initializeApp();

async function main() {
  const [, , uid, role, firmId, clientId] = process.argv;

  if (!uid || !role || !firmId) {
    console.error('Usage: npx ts-node scripts/set-custom-claims.ts <uid> <role> <firmId> [clientId]');
    console.error('Roles: admin, attorney, paralegal, client');
    process.exit(1);
  }

  const validRoles = ['admin', 'attorney', 'paralegal', 'client'];
  if (!validRoles.includes(role)) {
    console.error(`Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}`);
    process.exit(1);
  }

  const claims: Record<string, string> = { role, firmId };
  if (clientId) claims.clientId = clientId;

  await admin.auth().setCustomUserClaims(uid, claims);

  console.log(`✓ Custom claims set for user ${uid}:`);
  console.log(JSON.stringify(claims, null, 2));

  // Verify
  const user = await admin.auth().getUser(uid);
  console.log(`\nVerification — current claims:`, user.customClaims);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
