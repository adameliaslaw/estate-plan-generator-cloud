'use strict';
// Deletes the 4 inactive duplicate IL templates after stashing full JSON
// payloads to tmp/dedup/__deleted/ for recoverability.
// Safety rails: refuses to delete if isActive === true.
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

admin.initializeApp({
  credential: admin.credential.cert(
    require(path.resolve(__dirname, '..', '..', 'service-account.json'))
  ),
});

const LOSERS = [
  { id: 'QU978ikcinUlcKuMCqyg', pair: 'JessicaHC' },
  { id: 'fN5MXom5iYsVkdUAZd6l', pair: 'JessicaPOA' },
  { id: 'mcrsbJBXr8zBeZamjXbJ', pair: 'RizzoTrust' },
  { id: 'nGH7jfJINVP08BK1mc7A', pair: 'JessicaLWT' },
];

const BACKUP_DIR = path.resolve(__dirname, '..', '..', 'tmp', 'dedup', '__deleted');
fs.mkdirSync(BACKUP_DIR, { recursive: true });

function serializeTimestamps(obj) {
  if (obj && typeof obj === 'object') {
    if (typeof obj.toDate === 'function') {
      return { __firestoreTimestamp: obj.toDate().toISOString() };
    }
    if (Array.isArray(obj)) return obj.map(serializeTimestamps);
    const out = {};
    for (const k of Object.keys(obj)) out[k] = serializeTimestamps(obj[k]);
    return out;
  }
  return obj;
}

(async () => {
  const db = admin.firestore();
  for (const loser of LOSERS) {
    const ref = db.doc(`firms/elias-counsel/documentTemplates/${loser.id}`);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`[skip] ${loser.pair} ${loser.id} — not found`);
      continue;
    }
    const data = snap.data();
    if (data.isActive === true) {
      console.log(`[ABORT] ${loser.pair} ${loser.id} — isActive=true, refusing to delete`);
      process.exit(1);
    }
    const backupPath = path.join(BACKUP_DIR, `${loser.pair}__${loser.id}.json`);
    fs.writeFileSync(backupPath, JSON.stringify({
      id: loser.id,
      pair: loser.pair,
      deletedAt: new Date().toISOString(),
      deletedBy: 'scripts/delete-loser-templates.cjs',
      data: serializeTimestamps(data),
    }, null, 2));
    await ref.delete();
    console.log(`[deleted] ${loser.pair} ${loser.id} (backup at ${path.relative(process.cwd(), backupPath)})`);
  }
  console.log('\nDone. 4 templates deleted, backups stashed.');
  process.exit(0);
})();
