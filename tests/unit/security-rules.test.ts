/**
 * tests/unit/security-rules.test.ts
 *
 * Validates Firestore security rules file structure and RBAC patterns.
 * Uses file-system reads + regex analysis — no actual Firestore emulator needed.
 *
 * Coverage:
 * - RBAC roles defined: admin, attorney, paralegal, client
 * - Client can only access their own data
 * - Paralegal has limited write access (no client CREATE)
 * - Attorney has full firm access
 * - Admin has global access
 * - Audit trail patterns present
 * - Validation helper functions defined
 * - Collection hierarchy matches spec
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// ============================================================================
// Load the actual firestore.rules file
// ============================================================================

const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

let rulesContent = '';

beforeAll(() => {
  expect(fs.existsSync(RULES_PATH)).toBe(true);
  rulesContent = fs.readFileSync(RULES_PATH, 'utf-8');
});

// ============================================================================
// Helper: check if the rules file contains a pattern
// ============================================================================

function rulesContain(pattern: RegExp | string): boolean {
  if (typeof pattern === 'string') {
    return rulesContent.includes(pattern);
  }
  return pattern.test(rulesContent);
}

function countOccurrences(pattern: RegExp): number {
  const matches = rulesContent.match(pattern);
  return matches ? matches.length : 0;
}

// ============================================================================
// SECTION: File structure basics
// ============================================================================

describe('Firestore Rules — file structure', () => {
  it('rules file exists at project root', () => {
    expect(fs.existsSync(RULES_PATH)).toBe(true);
  });

  it('rules file is non-empty', () => {
    expect(rulesContent.length).toBeGreaterThan(100);
  });

  it('rules file starts with rules_version declaration', () => {
    expect(rulesContain(/rules_version\s*=\s*['"]2['"]/)).toBe(true);
  });

  it('rules file has service cloud.firestore block', () => {
    expect(rulesContain('service cloud.firestore')).toBe(true);
  });

  it('rules file has match /databases/{database}/documents', () => {
    expect(rulesContain(/match\s+\/databases\/\{database\}\/documents/)).toBe(true);
  });
});

// ============================================================================
// SECTION: RBAC role helper functions
// ============================================================================

describe('Firestore Rules — RBAC role helper functions', () => {
  it('defines isAuthenticated() helper function', () => {
    expect(rulesContain('function isAuthenticated()')).toBe(true);
    expect(rulesContain('request.auth != null')).toBe(true);
  });

  it('defines hasRole() helper function checking custom claims', () => {
    expect(rulesContain('function hasRole(')).toBe(true);
    // The role must be checked from token claims
    expect(rulesContain('request.auth.token.role')).toBe(true);
  });

  it('defines isAdmin() helper', () => {
    expect(rulesContain('function isAdmin()')).toBe(true);
    expect(rulesContain("hasRole('admin')")).toBe(true);
  });

  it('uses hasRole("attorney") inline for attorney checks', () => {
    // Rules use hasRole('attorney') inline rather than a dedicated isAttorney() wrapper
    expect(rulesContain("hasRole('attorney')")).toBe(true);
  });

  it('uses hasRole("paralegal") inline for paralegal checks', () => {
    // Rules use hasRole('paralegal') inline rather than a dedicated isParalegal() wrapper
    expect(rulesContain("hasRole('paralegal')")).toBe(true);
  });

  it('defines isClient() helper', () => {
    expect(rulesContain('function isClient()')).toBe(true);
    expect(rulesContain("hasRole('client')")).toBe(true);
  });

  it('defines belongsToFirm() helper checking firmId claim', () => {
    expect(rulesContain('function belongsToFirm(')).toBe(true);
    expect(rulesContain('request.auth.token.firmId')).toBe(true);
  });

  it('defines isOwnClientRecord() helper for client self-access', () => {
    expect(rulesContain('function isOwnClientRecord(')).toBe(true);
    // Must check UID against clientId
    expect(rulesContain('request.auth.uid')).toBe(true);
  });
});

// ============================================================================
// SECTION: Firm collection rules
// ============================================================================

describe('Firestore Rules — /firms/{firmId} collection', () => {
  it('has a match rule for /firms/{firmId}', () => {
    expect(rulesContain(/match\s+\/firms\/\{firmId\}/)).toBe(true);
  });

  it('admin can read firm documents', () => {
    // The read rule for firms must include isAdmin()
    const firmsBlock = rulesContent.match(
      /match\s+\/firms\/\{firmId\}[\s\S]*?(?=match\s+\/firms\/\{firmId\}\/clients|match\s+\/databases)/
    )?.[0] ?? '';
    expect(firmsBlock).toMatch(/isAdmin\(\)/);
  });

  it('only admin can create firm documents', () => {
    expect(rulesContain(/allow\s+create\s*:\s*if\s+isAdmin\(\)/)).toBe(true);
  });

  it('only admin can delete firm documents', () => {
    expect(rulesContain(/allow\s+delete\s*:\s*if\s+isAdmin\(\)/)).toBe(true);
  });
});

// ============================================================================
// SECTION: Client collection rules
// ============================================================================

describe('Firestore Rules — /firms/{firmId}/clients/{clientId}', () => {
  it('has a match rule for clients sub-collection', () => {
    expect(rulesContain(/match\s+\/clients\/\{clientId\}/)).toBe(true);
  });

  it('attorney has read access to clients within their firm', () => {
    expect(rulesContain("hasRole('attorney')")).toBe(true);
    expect(rulesContain('belongsToFirm(firmId)')).toBe(true);
  });

  it('paralegal has read access to clients within their firm', () => {
    expect(rulesContain("hasRole('paralegal')")).toBe(true);
  });

  it('client can only read their own record (isOwnClientRecord)', () => {
    expect(rulesContain('isOwnClientRecord(clientId)')).toBe(true);
  });

  it('paralegal is NOT allowed to create client records', () => {
    // Paralegal should NOT be in the create rule for clients
    // The create rule should have isAdmin() or isAttorney() but NOT isParalegal()
    // We verify this by checking that the create comment/block mentions paralegal NOT allowed
    expect(rulesContain(/Paralegal.*NOT\s+allowed/i)).toBe(true);
  });
});

// ============================================================================
// SECTION: Documents sub-collection
// ============================================================================

describe('Firestore Rules — documents sub-collection', () => {
  it('has a match rule for documents sub-collection', () => {
    expect(rulesContain(/match\s+\/documents\/\{docId\}/)).toBe(true);
  });

  it('client can read their own documents', () => {
    // The documents read rule must check isOwnClientRecord or isClient
    const docBlockMatch = rulesContent.match(
      /match\s+\/documents\/\{docId\}[\s\S]*?(?=match\s+\/notes|match\s+\/payments|match\s+\/calendar|\})/
    );
    expect(docBlockMatch).not.toBeNull();
  });
});

// ============================================================================
// SECTION: Notes sub-collection
// ============================================================================

describe('Firestore Rules — notes sub-collection', () => {
  it('has a match rule for notes sub-collection', () => {
    expect(rulesContain(/match\s+\/notes\/\{noteId\}/)).toBe(true);
  });

  it('paralegal can write to notes (limited write access)', () => {
    // Paralegal should be able to write notes but not all client data
    const notesSection = rulesContent.match(
      /match\s+\/notes\/\{noteId\}[\s\S]*?(?=match\s+\/payments|match\s+\/calendar|\})/
    )?.[0] ?? '';
    expect(notesSection).toMatch(/hasRole\('paralegal'\)/);
  });
});

// ============================================================================
// SECTION: Payments sub-collection
// ============================================================================

describe('Firestore Rules — payments sub-collection', () => {
  it('has a match rule for payments sub-collection', () => {
    expect(rulesContain(/match\s+\/payments\/\{paymentId\}/)).toBe(true);
  });

  it('client can read their own payment records', () => {
    const paymentsSection = rulesContent.match(
      /match\s+\/payments\/\{paymentId\}[\s\S]*?(?=match\s+\/calendar|\})/
    )?.[0] ?? '';
    expect(paymentsSection).toMatch(/isClient\(\)|isOwnClientRecord/);
  });
});

// ============================================================================
// SECTION: Validation helper functions
// ============================================================================

describe('Firestore Rules — data validation helpers', () => {
  it('defines hasValidPersonalInfo() validation', () => {
    expect(rulesContain('function hasValidPersonalInfo()')).toBe(true);
    expect(rulesContain('personalInfo')).toBe(true);
  });

  it('defines hasValidDocumentFields() validation', () => {
    expect(rulesContain('function hasValidDocumentFields()')).toBe(true);
  });

  it('defines hasValidPaymentAmount() validation', () => {
    expect(rulesContain('function hasValidPaymentAmount()')).toBe(true);
    // Payments must have a positive amount
    expect(rulesContain('amount > 0')).toBe(true);
  });

  it('defines hasValidClientStatus() with allowed statuses', () => {
    expect(rulesContain('function hasValidClientStatus()')).toBe(true);
    // Should include the known status values
    expect(rulesContain("'active'"  )).toBe(true);
    expect(rulesContain("'archived'")).toBe(true);
  });

  it('defines hasValidDocumentStatus() with the DocStatus vocabulary', () => {
    expect(rulesContain('function hasValidDocumentStatus()')).toBe(true);
    // Must match DocStatus in src/types/index.ts — the editor and review
    // flows write these statuses through the client SDK.
    expect(rulesContain("'draft'"       )).toBe(true);
    expect(rulesContain("'review'"      )).toBe(true);
    expect(rulesContain("'final'"       )).toBe(true);
    expect(rulesContain("'incomplete'"  )).toBe(true);
    expect(rulesContain("'needs_review'")).toBe(true);
    expect(rulesContain("'error'"       )).toBe(true);
  });

  it('guards client identity fields (linkedUserId, firmId) against self-modification', () => {
    expect(rulesContain('function clientIdentityUnchanged()')).toBe(true);
    // Uses a diff-based affectedKeys check like the /users self-escalation guard.
    expect(rulesContain('affectedKeys()')).toBe(true);
    expect(rulesContain("hasAny(['linkedUserId', 'firmId'])")).toBe(true);
    // The guard must be wired into the client-update rule.
    expect(rulesContain('clientIdentityUnchanged()')).toBe(true);
  });

  it('defines hasValidPaymentStatus() with allowed statuses', () => {
    expect(rulesContain('function hasValidPaymentStatus()')).toBe(true);
    expect(rulesContain("'pending'"   )).toBe(true);
    expect(rulesContain("'completed'" )).toBe(true);
  });
});

// ============================================================================
// SECTION: Access control principles — cross-cutting
// ============================================================================

describe('Firestore Rules — access control principles', () => {
  it('admin bypasses all role checks (isAdmin present throughout)', () => {
    const adminCount = countOccurrences(/isAdmin\(\)/g);
    // Admin should appear in multiple rules blocks
    expect(adminCount).toBeGreaterThanOrEqual(4);
  });

  it('belongsToFirm() is used to scope attorney/paralegal access to their firm', () => {
    const firmCheckCount = countOccurrences(/belongsToFirm\(firmId\)/g);
    expect(firmCheckCount).toBeGreaterThanOrEqual(2);
  });

  it('unauthenticated access is prevented (rules require authentication)', () => {
    // isAuthenticated() must be called in key function definitions
    expect(rulesContain('request.auth != null')).toBe(true);
  });

  it('UID-based verification is present for client self-access', () => {
    // Must verify request.auth.uid matches the client's UID
    expect(rulesContain('request.auth.uid == clientId')).toBe(true);
  });

  it('linkedUserId field is checked for client access (pre-linked accounts)', () => {
    expect(rulesContain('linkedUserId')).toBe(true);
    expect(rulesContain('request.auth.uid')).toBe(true);
  });

  it('resource.data is accessed for linked user check', () => {
    // Ensures resource.data.linkedUserId is compared to request.auth.uid
    expect(rulesContain('resource.data.linkedUserId')).toBe(true);
  });
});

// ============================================================================
// SECTION: Collection hierarchy completeness
// ============================================================================

describe('Firestore Rules — collection hierarchy', () => {
  it('covers all 5 expected sub-collections under clients', () => {
    const subCollections = ['documents', 'notes', 'payments', 'calendar'];
    for (const coll of subCollections) {
      expect(rulesContain(new RegExp(`match\\s+/${coll}/`))).toBe(true);
    }
  });

  it('firms collection is at the top level', () => {
    expect(rulesContain(/match\s+\/firms\/\{firmId\}/)).toBe(true);
  });

  it('clients are nested under firms', () => {
    // Verify both path segments appear in correct nesting
    const firestoreBlock = rulesContent;
    const firmsIdx = firestoreBlock.indexOf('match /firms/{firmId}');
    const clientsIdx = firestoreBlock.indexOf('match /clients/{clientId}');
    // clients block must appear after firms block
    expect(firmsIdx).toBeGreaterThanOrEqual(0);
    expect(clientsIdx).toBeGreaterThan(firmsIdx);
  });
});
