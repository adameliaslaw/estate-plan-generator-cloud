/**
 * functions/src/firecrawl-scraper.ts
 *
 * Cloud Function to scrape estate planning drafting software websites via Firecrawl
 * and ingest the content into the firm's Knowledge Base for AI-assisted drafting.
 *
 * Covers: WealthCounsel, InterActive Legal, HotDocs, Smokeball, BeyondCounsel
 * Output: firms/{firmId}/knowledgeBase/ resources (practice_note category)
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { callAI, parseAIJson } from './ai-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ScrapeTarget {
  url: string;
  source: string;
  sourceLabel: string;
}

interface ScrapedPage {
  url: string;
  markdown: string;
  title?: string;
  description?: string;
}

interface ScrapeResult {
  url: string;
  source: string;
  resourceId: string;
  status: 'success' | 'failed' | 'skipped';
  chars: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Scrape targets — publicly accessible pages per estate planning platform
// ---------------------------------------------------------------------------

export const SOURCE_TARGETS: Record<string, { label: string; urls: string[] }> = {
  wealthcounsel: {
    label: 'WealthCounsel',
    urls: [
      'https://info.wealthcounsel.com/blog/rlt-drafting-101-general-concepts',
      'https://info.wealthcounsel.com/blog/drafting-estate-planning-documents-in-a-post-secure-act-environment',
      'https://info.wealthcounsel.com/blog/3-tips-to-streamline-your-drafting-process',
      'https://info.wealthcounsel.com/blog/what-to-expect-when-adding-estate-planning-to-your-firm',
      'https://info.wealthcounsel.com/blog/ai-and-the-future-of-estate-planning',
      'https://info.wealthcounsel.com/blog/before-you-purchase-estate-planning-software-read-this-article',
      'https://info.wealthcounsel.com/blog/adding-business-planning',
      'https://info.wealthcounsel.com/blog/getting-heet-ed-with-wealth-docx',
      'https://info.wealthcounsel.com/blog/annotated-self-settled-special-needs-trust-added-to-elderdocx',
      'https://info.wealthcounsel.com/blog/one-attorney-two-hats',
      'https://www.wealthcounsel.com/articles/drafting-third-party-spendthrift-trusts-after-u-s-v-harris',
      'https://www.wealthcounsel.com/software-for-attorneys/wealth-docx-complete',
      'https://www.wealthcounsel.com/software-for-attorneys/wealth-docx-core',
      'https://www.wealthcounsel.com/software-for-attorneys/elder-docx',
      'https://www.wealthcounsel.com/software-for-attorneys',
    ],
  },
  interactivelegal: {
    label: 'InterActive Legal',
    urls: [
      'https://interactivelegal.com',
      'https://interactivelegal.com/events',
      'https://interactivelegal.com/system-requirements/ils-legacy_corel-wordperfect',
    ],
  },
  smokeball: {
    label: 'Smokeball',
    urls: [
      'https://www.smokeball.com/practice-areas/estate-planning-software',
      'https://www.smokeball.com/features/templatelab',
      'https://www.smokeball.com/features/templatelab-custom-templates',
      'https://www.smokeball.com/blog/organize-estate-planning-with-law-firm-document-automation',
      'https://www.smokeball.com/blog/streamline-your-estate-planning-process-with-automated-workflows',
      'https://www.smokeball.com/blog/best-legal-document-automation-software',
      'https://www.smokeball.com/blog/legal-drafting-document-automation-software-revolutionize-law-firms',
      'https://support.smokeball.com/hc/en-us/articles/5961473537559-Estate-Planning-Workflows',
      'https://support.smokeball.com/hc/en-us/articles/27340702487063-Formatting-automated-templates',
    ],
  },
  hotdocs: {
    label: 'HotDocs',
    urls: [
      'https://www.hotdocs.com/solutions/legal',
      'https://www.hotdocs.com',
    ],
  },
  beyondcounsel: {
    label: 'BeyondCounsel',
    urls: [
      'https://www.beyondcounsel.com',
      'https://www.beyondcounsel.com/features',
    ],
  },
  bolsterbruderlegacy: {
    label: 'BolsterBruderLegacy',
    urls: [
      'https://www.bolster-bruder.com',
    ],
  },
};

// Source values used to query existing KB resources (firecrawl-{source} prefix)
const FIRECRAWL_SOURCE_PREFIXES = Object.keys(SOURCE_TARGETS).map(s => `firecrawl-${s}`);

// ---------------------------------------------------------------------------
// Firecrawl REST API helper
// ---------------------------------------------------------------------------

const FIRECRAWL_SCRAPE_URL = 'https://api.firecrawl.dev/v1/scrape';

async function firecrawlScrape(url: string, apiKey: string): Promise<ScrapedPage | null> {
  const response = await fetch(FIRECRAWL_SCRAPE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      url,
      formats: ['markdown'],
      onlyMainContent: true,
      excludeTags: ['nav', 'footer', 'header', 'aside', 'script', 'style', '.sidebar', '.navigation', '.cookie-banner'],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Firecrawl HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  const data = await response.json() as {
    success: boolean;
    data?: {
      markdown?: string;
      metadata?: { title?: string; description?: string };
    };
  };

  if (!data.success || !data.data?.markdown) return null;

  return {
    url,
    markdown: data.data.markdown,
    title: data.data.metadata?.title,
    description: data.data.metadata?.description,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > maxLen * 0.8 ? cut.slice(0, lastSpace) + '…' : cut + '…';
}

async function enrichResource(
  firmId: string,
  resourceId: string,
  text: string,
  firmData: Record<string, unknown>,
): Promise<void> {
  const snippet = truncateAtWord(text, 6000);

  const systemPrompt = `You are a legal research assistant specializing in New Jersey estate planning law.
Analyze the following text and extract structured metadata. Return a valid JSON object with these fields:
{
  "title": "concise descriptive title",
  "citation": "legal citation if present (e.g., N.J.S.A. 3B:3-2), or empty string",
  "category": one of "statute", "case_law", "cle_material", "checklist", "form_template", "practice_note", "custom",
  "tags": ["array", "of", "relevant", "tags"],
  "docTypes": ["array of applicable document types from: will, pourOverWill, poa, livingWill, trust, deed, affidavitOfConsideration, gitRep3, estatePlanSummary"],
  "summary": "one paragraph summary of the content"
}
Respond with ONLY the JSON object, no markdown fences.`;

  try {
    const raw = await callAI(systemPrompt, `Analyze this text:\n\n${snippet}`, firmData, {
      model: 'mercury-2',
      temperature: 0.1,
      maxTokens: 1024,
      jsonMode: true,
    });

    const parsed = parseAIJson<{
      title?: string;
      citation?: string;
      category?: string;
      tags?: string[];
      docTypes?: string[];
      summary?: string;
    }>(raw);

    const updates: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      aiEnrichedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (parsed.title) updates.title = parsed.title;
    if (parsed.citation) updates.citation = parsed.citation;
    if (parsed.category) updates.category = parsed.category;
    if (parsed.tags?.length) updates.tags = parsed.tags;
    if (parsed.docTypes?.length) updates.docTypes = parsed.docTypes;
    if (parsed.summary) updates.contentSummary = parsed.summary;

    await admin.firestore().doc(`firms/${firmId}/knowledgeBase/${resourceId}`).update(updates);
    console.log(`[firecrawlScraper] Enriched resource ${resourceId}: "${parsed.title}"`);
  } catch (err) {
    console.error(`[firecrawlScraper] AI enrichment failed for ${resourceId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const scrapeEstatePlanningSoftware = onCall(
  {
    region: 'us-east1',
    memory: '1GiB',
    timeoutSeconds: 540,
    secrets: ['FIRECRAWL_API_KEY', 'MERCURY_API_KEY'],
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in required.');

    const { firmId, sources } = request.data as {
      firmId: string;
      sources?: string[];
    };

    if (!firmId) throw new HttpsError('invalid-argument', 'firmId is required.');

    const role = request.auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney'].includes(role)) {
      throw new HttpsError('permission-denied', 'Only admins and attorneys can trigger scraping.');
    }
    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot scrape for a different firm.');
    }

    const apiKey = process.env.FIRECRAWL_API_KEY;
    if (!apiKey) throw new HttpsError('internal', 'FIRECRAWL_API_KEY secret not configured.');

    const firmSnap = await admin.firestore().collection('firms').doc(firmId).get();
    const firmData = firmSnap.data() ?? {};

    // Resolve which sources to process
    const activeSources = (sources?.length
      ? sources.filter(s => s in SOURCE_TARGETS)
      : Object.keys(SOURCE_TARGETS)
    ).filter(s => SOURCE_TARGETS[s].urls.length > 0);

    if (activeSources.length === 0) {
      throw new HttpsError('invalid-argument', 'No valid sources found.');
    }

    const targets: ScrapeTarget[] = activeSources.flatMap(source =>
      SOURCE_TARGETS[source].urls.map(url => ({
        url,
        source,
        sourceLabel: SOURCE_TARGETS[source].label,
      }))
    );

    // Deduplicate against already-scraped URLs for this firm
    const db = admin.firestore();
    const col = db.collection('firms').doc(firmId).collection('knowledgeBase');

    // Firestore `in` supports up to 30 values; we have at most ~6 source prefixes
    const existingSnap = await col
      .where('source', 'in', FIRECRAWL_SOURCE_PREFIXES)
      .select('sourceUrl')
      .get();
    const alreadyScraped = new Set(
      existingSnap.docs.map(d => (d.data().sourceUrl as string) ?? ''),
    );

    const now = admin.firestore.FieldValue.serverTimestamp();
    const results: ScrapeResult[] = [];
    const enrichmentPromises: Promise<void>[] = [];

    for (const target of targets) {
      if (alreadyScraped.has(target.url)) {
        console.log(`[firecrawlScraper] Skipping already-scraped URL: ${target.url}`);
        results.push({ url: target.url, source: target.source, resourceId: '', status: 'skipped', chars: 0 });
        continue;
      }

      try {
        console.log(`[firecrawlScraper] Scraping: ${target.url}`);
        const page = await firecrawlScrape(target.url, apiKey);

        if (!page || page.markdown.trim().length < 100) {
          results.push({ url: target.url, source: target.source, resourceId: '', status: 'skipped', chars: 0, error: 'Insufficient content returned' });
          continue;
        }

        const content = truncateAtWord(page.markdown, 50000);
        const title = page.title ?? target.url.split('/').filter(Boolean).pop() ?? target.sourceLabel;

        const ref = col.doc();
        await ref.set({
          id: ref.id,
          firmId,
          category: 'practice_note',
          title,
          citation: '',
          content,
          contentHtml: '',
          contentSource: 'firecrawl',
          tags: [target.source, 'estate-planning', 'drafting-software'],
          docTypes: [],
          jurisdiction: 'NJ',
          isActive: true,
          source: `firecrawl-${target.source}`,
          sourceUrl: target.url,
          sourceSoftware: target.source,
          sourceSoftwareLabel: target.sourceLabel,
          createdAt: now,
          updatedAt: now,
          createdBy: request.auth!.uid,
          updatedBy: request.auth!.uid,
        });

        results.push({
          url: target.url,
          source: target.source,
          resourceId: ref.id,
          status: 'success',
          chars: content.length,
        });

        if (content.length >= 50) {
          enrichmentPromises.push(enrichResource(firmId, ref.id, content, firmData));
        }
      } catch (err) {
        console.error(`[firecrawlScraper] Error on "${target.url}":`, err);
        results.push({
          url: target.url,
          source: target.source,
          resourceId: '',
          status: 'failed',
          chars: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    if (enrichmentPromises.length > 0) {
      console.log(`[firecrawlScraper] Awaiting AI enrichment for ${enrichmentPromises.length} resources...`);
      await Promise.allSettled(enrichmentPromises);
    }

    const saved = results.filter(r => r.status === 'success').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const failed = results.filter(r => r.status === 'failed').length;

    console.log(`[firecrawlScraper] Done: ${saved} saved, ${skipped} skipped, ${failed} failed for firm ${firmId}`);

    return { success: true, saved, skipped, failed, total: targets.length, results };
  },
);
