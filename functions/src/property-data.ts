/**
 * functions/src/property-data.ts
 *
 * ATTOM Property Data API integration.
 * Auto-populates property details (legal description, tax block/lot,
 * assessed value, deed book/page) from just an address.
 *
 * API docs: https://api.gateway.attomdata.com/propertyapi/v1.0.0/
 *
 * Usage:
 *   - Callable Cloud Function `lookupPropertyData` — takes an address,
 *     returns enriched property details.
 *   - Used by the questionnaire real estate section to pre-fill fields.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PropertyDataResult {
  /** Full legal description from tax records */
  legalDescription: string;
  /** Tax block and lot number (e.g., "Block 123, Lot 4") */
  taxBlockLot: string;
  /** Assessed value in dollars */
  assessedValue: number;
  /** Deed book reference */
  deedBook: string;
  /** Deed page reference */
  deedPage: string;
  /** Lot size in sq ft */
  lotSize: number;
  /** Year built */
  yearBuilt: number;
  /** Property type (e.g., "Single Family", "Condo") */
  propertyType: string;
  /** County name */
  county: string;
  /** Raw ATTOM property ID for reference */
  attomId: string;
}

// ---------------------------------------------------------------------------
// ATTOM API client
// ---------------------------------------------------------------------------

const ATTOM_BASE_URL = 'https://api.gateway.attomdata.com/propertyapi/v1.0.0';

async function getAttomApiKey(firmId: string): Promise<string> {
  const db = admin.firestore();
  const firmSnap = await db.doc(`firms/${firmId}`).get();
  const firmData = firmSnap.data();

  const apiKey =
    firmData?.attomApiKey ??
    firmData?.settings?.attomApiKey ??
    process.env.ATTOM_API_KEY;

  if (!apiKey) {
    throw new HttpsError(
      'failed-precondition',
      'ATTOM API key not configured. Set it in firm settings or as ATTOM_API_KEY environment variable.'
    );
  }

  return apiKey as string;
}

interface AttomPropertyResponse {
  status?: { code: number; msg: string };
  property?: Array<Record<string, unknown>>;
}

async function callAttomApi(
  endpoint: string,
  params: Record<string, string>,
  apiKey: string,
): Promise<AttomPropertyResponse> {
  const url = new URL(`${ATTOM_BASE_URL}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.append(key, value);
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'apikey': apiKey,
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    console.error(`[ATTOM] API error ${response.status}: ${errorText}`);

    if (response.status === 404) {
      throw new HttpsError('not-found', 'Property not found in ATTOM database.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpsError('permission-denied', 'Invalid or expired ATTOM API key.');
    }

    throw new HttpsError(
      'internal',
      `ATTOM API returned ${response.status}: ${errorText}`
    );
  }

  return response.json() as Promise<AttomPropertyResponse>;
}

// ---------------------------------------------------------------------------
// Property lookup
// ---------------------------------------------------------------------------

export async function lookupPropertyByAddress(
  address: string,
  city: string,
  state: string,
  zip: string,
  apiKey: string,
): Promise<PropertyDataResult> {
  // Use the ATTOM property detail endpoint with address
  const detailResponse = await callAttomApi('/property/detail', {
    address1: address,
    address2: `${city}, ${state} ${zip}`,
  }, apiKey);

  const properties = detailResponse.property ?? [];
  if (properties.length === 0) {
    throw new HttpsError('not-found', 'No property found matching this address.');
  }

  const prop = properties[0];
  const lot = prop.lot as Record<string, unknown> | undefined;
  const assessment = prop.assessment as Record<string, unknown> | undefined;
  const summary = prop.summary as Record<string, unknown> | undefined;
  const area = prop.area as Record<string, unknown> | undefined;
  const address_info = prop.address as Record<string, unknown> | undefined;
  const identifier = prop.identifier as Record<string, unknown> | undefined;

  // Try to get assessment data separately if not included
  let assessedValue = 0;
  if (assessment?.assessed) {
    const assessed = assessment.assessed as Record<string, unknown>;
    assessedValue = (assessed.assdTtlValue as number) ?? 0;
  }

  // Build the legal description from lot data
  let legalDescription = '';
  if (lot?.legalDescription) {
    legalDescription = lot.legalDescription as string;
  } else if (lot?.legalSubdivisionName) {
    legalDescription = `${lot.legalSubdivisionName}`;
    if (lot.legalLot) legalDescription += `, Lot ${lot.legalLot}`;
    if (lot.legalBlock) legalDescription += `, Block ${lot.legalBlock}`;
  }

  // Build tax block/lot
  let taxBlockLot = '';
  if (lot?.legalBlock && lot?.legalLot) {
    taxBlockLot = `Block ${lot.legalBlock}, Lot ${lot.legalLot}`;
  } else if (identifier?.apn) {
    taxBlockLot = identifier.apn as string;
  }

  // Property type from summary
  let propertyType = '';
  if (summary?.propclass) {
    propertyType = summary.propclass as string;
  } else if (summary?.proptype) {
    propertyType = summary.proptype as string;
  }

  return {
    legalDescription,
    taxBlockLot,
    assessedValue,
    deedBook: (lot?.deedBook as string) ?? '',
    deedPage: (lot?.deedPage as string) ?? '',
    lotSize: (lot?.lotSize1 as number) ?? (area?.lotSize as number) ?? 0,
    yearBuilt: (summary?.yearBuilt as number) ?? 0,
    propertyType,
    county: (address_info?.countrySubd as string) ?? '',
    attomId: (identifier?.attomId as string) ?? (identifier?.Id as string) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const lookupPropertyData = onCall(
  {
    region: 'us-east1',
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    // Require authentication
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be logged in.');
    }

    const { firmId, address, city, state, zip } = request.data as {
      firmId?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
    };

    if (!firmId || !address || !city || !state || !zip) {
      throw new HttpsError(
        'invalid-argument',
        'Missing required fields: firmId, address, city, state, zip.',
      );
    }

    if ((request.auth.token['firmId'] as string | undefined) !== firmId) {
      throw new HttpsError('permission-denied', 'Cannot look up property data for a different firm.');
    }

    console.log(`[lookupPropertyData] Looking up: ${address}, ${city}, ${state} ${zip}`);

    const apiKey = await getAttomApiKey(firmId);
    const result = await lookupPropertyByAddress(address, city, state, zip, apiKey);

    console.log(`[lookupPropertyData] Found property: ${result.attomId}, type: ${result.propertyType}`);

    return result;
  }
);
