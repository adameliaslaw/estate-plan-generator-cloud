/**
 * functions/src/template-learning.ts
 *
 * AI Learning Engine for template variable detection.
 * Provides persistent memory that makes the template analysis engine
 * smarter over time through:
 *
 *  1. Correction Memory — stores user edits to AI suggestions
 *  2. Variable Dictionary — confirmed variable→field mappings
 *  3. Cross-Document Learning — few-shot examples from prior templates
 *  4. Firm-Specific Patterns — custom detection preferences
 *
 * All data stored in: firms/{firmId}/templateLearning/{docId}
 */

import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CorrectionEntry {
  originalText: string;
  aiSuggestedVariable: string;
  userCorrectedVariable: string;
  docType: string;
  templateName: string;
  timestamp: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

export interface DictionaryEntry {
  variable: string;
  fieldLabel: string;
  uses: number;
  lastUsed: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  docTypes: string[];
}

export interface FewShotExample {
  templateName: string;
  docType: string;
  detectedVariables: {
    originalText: string;
    confirmedVariable: string;
    fieldLabel: string;
  }[];
  uploadedAt: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
}

export interface LearningContext {
  corrections: CorrectionEntry[];
  dictionary: Record<string, DictionaryEntry>;
  fewShotExamples: FewShotExample[];
  patternConfig: {
    placeholderStyles: string[];
    ignorePatterns: string[];
    customFields: { path: string; label: string }[];
  };
  stats: {
    totalCorrections: number;
    totalTemplatesLearned: number;
    dictionarySize: number;
  };
}

// ---------------------------------------------------------------------------
// Firestore helpers
// ---------------------------------------------------------------------------

function learningCollection(firmId: string) {
  return admin.firestore().collection('firms').doc(firmId).collection('templateLearning');
}

// ---------------------------------------------------------------------------
// Record a user correction to an AI-suggested variable mapping
// ---------------------------------------------------------------------------

export async function recordCorrection(
  firmId: string,
  correction: {
    originalText: string;
    aiSuggestedVariable: string;
    userCorrectedVariable: string;
    docType: string;
    templateName: string;
  },
): Promise<void> {
  const ref = learningCollection(firmId).doc('corrections');

  const entry: CorrectionEntry = {
    ...correction,
    // Concrete Timestamp — a serverTimestamp() sentinel is prohibited inside
    // arrayUnion() and would make this whole call throw (see the same rule
    // documented at recordConfirmedVariables below).
    timestamp: admin.firestore.Timestamp.now(),
  };

  // Use arrayUnion to append; if doc doesn't exist, create it
  await ref.set(
    {
      entries: admin.firestore.FieldValue.arrayUnion(entry),
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  // Also update the variable dictionary with the corrected mapping
  await updateDictionaryEntry(firmId, correction.originalText, {
    variable: correction.userCorrectedVariable,
    fieldLabel: correction.originalText,
    docTypes: [correction.docType],
  });

  console.log(`[templateLearning] Recorded correction for "${correction.originalText}": ${correction.aiSuggestedVariable} → ${correction.userCorrectedVariable}`);
}

// ---------------------------------------------------------------------------
// Record confirmed variables after a template is saved
// ---------------------------------------------------------------------------

export async function recordConfirmedVariables(
  firmId: string,
  templateName: string,
  docType: string,
  variables: {
    originalText: string;
    confirmedVariable: string;
    fieldLabel: string;
  }[],
): Promise<void> {
  if (variables.length === 0) return;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = admin.firestore().batch();

  // 1. Update variable dictionary with all confirmed mappings
  const dictRef = learningCollection(firmId).doc('variableDictionary');
  const dictSnap = await dictRef.get();
  const existingMappings = (dictSnap.data()?.mappings as Record<string, DictionaryEntry>) ?? {};

  // Use Timestamp.now() for fields stored inside arrays/nested objects —
  // FieldValue.serverTimestamp() is a sentinel that Firestore prohibits inside arrays.
  const concreteNow = admin.firestore.Timestamp.now();

  for (const v of variables) {
    const key = v.originalText.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 100);
    const existing = existingMappings[key];

    existingMappings[key] = {
      variable: v.confirmedVariable,
      fieldLabel: v.fieldLabel,
      uses: (existing?.uses ?? 0) + 1,
      lastUsed: concreteNow,
      docTypes: Array.from(new Set([...(existing?.docTypes ?? []), docType])),
    };
  }

  batch.set(dictRef, { mappings: existingMappings, lastUpdated: now }, { merge: true });

  // 2. Add as a few-shot example (keep last 20 per firm)
  const examplesRef = learningCollection(firmId).doc('fewShotExamples');
  const exSnap = await examplesRef.get();
  const existingExamples: FewShotExample[] = (exSnap.data()?.examples as FewShotExample[]) ?? [];

  const newExample: FewShotExample = {
    templateName,
    docType,
    detectedVariables: variables.slice(0, 20), // Cap per template
    uploadedAt: concreteNow, // Must be concrete Timestamp, not FieldValue sentinel (arrays forbid sentinels)
  };

  // Keep most recent 20 examples
  const updatedExamples = [...existingExamples, newExample].slice(-20);
  batch.set(examplesRef, { examples: updatedExamples, lastUpdated: now }, { merge: true });

  await batch.commit();
  console.log(`[templateLearning] Recorded ${variables.length} confirmed variables from "${templateName}"`);
}

// ---------------------------------------------------------------------------
// Update a single dictionary entry
// ---------------------------------------------------------------------------

async function updateDictionaryEntry(
  firmId: string,
  originalText: string,
  data: { variable: string; fieldLabel: string; docTypes: string[] },
): Promise<void> {
  const dictRef = learningCollection(firmId).doc('variableDictionary');
  const key = originalText.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 100);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const snap = await dictRef.get();
  const mappings = (snap.data()?.mappings as Record<string, DictionaryEntry>) ?? {};
  const existing = mappings[key];

  mappings[key] = {
    variable: data.variable,
    fieldLabel: data.fieldLabel,
    uses: (existing?.uses ?? 0) + 1,
    lastUsed: now,
    docTypes: Array.from(new Set([...(existing?.docTypes ?? []), ...data.docTypes])),
  };

  await dictRef.set({ mappings, lastUpdated: now }, { merge: true });
}

// ---------------------------------------------------------------------------
// Get learning context for AI prompt injection
// ---------------------------------------------------------------------------

export async function getLearningContext(firmId: string): Promise<LearningContext> {
  const col = learningCollection(firmId);

  const [correctionsSnap, dictSnap, examplesSnap, configSnap] = await Promise.all([
    col.doc('corrections').get(),
    col.doc('variableDictionary').get(),
    col.doc('fewShotExamples').get(),
    col.doc('patternConfig').get(),
  ]);

  // Corrections — most recent 50
  const allCorrections: CorrectionEntry[] = (correctionsSnap.data()?.entries as CorrectionEntry[]) ?? [];
  const recentCorrections = allCorrections.slice(-50);

  // Dictionary
  const dictionary: Record<string, DictionaryEntry> = (dictSnap.data()?.mappings as Record<string, DictionaryEntry>) ?? {};

  // Few-shot examples — most recent 10
  const allExamples: FewShotExample[] = (examplesSnap.data()?.examples as FewShotExample[]) ?? [];
  const recentExamples = allExamples.slice(-10);

  // Pattern config
  const configData = configSnap.data();
  const patternConfig = {
    placeholderStyles: (configData?.placeholderStyles as string[]) ?? [],
    ignorePatterns: (configData?.ignorePatterns as string[]) ?? [],
    customFields: (configData?.customFields as { path: string; label: string }[]) ?? [],
  };

  return {
    corrections: recentCorrections,
    dictionary,
    fewShotExamples: recentExamples,
    patternConfig,
    stats: {
      totalCorrections: allCorrections.length,
      totalTemplatesLearned: allExamples.length,
      dictionarySize: Object.keys(dictionary).length,
    },
  };
}

// ---------------------------------------------------------------------------
// Format learning context as prompt text
// ---------------------------------------------------------------------------

export function formatLearningPrompt(ctx: LearningContext): string {
  const sections: string[] = [];

  // Past corrections
  if (ctx.corrections.length > 0) {
    const correctionLines = ctx.corrections.slice(-20).map(
      (c) => `  - "${c.originalText}" → AI suggested: ${c.aiSuggestedVariable}, User corrected to: ${c.userCorrectedVariable} (in ${c.docType})`,
    );
    sections.push(
      `LEARNING FROM PAST CORRECTIONS (apply these lessons):\n${correctionLines.join('\n')}`,
    );
  }

  // Variable dictionary — top 50 most-used
  const dictEntries = Object.entries(ctx.dictionary)
    .sort(([, a], [, b]) => b.uses - a.uses)
    .slice(0, 50);

  if (dictEntries.length > 0) {
    const dictLines = dictEntries.map(
      ([, entry]) => `  - "${entry.fieldLabel}" → {{${entry.variable}}} (confirmed ${entry.uses}x)`,
    );
    sections.push(
      `KNOWN VARIABLE PATTERNS (previously confirmed by users):\n${dictLines.join('\n')}`,
    );
  }

  // Few-shot examples
  if (ctx.fewShotExamples.length > 0) {
    const exampleLines = ctx.fewShotExamples.slice(-5).map((ex) => {
      const vars = ex.detectedVariables.slice(0, 5).map(
        (v) => `    "${v.originalText}" → {{${v.confirmedVariable}}}`,
      ).join('\n');
      return `  Template: "${ex.templateName}" (${ex.docType})\n${vars}`;
    });
    sections.push(
      `EXAMPLES FROM PREVIOUSLY UPLOADED TEMPLATES:\n${exampleLines.join('\n\n')}`,
    );
  }

  // Custom fields
  if (ctx.patternConfig.customFields.length > 0) {
    const fieldLines = ctx.patternConfig.customFields.map(
      (f) => `  - ${f.path}: ${f.label}`,
    );
    sections.push(
      `ADDITIONAL CUSTOM FIELDS (firm-specific):\n${fieldLines.join('\n')}`,
    );
  }

  if (sections.length === 0) return '';

  return '\n\n--- LEARNING CONTEXT (from this firm\'s history) ---\n\n' + sections.join('\n\n') + '\n\n--- END LEARNING CONTEXT ---\n';
}

// ---------------------------------------------------------------------------
// Export learning data (for backup/portability)
// ---------------------------------------------------------------------------

export async function exportLearningData(firmId: string): Promise<LearningContext> {
  return getLearningContext(firmId);
}
