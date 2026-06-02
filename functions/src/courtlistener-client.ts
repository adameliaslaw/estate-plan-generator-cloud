/**
 * functions/src/courtlistener-client.ts
 *
 * Legal case law retrieval from CourtListener (free, public API).
 *
 * CourtListener: https://www.courtlistener.com/help/api/rest/
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface CaseLawResult {
  caseName: string;
  citation: string;
  court: string;
  dateFiled: string;
  snippet: string;
  url: string;
  source: 'courtlistener';
}

interface CourtListenerOpinion {
  caseName?: string;
  citation?: string[];
  court?: string;
  dateFiled?: string;
  snippet?: string;
  absolute_url?: string;
}

interface CourtListenerResponse {
  count: number;
  results: CourtListenerOpinion[];
}

// ---------------------------------------------------------------------------
// CourtListener
// ---------------------------------------------------------------------------

const CL_BASE = 'https://www.courtlistener.com/api/rest/v4';

// NJ + federal courts most relevant to NJ estate planning
const NJ_COURTS = ['nj', 'njappd', 'ca3', 'scotus'];

export async function searchCourtListener(
  query: string,
  apiKey: string,
  maxResults = 5,
): Promise<CaseLawResult[]> {
  if (!apiKey) return [];

  try {
    const params = new URLSearchParams({
      q: query,
      type: 'o',
      order_by: 'score desc',
      stat_Precedential: 'on',
      page_size: String(maxResults),
    });
    for (const court of NJ_COURTS) params.append('court', court);

    const response = await fetch(`${CL_BASE}/search/?${params.toString()}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    if (!response.ok) {
      console.warn(`[courtlistener] ${response.status}: ${await response.text()}`);
      return [];
    }

    const data = (await response.json()) as CourtListenerResponse;

    return (data.results ?? []).map((op) => ({
      caseName: op.caseName ?? 'Unknown Case',
      citation: Array.isArray(op.citation) ? (op.citation[0] ?? '') : (op.citation ?? ''),
      court: op.court ?? '',
      dateFiled: op.dateFiled ?? '',
      snippet: op.snippet ?? '',
      url: op.absolute_url ? `https://www.courtlistener.com${op.absolute_url}` : '',
      source: 'courtlistener' as const,
    }));
  } catch (err) {
    console.warn('[courtlistener] search failed:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Combined legal search
// ---------------------------------------------------------------------------
export async function searchCaseLaw(
  query: string,
  courtListenerKey: string,
): Promise<{ results: CaseLawResult[]; contextString: string }> {
  const results = await searchCourtListener(query, courtListenerKey);

  if (results.length === 0) return { results: [], contextString: '' };

  const contextString = results
    .map((r, i) =>
      `[Case ${i + 1}] ${r.caseName}${r.citation ? ` — ${r.citation}` : ''} (${r.court}, ${r.dateFiled})\n${r.snippet}`,
    )
    .join('\n\n---\n\n');

  return { results, contextString };
}

/** Format case results as citation strings for the ChatAiResponse.citations field. */
export function formatCaseCitations(cases: CaseLawResult[]): string[] {
  return cases.map((r) => {
    const parts = [r.caseName];
    if (r.citation) parts.push(r.citation);
    if (r.dateFiled) parts.push(r.dateFiled.slice(0, 4));
    if (r.url) parts.push(r.url);
    return parts.join(' | ');
  });
}
