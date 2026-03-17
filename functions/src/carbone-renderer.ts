/**
 * functions/src/carbone-renderer.ts
 *
 * Carbone.io DOCX template rendering engine.
 *
 * Renders AI-generated document data into professional DOCX templates
 * uploaded by the firm. Uses Carbone's template syntax ({d.fieldName})
 * to populate templates with client/document data.
 *
 * This complements the existing export-docx.ts (which builds DOCX from
 * scratch) by allowing firms to use their own DOCX templates with
 * precise formatting.
 *
 * Architecture:
 *   1. Check if a DOCX template exists for the document type in the firm's
 *      template collection (Cloud Storage)
 *   2. If yes → download template, render via Carbone, return Buffer
 *   3. If no  → fall back to export-docx.ts built-from-scratch approach
 *
 * Template tag conventions:
 *   {d.clientFullName}      - Computed field from client-context-aggregator
 *   {d.content}             - The full AI-generated content
 *   {d.title}               - Document title
 *   {d.todayFormatted}      - Today's date
 *   {d.client.personalInfo.firstName} - Nested client data
 *   {d.children[i].firstName}         - Arrays with iteration
 */

import * as admin from 'firebase-admin';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CarboneRenderOptions {
  /** Firm ID to look up templates */
  firmId: string;
  /** Document type (e.g., 'will', 'trust', 'poa') to match template */
  docType: string;
  /** Data object to merge into the template */
  data: Record<string, unknown>;
  /** Optional: specific template path in Cloud Storage */
  templatePath?: string;
}

export interface CarboneRenderResult {
  /** The rendered DOCX as a Buffer */
  buffer: Buffer;
  /** Whether Carbone was used (vs fallback) */
  usedTemplate: boolean;
  /** Template file name used (if any) */
  templateName?: string;
}

// ---------------------------------------------------------------------------
// Template discovery
// ---------------------------------------------------------------------------

/**
 * Look for a DOCX template matching the document type in the firm's
 * template storage. Templates are stored as:
 *   firms/{firmId}/templates/{docType}.docx
 * or referenced in the templates Firestore collection.
 */
async function findDocxTemplate(
  firmId: string,
  docType: string,
  specificPath?: string,
): Promise<Buffer | null> {
  const bucket = admin.storage().bucket();

  // 1. If a specific path is provided, use that
  if (specificPath) {
    try {
      const file = bucket.file(specificPath);
      const [exists] = await file.exists();
      if (exists) {
        const [data] = await file.download();
        return data;
      }
    } catch (err) {
      console.warn(`[Carbone] Specific template not found: ${specificPath}`, err);
    }
    return null;
  }

  // 2. Check Firestore for a registered DOCX template
  const db = admin.firestore();
  const templateSnap = await db
    .collection(`firms/${firmId}/templates`)
    .where('docType', '==', docType)
    .where('isActive', '==', true)
    .where('fileType', '==', 'docx')
    .limit(1)
    .get();

  if (!templateSnap.empty) {
    const templateData = templateSnap.docs[0].data();
    const storagePath = templateData.storagePath as string;
    if (storagePath) {
      try {
        const file = bucket.file(storagePath);
        const [data] = await file.download();
        console.log(`[Carbone] Found DOCX template: ${storagePath}`);
        return data;
      } catch (err) {
        console.warn(`[Carbone] Template download failed: ${storagePath}`, err);
      }
    }
  }

  // 3. Check default storage paths
  const defaultPaths = [
    `firms/${firmId}/docx-templates/${docType}.docx`,
    `firms/${firmId}/templates/${docType}.docx`,
  ];

  for (const path of defaultPaths) {
    try {
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (exists) {
        const [data] = await file.download();
        console.log(`[Carbone] Found DOCX template at default path: ${path}`);
        return data;
      }
    } catch {
      // Continue checking other paths
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Carbone rendering
// ---------------------------------------------------------------------------

/**
 * Render a DOCX template with Carbone.
 *
 * Uses the `carbone` npm package (self-hosted, no API key needed).
 * Carbone replaces template tags like {d.fieldName} with actual values.
 */
async function renderWithCarbone(
  templateBuffer: Buffer,
  data: Record<string, unknown>,
): Promise<Buffer> {
  // Use require() for optional dependency — carbone may not be installed
  type RenderFn = (templatePath: string, data: Record<string, unknown>, options: Record<string, unknown>, cb: (err: unknown, result: unknown) => void) => void;
  let render: RenderFn;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('carbone') as { render: RenderFn };
    render = mod.render;
  } catch {
    throw new Error(
      'Carbone package not installed. Run: npm install carbone --save in the functions directory.'
    );
  }

  // Carbone's render() expects a FILE PATH, not a Buffer.
  // Write the template to a temp file, render, then clean up.
  const os = await import('os');
  const fs = await import('fs');
  const path = await import('path');
  const tmpPath = path.join(os.tmpdir(), `carbone-template-${Date.now()}.docx`);

  try {
    fs.writeFileSync(tmpPath, templateBuffer);

    return await new Promise((resolve, reject) => {
      render(
        tmpPath,
        data,
        {
          convertTo: null, // Keep as DOCX (don't convert to PDF)
          complement: {},  // Additional data accessible via {c.field}
        },
        (err: unknown, result: unknown) => {
          if (err) {
            console.error('[Carbone] Render error:', err);
            reject(new Error(`Carbone render failed: ${err}`));
            return;
          }
          resolve(result as Buffer);
        },
      );
    });
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Attempt to render a document using a Carbone DOCX template.
 * Returns null if no template is found (caller should fall back to
 * the built-from-scratch DOCX approach).
 */
export async function renderDocxFromTemplate(
  options: CarboneRenderOptions,
): Promise<CarboneRenderResult | null> {
  const { firmId, docType, data, templatePath } = options;

  // 1. Find a DOCX template
  const templateBuffer = await findDocxTemplate(firmId, docType, templatePath);
  if (!templateBuffer) {
    console.log(`[Carbone] No DOCX template found for ${docType} — caller should use fallback`);
    return null;
  }

  console.log(`[Carbone] Rendering ${docType} with template (${templateBuffer.length} bytes)`);

  // 2. Prepare data for Carbone — flatten computed fields to top level
  const carboneData: Record<string, unknown> = {
    ...data,
    // Ensure common fields are accessible at top level
    today: (data.todayFormatted as string) ?? new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
  };

  // 3. Render
  const buffer = await renderWithCarbone(templateBuffer, carboneData);

  return {
    buffer,
    usedTemplate: true,
    templateName: templatePath ?? `${docType}.docx`,
  };
}

// ---------------------------------------------------------------------------
// Helper: Build Carbone data object from client context
// ---------------------------------------------------------------------------

/**
 * Transforms a ClientContext into a flat data object suitable for
 * Carbone template tags. This makes template authoring easier since
 * users can access fields like {d.clientFullName} instead of
 * {d.computed.clientFullName}.
 */
export function buildCarboneData(
  clientContext: Record<string, unknown>,
  documentData?: { title?: string; content?: string },
): Record<string, unknown> {
  const computed = (clientContext.computed ?? {}) as Record<string, unknown>;
  const client = (clientContext.client ?? {}) as Record<string, unknown>;
  const firm = (clientContext.firm ?? {}) as Record<string, unknown>;
  const pi = (client.personalInfo ?? {}) as Record<string, unknown>;
  const spouse = (client.spouseInfo ?? {}) as Record<string, unknown>;

  return {
    // Document data
    title: documentData?.title ?? '',
    content: documentData?.content ?? '',

    // Computed fields (top-level for easy access)
    ...computed,

    // Client personal info (top-level)
    clientFirstName: pi.firstName ?? '',
    clientLastName: pi.lastName ?? '',
    clientMiddleName: pi.middleName ?? '',
    clientSuffix: pi.suffix ?? '',
    clientAddress: pi.address ?? '',
    clientCity: pi.city ?? '',
    clientState: pi.state ?? 'NJ',
    clientZip: pi.zip ?? '',
    clientCounty: pi.county ?? '',
    clientDOB: pi.dateOfBirth ?? '',
    clientSSNLast4: pi.ssnLast4 ?? '',

    // Spouse info (top-level)
    spouseFirstName: spouse?.firstName ?? '',
    spouseLastName: spouse?.lastName ?? '',
    spouseMiddleName: spouse?.middleName ?? '',
    spouseAddress: spouse?.address ?? '',
    spouseCity: spouse?.city ?? '',
    spouseState: spouse?.state ?? '',
    spouseZip: spouse?.zip ?? '',
    spouseCounty: spouse?.county ?? '',
    spouseDOB: spouse?.dateOfBirth ?? '',

    // Firm info
    firmName: firm.firmName ?? firm.name ?? '',
    firmAddress: firm.address ?? '',
    firmPhone: firm.phone ?? '',
    firmEmail: firm.email ?? '',
    attorneyName: firm.attorneyName ?? '',
    attorneyBarNumber: firm.barNumber ?? '',

    // Full nested data for advanced templates
    client,
    firm,
    personalInfo: pi,
    spouseInfo: spouse,
    children: client.children ?? [],
    assets: client.assets ?? {},
    fiduciaries: client.fiduciaries ?? {},
    distribution: client.distribution ?? {},
  };
}
