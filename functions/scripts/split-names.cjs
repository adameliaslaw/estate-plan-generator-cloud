'use strict';
/**
 * Migration: propose firstName/middleName/lastName/suffix splits for every
 * fiduciary slot + repeater item across every client doc.
 *
 * Scope (2026-05-27 name-split refactor, Phase B):
 *   - fiduciaries.{executor,trustee}.{primary,alternate,successor,secondSuccessor,coTrustee}
 *   - fiduciaries.powerOfAttorney.{agent,alternateAgent,successorAgent}
 *   - fiduciaries.healthcareProxy.{agent,alternateAgent,successorAgent}
 *   - fiduciaries.guardian.{primary,alternate}  (legacy nested path)
 *   - guardianPrimary, guardianAlternate         (top-level)
 *   - children[], grandchildren[], otherDependents[]  (repeaters)
 *
 * Output: writes a `_pendingNameSplit: { firstName, middleName, lastName, suffix }`
 * field on each touched entry. NO canonical-field writes — that's done after
 * human review via the /admin/name-splits page (Phase C).
 *
 * Idempotency: by default skips entries that already have `firstName` set OR
 * already have a `_pendingNameSplit` field. Pass --force to overwrite.
 *
 * Flags:
 *   --dry-run        (default — log, no writes)
 *   --commit         actually write proposals to Firestore
 *   --force          re-propose entries that already have firstName / _pendingNameSplit
 *   --firm <id>      restrict to a single firm (default: all firms)
 *   --client <id>    restrict to a single client
 *
 * Examples:
 *   node functions/scripts/split-names.cjs --dry-run --firm elias-counsel
 *   node functions/scripts/split-names.cjs --commit --firm elias-counsel
 *   node functions/scripts/split-names.cjs --commit --firm elias-counsel --client B6t17ajHjjNOddKz81td
 */

const admin = require('firebase-admin');
const path = require('path');
admin.initializeApp({
  credential: admin.credential.cert(require(path.resolve(__dirname, '..', '..', 'service-account.json'))),
});

// ── CLI flags ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {
  dryRun: !argv.includes('--commit'),
  force: argv.includes('--force'),
  firm: undefined,
  client: undefined,
};
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--firm') flags.firm = argv[i + 1];
  if (argv[i] === '--client') flags.client = argv[i + 1];
}

// ── Heuristic split ────────────────────────────────────────────────────────
// Tokens to match against the final-position suffix detection. Matches
// "Jr", "Jr.", "JR.", "SR", "II", "III", "IV", "V", "Esq", "Esq.".
const SUFFIX_TOKENS = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V', 'VI', 'ESQ']);

function proposeSplit(name) {
  if (typeof name !== 'string') return null;
  const tokens = name.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  let suffix = '';
  // Detect trailing suffix token (strip trailing comma/period for the match).
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    const normalized = last.toUpperCase().replace(/[.,]$/, '');
    if (SUFFIX_TOKENS.has(normalized)) {
      suffix = tokens.pop();
    }
  }
  if (tokens.length === 0) {
    // Pathological case: name was just a suffix. Treat as firstName.
    return { firstName: suffix, middleName: '', lastName: '', suffix: '' };
  }
  if (tokens.length === 1) {
    return { firstName: tokens[0], middleName: '', lastName: '', suffix };
  }
  const firstName = tokens.shift();
  const lastName = tokens.pop();
  const middleName = tokens.join(' ');
  return { firstName, middleName, lastName, suffix };
}

// ── Slot enumeration ───────────────────────────────────────────────────────
// Returns an array of { label, parent, key } tuples — `parent[key]` is the
// candidate entry to read/write. `parent` is a live reference into the client
// data object, so writes to `parent[key]._pendingNameSplit` propagate when
// we update the doc.
function enumerateSlots(client) {
  const out = [];
  const push = (label, parent, key) => {
    if (parent && typeof parent === 'object' && parent[key] && typeof parent[key] === 'object') {
      out.push({ label, parent, key });
    }
  };

  const f = client.fiduciaries;
  if (f) {
    if (f.executor) {
      push('fiduciaries.executor.primary', f.executor, 'primary');
      push('fiduciaries.executor.alternate', f.executor, 'alternate');
      push('fiduciaries.executor.successor', f.executor, 'successor');
      push('fiduciaries.executor.secondSuccessor', f.executor, 'secondSuccessor');
    }
    if (f.trustee) {
      push('fiduciaries.trustee.primary', f.trustee, 'primary');
      push('fiduciaries.trustee.alternate', f.trustee, 'alternate');
      push('fiduciaries.trustee.successor', f.trustee, 'successor');
      push('fiduciaries.trustee.coTrustee', f.trustee, 'coTrustee');
    }
    if (f.powerOfAttorney) {
      push('fiduciaries.powerOfAttorney.agent', f.powerOfAttorney, 'agent');
      push('fiduciaries.powerOfAttorney.alternateAgent', f.powerOfAttorney, 'alternateAgent');
      push('fiduciaries.powerOfAttorney.successorAgent', f.powerOfAttorney, 'successorAgent');
    }
    if (f.healthcareProxy) {
      push('fiduciaries.healthcareProxy.agent', f.healthcareProxy, 'agent');
      push('fiduciaries.healthcareProxy.alternateAgent', f.healthcareProxy, 'alternateAgent');
      push('fiduciaries.healthcareProxy.successorAgent', f.healthcareProxy, 'successorAgent');
    }
    if (f.guardian) {
      push('fiduciaries.guardian.primary', f.guardian, 'primary');
      push('fiduciaries.guardian.alternate', f.guardian, 'alternate');
    }
  }
  push('guardianPrimary', client, 'guardianPrimary');
  push('guardianAlternate', client, 'guardianAlternate');

  if (Array.isArray(client.children)) {
    client.children.forEach((c, idx) => {
      if (c && typeof c === 'object') out.push({ label: `children[${idx}]`, parent: client.children, key: idx });
    });
  }
  if (Array.isArray(client.grandchildren)) {
    client.grandchildren.forEach((c, idx) => {
      if (c && typeof c === 'object') out.push({ label: `grandchildren[${idx}]`, parent: client.grandchildren, key: idx });
    });
  }
  if (Array.isArray(client.otherDependents)) {
    client.otherDependents.forEach((c, idx) => {
      if (c && typeof c === 'object') out.push({ label: `otherDependents[${idx}]`, parent: client.otherDependents, key: idx });
    });
  }
  return out;
}

function nonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

// ── Main ───────────────────────────────────────────────────────────────────
(async () => {
  const db = admin.firestore();
  const firmsSnap = flags.firm
    ? { docs: [await db.doc(`firms/${flags.firm}`).get()] }
    : await db.collection('firms').get();

  console.log(`\n[split-names] mode=${flags.dryRun ? 'DRY-RUN' : 'COMMIT'} force=${flags.force} firm=${flags.firm ?? '<all>'} client=${flags.client ?? '<all>'}\n`);

  let clientsScanned = 0;
  let entriesProposed = 0;
  let entriesSkipped = 0;
  let clientsUpdated = 0;

  for (const firmDoc of firmsSnap.docs) {
    if (!firmDoc.exists) {
      console.warn(`Firm ${flags.firm} not found`);
      continue;
    }
    const firmId = firmDoc.id;
    const clientsRef = db.collection(`firms/${firmId}/clients`);
    const clientsSnap = flags.client
      ? { docs: [await clientsRef.doc(flags.client).get()] }
      : await clientsRef.get();

    for (const clientDoc of clientsSnap.docs) {
      if (!clientDoc.exists) continue;
      clientsScanned++;
      const client = clientDoc.data();
      const slots = enumerateSlots(client);
      const proposedThisClient = [];

      for (const { label, parent, key } of slots) {
        const entry = parent[key];
        if (!entry || typeof entry !== 'object') continue;
        const hasFirst = nonEmpty(entry.firstName);
        const hasPending = entry._pendingNameSplit && typeof entry._pendingNameSplit === 'object';
        if (!flags.force && (hasFirst || hasPending)) {
          entriesSkipped++;
          continue;
        }
        if (!nonEmpty(entry.name)) {
          entriesSkipped++;
          continue;
        }
        const split = proposeSplit(entry.name);
        if (!split) {
          entriesSkipped++;
          continue;
        }
        entry._pendingNameSplit = split;
        proposedThisClient.push({ label, name: entry.name, split });
        entriesProposed++;
      }

      if (proposedThisClient.length > 0) {
        const piName = client.personalInfo
          ? [client.personalInfo.firstName, client.personalInfo.lastName].filter(Boolean).join(' ')
          : '<unnamed>';
        console.log(`\n  ${firmId}/${clientDoc.id}  ${piName}`);
        for (const { label, name, split } of proposedThisClient) {
          const formatted = [split.firstName, split.middleName, split.lastName, split.suffix]
            .filter(Boolean)
            .join(' | ');
          console.log(`    ${label.padEnd(46)} "${name}" -> ${formatted}`);
        }
        if (!flags.dryRun) {
          // Only include subtrees that exist on the original doc — never
          // pass undefined-as-delete, which would wipe the field.
          const updates = {};
          if (client.fiduciaries) updates.fiduciaries = client.fiduciaries;
          if (client.children) updates.children = client.children;
          if (client.grandchildren) updates.grandchildren = client.grandchildren;
          if (client.otherDependents) updates.otherDependents = client.otherDependents;
          if (client.guardianPrimary) updates.guardianPrimary = client.guardianPrimary;
          if (client.guardianAlternate) updates.guardianAlternate = client.guardianAlternate;
          await clientDoc.ref.update(updates);
          clientsUpdated++;
        }
      }
    }
  }

  console.log(`\n[split-names] done. clientsScanned=${clientsScanned} proposed=${entriesProposed} skipped=${entriesSkipped} clientsUpdated=${clientsUpdated}\n`);
  process.exit(0);
})().catch((err) => {
  console.error('[split-names] FAILED:', err);
  process.exit(1);
});
