import * as admin from 'firebase-admin';

/**
 * Patch script to restore missing Article numbering in existing InteractiveLegal templates.
 * Run this locally via: npx ts-node patch-article-headers.ts
 */

const FIRM_ID = 'elias-counsel';

const romanNumerals = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
  'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX'
];

const skipPatterns = [
  /^if\s+my/i,
  /^appointment\s+of/i,
  /^distribution\s+to/i,
  /^power\s+to/i,
  /^reliance\s+upon/i,
  /^executor\s+as/i,
  /^effect\s+of/i
];

async function patchTemplates() {
  if (!admin.apps.length) {
    admin.initializeApp();
  }

  const db = admin.firestore();
  console.log(`[Patch] Fetching templates for firm: ${FIRM_ID}...`);

  const templatesSnap = await db
    .collection('firms')
    .doc(FIRM_ID)
    .collection('documentTemplates')
    .where('softwareSource', '==', 'interactivelegal')
    .get();

  console.log(`[Patch] Found ${templatesSnap.size} InteractiveLegal templates.`);

  for (const doc of templatesSnap.docs) {
    const data = doc.data();
    const originalHtml = data.content;
    if (!originalHtml) continue;

    console.log(`[Patch] Processing template: ${data.name} (${doc.id})...`);

    let articleIndex = 0;
    const patchedHtml = originalHtml.replace(/<p class="tr-art1">(.*?)<\/p>/gi, (match: string, content: string) => {
      const plainText = content.replace(/<[^>]*>/g, '').trim();
      
      // Skip if it already contains "ARTICLE"
      if (plainText.toUpperCase().includes('ARTICLE')) {
        const numMatch = plainText.match(/ARTICLE\s+([IVXLCDM]+)/i);
        if (numMatch) {
           const foundRoman = numMatch[1].toUpperCase();
           const foundIdx = romanNumerals.indexOf(foundRoman);
           if (foundIdx !== -1) {
             articleIndex = foundIdx + 1;
           }
        }
        return match;
      }

      // Skip sub-headings and convert to tr-art2
      if (skipPatterns.some(pattern => pattern.test(plainText))) {
        return `<p class="tr-art2">${content}</p>`;
      }

      // It's a section header! Prepend numbering.
      const roman = romanNumerals[articleIndex] || (articleIndex + 1).toString();
      articleIndex++;
      
      return `<p class="tr-art1"><strong>ARTICLE ${roman} — </strong>${content}</p>`;
    });

    if (patchedHtml !== originalHtml) {
      console.log(`[Patch] Updating ${doc.id} with corrected headers...`);
      await doc.ref.update({ content: patchedHtml, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    } else {
      console.log(`[Patch] No changes needed for ${doc.id}.`);
    }
  }

  console.log('[Patch] Completed.');
}

patchTemplates().catch(err => {
  console.error('[Patch] Failed:', err);
  process.exit(1);
});
