/**
 * functions/src/verify-citations.ts
 *
 * Extracts legal citations from pasted text and verifies each one against
 * CourtListener's public API. Returns a per-citation health report so
 * attorneys can catch hallucinated citations before filing.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CitationCheckRequest {
  firmId: string;
  text: string;
}

export interface CitationResult {
  raw: string;
  status: 'verified' | 'not_found' | 'error';
  caseName?: string;
  court?: string;
  dateFiled?: string;
  url?: string;
}

export interface CitationCheckResponse {
  citations: CitationResult[];
  checkedAt: string;
}

// ---------------------------------------------------------------------------
// Citation extraction
// ---------------------------------------------------------------------------

// Covers the most common US legal reporter formats attorneys encounter:
//   Federal:  123 F.3d 456  |  123 F. Supp. 2d 456  |  123 U.S. 456  |  123 S. Ct. 456
//   NJ:       123 N.J. 456  |  123 N.J. Super. 456   |  123 A.3d 456
//   General:  123 B.R. 456  |  123 P.3d 456
const CITATION_RE =
  /\b\d{1,4}\s+(?:F\.\d*(?:th|[234]d|st)?|F\.\s*Supp\.(?:\s*\d+[a-z]+)?|U\.S\.|S\.\s*Ct\.|L\.\s*Ed\.\s*\d*[a-z]*|N\.J\.\s*(?:Super\.|Eq\.)?|A\.\d+[a-z]+|B\.R\.|P\.\d+[a-z]+|Cal\.\s*(?:App\.\s*\d+[a-z]+)?|N\.Y\.\s*\d*[a-z]*|Tex\.)\s*\d{1,4}\b/gi;

export function extractCitations(text: string): string[] {
  const matches = text.match(CITATION_RE) ?? [];
  // Deduplicate preserving first occurrence order
  return [...new Set(matches.map((m) => m.replace(/\s+/g, ' ').trim()))];
}

// ---------------------------------------------------------------------------
// CourtListener lookup
// ---------------------------------------------------------------------------

const CL_BASE = 'https://www.courtlistener.com/api/rest/v4';

interface CLOpinion {
  caseName?: string;
  court?: string;
  dateFiled?: string;
  absolute_url?: string;
}

export async function lookupCitation(
  citation: string,
  apiKey: string,
): Promise<CitationResult> {
  try {
    const params = new URLSearchParams({
      q: `"${citation}"`,
      type: 'o',
      order_by: 'score desc',
      stat_Precedential: 'on',
      page_size: '1',
    });

    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Token ${apiKey}`;

    const res = await fetch(`${CL_BASE}/search/?${params.toString()}`, {
      headers,
    });

    if (!res.ok) {
      console.warn(`[verifyCitations] CourtListener ${res.status} for "${citation}"`);
      return { raw: citation, status: 'error' };
    }

    const data = (await res.json()) as { count: number; results: CLOpinion[] };

    if (data.count === 0 || data.results.length === 0) {
      return { raw: citation, status: 'not_found' };
    }

    const op = data.results[0];
    return {
      raw: citation,
      status: 'verified',
      caseName: op.caseName,
      court: op.court,
      dateFiled: op.dateFiled,
      url: op.absolute_url ? `https://www.courtlistener.com${op.absolute_url}` : undefined,
    };
  } catch (err) {
    console.warn(`[verifyCitations] lookup failed for "${citation}":`, err);
    return { raw: citation, status: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Callable function
// ---------------------------------------------------------------------------

export const verifyCitations = onCall(
  { region: 'us-east1', invoker: 'public', cors: true, timeoutSeconds: 60 },
  async (request: CallableRequest<CitationCheckRequest>): Promise<CitationCheckResponse> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in.');
    }

    const { firmId, text } = request.data ?? {};

    if (!firmId || typeof text !== 'string' || !text.trim()) {
      throw new HttpsError('invalid-argument', 'firmId and non-empty text are required.');
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot verify citations for a different firm.');
    }

    if (text.length > 50_000) {
      throw new HttpsError('invalid-argument', 'Text exceeds 50,000 character limit.');
    }

    // Get firm's CourtListener API key (optional — CL allows unauthenticated
    // requests at reduced rate limits)
    const db = admin.firestore();
    const firmSnap = await db.doc(`firms/${firmId}`).get();
    const firmData = firmSnap.data() ?? {};
    const apiKey = (firmData['courtlistenerApiKey'] as string | undefined) ?? '';

    const citations = extractCitations(text);

    if (citations.length === 0) {
      return { citations: [], checkedAt: new Date().toISOString() };
    }

    // Cap at 20 citations per call to stay within timeout
    const toCheck = citations.slice(0, 20);

    const results = await Promise.all(
      toCheck.map((c) => lookupCitation(c, apiKey)),
    );

    return { citations: results, checkedAt: new Date().toISOString() };
  },
);
