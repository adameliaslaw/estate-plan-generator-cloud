/**
 * PII stop-ship (checkpoint-2 finding C1): a family the §5.3 gate blocked
 * must not ship text to Firestore. Redaction is a whitelist — a text-bearing
 * field added to the doc later is blocked by default, not leaked by default.
 */
import { describe, expect, it } from 'vitest';
import { scrubBlockedCatalogDoc, scrubBlockedVariantDoc } from '../src/stages/catalog.js';

const TEXT_BEARING_DOC_FIELDS = [
  'canonicalText', 'title', 'functionSummary', 'switchName',
  'placeholders', 'triggerCard', 'embedding', 'itemization',
];

describe('scrubBlockedCatalogDoc', () => {
  const doc = {
    docType: 'trust',
    category: 'trustee-powers',
    title: 'Distribution to the [CLIENT NAME] children',
    functionSummary: 'Distributes to named children',
    canonicalText: 'I give to JOHN Q CLIENT …',
    switchName: 'clientChildrenDistribution',
    placeholders: [{ tag: 'X', kind: 'name', fillSource: 'contract' }],
    status: 'mined',
    structureConfidenceMix: { high: 3 },
    counts: { occurrences: 4, documents: 3, matters: 2 },
    positionMedian: 0.5,
    cooccurrence: [{ clauseId: 'fam_x', jaccard: 0.4, n: 2 }],
    relatedTo: ['fam_y'],
    triggerCard: { prose: 'Used when JOHN …', tier: 'exploratory', stats: [] },
    validation: { staleFlag: false },
    embedding: { __vector: [0.1, 0.2] },
    piiScanStatus: 'blocked',
    pipelineVersion: 'clause-miner/1',
    createdAt: 't', updatedAt: 't',
  };

  it('drops every text-bearing field', () => {
    const scrubbed = scrubBlockedCatalogDoc(doc);
    for (const field of TEXT_BEARING_DOC_FIELDS) {
      expect(scrubbed, field).not.toHaveProperty(field);
    }
  });

  it('keeps counts, ids and status so the entry remains visible as blocked', () => {
    const scrubbed = scrubBlockedCatalogDoc(doc);
    expect(scrubbed.counts).toEqual(doc.counts);
    expect(scrubbed.status).toBe('mined');
    expect(scrubbed.piiScanStatus).toBe('blocked');
    expect(scrubbed.relatedTo).toEqual(['fam_y']);
    expect(scrubbed.piiBlockedRedacted).toBe(true);
  });

  it('is a whitelist: an unknown future field does not survive', () => {
    const scrubbed = scrubBlockedCatalogDoc({ ...doc, someNewProseField: 'JOHN Q CLIENT' });
    expect(scrubbed).not.toHaveProperty('someNewProseField');
  });
});

describe('scrubBlockedVariantDoc', () => {
  const variant = {
    normText: 'I give to JOHN Q CLIENT …',
    occurrenceCount: 3,
    matterCount: 2,
    eraRange: [2001, 2015],
    parameters: { beneficiary: 'JOHN Q CLIENT' },
    mergeEdge: { ring: 1, scores: {}, diff: { changedA: ['JOHN'], changedB: ['JANE'] } },
  };

  it('drops normText, parameters and the diff tokens (the strings the gate fired on)', () => {
    const scrubbed = scrubBlockedVariantDoc(variant);
    expect(scrubbed).not.toHaveProperty('normText');
    expect(scrubbed).not.toHaveProperty('parameters');
    expect(scrubbed).not.toHaveProperty('mergeEdge');
    expect(scrubbed.occurrenceCount).toBe(3);
    expect(scrubbed.eraRange).toEqual([2001, 2015]);
    expect(scrubbed.piiBlockedRedacted).toBe(true);
  });
});
