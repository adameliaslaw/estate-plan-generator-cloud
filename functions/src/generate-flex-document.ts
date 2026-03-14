/**
 * functions/src/generate-flex-document.ts
 *
 * Callable Cloud Function for flexible / ancillary document generation.
 * Handles document types beyond the core estate plan package:
 *
 *  - engagementLetter         Attorney-client engagement letter with fee agreement
 *  - coverLetter              Cover letter for document delivery or signing appointment
 *  - invoice                  Fee invoice for estate planning services
 *  - certificationOfTrust     Certification of Trust (N.J.S.A. 3B:31-32) — short-form trust cert
 *  - beneficiaryDesignation   Beneficiary designation instruction letter
 *  - trustAmendment           Amendment to Revocable Living Trust
 *  - trustRestatement         Full Trust Restatement (replaces the original trust)
 *  - petTrust                 Pet Trust provisions (N.J.S.A. 3B:31-43)
 *  - letterOfInstruction      Letter of Instruction to executor/trustee
 *  - memorandumOfPersonalProp Memorandum of Tangible Personal Property
 *  - codicil                  Codicil to Last Will and Testament
 *  - hipaaRelease             Standalone HIPAA Authorization
 *  - custom                   Free-form document based on customPrompt
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { callAI, sanitizeForPrompt, sanitizeObject, parseAIJson } from './ai-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FlexDocumentRequest {
  firmId: string;
  clientId: string;
  docType: string;
  /** Free-form additional instructions for the AI */
  customPrompt?: string;
  /** Additional data for specific doc types (e.g., amendment text) */
  additionalData?: Record<string, unknown>;
}

interface FlexGeneratedDoc {
  docType: string;
  title: string;
  content: string;
  status: 'draft';
}

// ---------------------------------------------------------------------------
// System prompts per flex document type
// ---------------------------------------------------------------------------

function buildFlexSystemPrompt(docType: string, customPrompt?: string): string {
  const baseContext = `
You are an expert New Jersey estate planning attorney. Generate professional, complete estate planning documents.
Always fill in all client data provided — never leave "[NAME]" or "[DATE]" placeholder tokens.
Output a JSON object with: { "title": "...", "content": "<complete HTML body — no html/body/head tags>" }
`.trim();

  const prompts: Record<string, string> = {
    engagementLetter: `
${baseContext}

Generate a professional attorney-client engagement letter for New Jersey estate planning services.

INCLUDE:
• Date, client name/address, attorney/firm name
• Description of scope of representation (estate planning — specify package)
• Fee agreement: flat fee amount, payment terms, what is/isn't included
• Retainer amount and how it will be applied
• Client responsibilities (providing accurate information, attending signing)
• Limitation of scope (only NJ estate planning — not tax advice, not other legal matters)
• File retention policy (7 years)
• Conflict of interest disclosure for joint representation of spouses
• Right to terminate representation
• Governing law: New Jersey
• Signature lines for both attorney and client(s)
• NJ Rules of Professional Conduct 1.5 (fees) and 1.2 (scope of representation) compliance
    `.trim(),

    coverLetter: `
${baseContext}

Generate a professional cover letter to accompany an estate planning document package.

INCLUDE:
• Date, salutation, brief introduction
• List of enclosed documents with brief description of each
• Signing instructions (which documents need witnesses/notary, how many copies to sign)
• What to do with the originals (safe storage) and copies (agents/representatives)
• Brief reminder about funding the trust (if applicable)
• Call to action: contact the office with questions; schedule signing appointment
• Firm signature block
    `.trim(),

    invoice: `
${baseContext}

Generate a professional invoice for estate planning services.

FORMAT AS AN INVOICE:
• Invoice number (use current date YYYYMMDD format)
• Date, due date (30 days from invoice date)
• Bill To: client name/address
• From: firm name/address
• Itemized services: list each document/service with fee
• Subtotal, any credit for retainer paid, balance due
• Payment methods accepted
• Late payment policy
• Thank you note
    `.trim(),

    certificationOfTrust: `
${baseContext}

Generate a Certification of Trust pursuant to N.J.S.A. 3B:31-32.

The Certification of Trust is a short document (typically 2-4 pages) that allows the trustee to prove the existence and terms of the trust to third parties (banks, title companies) WITHOUT disclosing the full trust document.

REQUIRED CONTENT per N.J.S.A. 3B:31-32:
• Trust name and date of creation
• Settlor(s) identity
• Currently acting trustee(s) identity and address
• Powers of trustee relevant to the transaction
• Trust is still in existence (has not been revoked or terminated)
• Trustee's authority to act for the requested purpose
• Whether the trust is revocable or irrevocable
• Trustee signature under penalty of perjury
• Notary acknowledgment
• Disclaimer: third parties may rely on this certification (N.J.S.A. 3B:31-32(d))
    `.trim(),

    beneficiaryDesignation: `
${baseContext}

Generate a Beneficiary Designation Instruction Letter for the client's retirement accounts and life insurance.

COVER:
• For each retirement account (IRA, 401k, etc.): recommended primary and contingent beneficiary designations
• For each life insurance policy: recommended primary and contingent beneficiary designations
• Explanation of why coordinating beneficiary designations with the trust plan is important
• Instructions: contact each institution's HR / customer service to obtain change-of-beneficiary forms
• Warning: do NOT name the estate as beneficiary of retirement accounts (adverse tax consequences)
• Spousal consent requirements for 401(k) plans (ERISA)
• Per stirpes vs. per capita note
    `.trim(),

    trustAmendment: `
${baseContext}

Generate an Amendment to Revocable Living Trust pursuant to N.J.S.A. 3B:31-28.

INCLUDE:
• Trust name and original date
• Amendment number (e.g., "First Amendment")
• Date of amendment
• Recitals: settlor's right to amend per trust terms and N.J.S.A. 3B:31-27
• SPECIFIC amended provisions (use the customPrompt for the actual amendment text)
• All other provisions remain in full force and effect
• Execution block: settlor signature, notary acknowledgment
• Instruction: attach this amendment to the original trust
    `.trim(),

    trustRestatement: `
${baseContext}

Generate a Restatement of Revocable Living Trust pursuant to N.J.S.A. 3B:31-27/28.

A Restatement completely replaces the original trust agreement while preserving the trust's identity (same trust name and date) so that previously funded assets remain in the trust without re-titling.

INCLUDE:
• Trust name and ORIGINAL date (the restatement date is noted separately)
• Recitals: identifies the original trust; states this restatement replaces it in its entirety
• All standard trust articles (same structure as a new revocable living trust)
• Statement that all assets previously conveyed to the trust remain in the trust
• Execution block with notarization
• Note: this restatement does NOT require new deeds for already-funded real property
    `.trim(),

    petTrust: `
${baseContext}

Generate Pet Trust provisions pursuant to N.J.S.A. 3B:31-43 (New Jersey allows pet trusts).

INCLUDE:
• Creation of a pet trust for named animal(s) with description (species, name, age)
• Caretaker designation (primary and alternate)
• Trustee for pet trust funds (may differ from main trust trustee)
• Funding amount (annual or lump sum)
• Distribution standard: for the care, maintenance, and well-being of the animal
• What happens to remaining funds when the pet dies (remainder to specified beneficiaries)
• Statement that trust terminates on death of last covered animal
• N.J.S.A. 3B:31-43 citation and compliance
    `.trim(),

    letterOfInstruction: `
${baseContext}

Generate a Letter of Instruction addressed to the executor/trustee. 

This is a NON-BINDING personal letter (NOT a legal document) that provides practical guidance.

INCLUDE:
• Location of important documents (will, trust, deed, POA, advance directive — specify where originals are stored)
• Financial account information (institutions, account numbers — last 4 only, contact info)
• Digital assets and passwords (location of password manager or instruction booklet)
• Insurance policies (company, policy number, agent contact)
• Business interests and succession information
• Personal wishes for funeral/memorial arrangements
• List of key contacts (accountant, financial advisor, insurance agent, attorney)
• Location of safe deposit box and key
• Pets and their care
• Personal messages or expressions of love (optional, personal tone allowed)
    `.trim(),

    memorandumOfPersonalProp: `
${baseContext}

Generate a Memorandum of Tangible Personal Property pursuant to N.J.S.A. 3B:3-9 (incorporated by reference into the will).

INCLUDE:
• Reference to will article incorporating this memorandum
• Table of specific items: Item | Description | Recipient | Notes
• Statement that the list may be updated without amending the will
• Signature and date lines for each update
• Note that this is incorporated by reference into the Last Will and Testament dated [Date]
• Items listed are personal property only (not real estate, cash, or financial accounts)
    `.trim(),

    codicil: `
${baseContext}

Generate a Codicil to Last Will and Testament pursuant to N.J.S.A. 3B:3-1 et seq.

A Codicil amends an existing will without replacing it entirely.

INCLUDE:
• Caption: "First [or appropriate number] Codicil to the Last Will and Testament of [Name]"
• Identification of original will by date
• Recitals confirming the original will remains in force except as modified
• SPECIFIC amendment language (from customPrompt)
• Republication: "In all other respects I hereby republish and reaffirm my said Last Will and Testament"
• Execution requirements: SAME as a will — testator signature + two adult non-beneficiary witnesses + self-proving affidavit (N.J.S.A. 3B:3-2/4)
    `.trim(),

    hipaaRelease: `
${baseContext}

Generate a standalone HIPAA Authorization (45 C.F.R. §164.508) authorizing designated individuals to access the principal's protected health information (PHI).

REQUIRED ELEMENTS per 45 C.F.R. §164.508(c):
• Specific description of information to be used/disclosed: ALL medical records and health information
• Person/class of persons authorized to make disclosure: all healthcare providers, hospitals, insurers
• Person/class of persons to whom disclosure is made: named healthcare representative(s) and alternates
• Expiration date/event: "until revoked in writing"
• Statement of the individual's right to revoke the authorization
• Statement that treatment is not conditioned on providing authorization
• Statement of potential for re-disclosure by the recipient
• Signature and date of principal
• If signed by personal representative: description of representative's authority
    `.trim(),

    custom: `
${baseContext}

Generate a custom New Jersey estate planning document based on the instructions provided.
Follow all NJ statutory requirements relevant to the document type.
Include appropriate execution requirements (signature, witnesses, notarization) as warranted.
    `.trim(),
  };

  let prompt = prompts[docType] ?? prompts.custom;

  if (customPrompt) {
    const safe = sanitizeForPrompt(customPrompt);
    prompt += `\n\nADDITIONAL INSTRUCTIONS FROM ATTORNEY:\n${safe}`;
  }

  return prompt;
}

// ---------------------------------------------------------------------------
// Cloud Function
// ---------------------------------------------------------------------------

export const generateFlexDocument = onCall(
  {
    timeoutSeconds: 300,
    memory: '512MiB',
    region: 'us-east1',
  },
  async (request: any /* CallableRequest */) => {
    // ------------------------------------------------------------------
    // 1. Auth check
    // ------------------------------------------------------------------
    const auth = request.auth;
    if (!auth) {
      throw new HttpsError('unauthenticated', 'You must be logged in.');
    }

    const role = auth.token.role as string | undefined;
    if (!role || !['admin', 'attorney', 'paralegal'].includes(role)) {
      throw new HttpsError('permission-denied', 'Insufficient permissions.');
    }

    const { firmId, clientId, docType, customPrompt, additionalData } =
      request.data as FlexDocumentRequest;

    if (!firmId || !clientId || !docType) {
      throw new HttpsError('invalid-argument', 'firmId, clientId, and docType are required.');
    }

    const db = admin.firestore();

    // Verify firm access
    if (role !== 'admin') {
      const callerFirmId = auth.token.firmId as string | undefined;
      if (callerFirmId && callerFirmId !== firmId) {
        throw new HttpsError('permission-denied', 'Cross-firm generation is not permitted.');
      }
    }

    // ------------------------------------------------------------------
    // 2. Fetch data
    // ------------------------------------------------------------------
    const [clientSnap, firmSnap] = await Promise.all([
      db.doc(`firms/${firmId}/clients/${clientId}`).get(),
      db.doc(`firms/${firmId}`).get(),
    ]);

    if (!clientSnap.exists) {
      throw new HttpsError('not-found', `Client ${clientId} not found.`);
    }
    if (!firmSnap.exists) {
      throw new HttpsError('not-found', `Firm ${firmId} not found.`);
    }

    const clientData = sanitizeObject(clientSnap.data()!);
    const firmData = sanitizeObject(firmSnap.data()!);

    const pi = (clientData as admin.firestore.DocumentData).personalInfo ?? {};
    const clientFullName = [pi.firstName, pi.middleName, pi.lastName, pi.suffix]
      .filter(Boolean)
      .join(' ');

    const packageType = (clientData as admin.firestore.DocumentData).packageDetails?.packageType ?? 'foundation';
    const packageFee = (clientData as admin.firestore.DocumentData).packageDetails?.estimatedFee;
    const trusts: admin.firestore.DocumentData[] = (clientData as admin.firestore.DocumentData).trusts ?? [];
    const distribution = (clientData as admin.firestore.DocumentData).distribution ?? {};
    const fiduciaries = (clientData as admin.firestore.DocumentData).fiduciaries ?? {};
    const executor = fiduciaries.executor ?? {};
    const trustee = fiduciaries.trustee ?? {};

    const primaryTrust = trusts[0];
    const trustName = sanitizeForPrompt(
      primaryTrust?.trustName ??
      distribution.trustName ??
      `The ${clientFullName} Revocable Living Trust`,
    );
    const trustDate = primaryTrust?.trustDate ?? '[Trust Date]';

    // ------------------------------------------------------------------
    // 3. Build user prompt with client context
    // ------------------------------------------------------------------
    const systemPrompt = buildFlexSystemPrompt(docType, customPrompt);

    const today = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    const userPrompt = `
Generate a "${docType}" document using this client data:

CLIENT:
  Full name: ${clientFullName}
  Address: ${pi.address}, ${pi.city}, ${pi.state} ${pi.zip}
  County: ${pi.county}
  Marital status: ${pi.maritalStatus}
  Phone: ${pi.phone}
  Email: ${pi.email}
  Date of birth: ${pi.dob}

PACKAGE: ${packageType}
${packageFee ? `Estimated fee: $${packageFee.toLocaleString()}` : ''}

${trusts.length > 0 ? `TRUST: ${trustName} dated ${trustDate}` : ''}

EXECUTOR: ${sanitizeForPrompt(executor.primary?.name ?? 'TBD')} (${sanitizeForPrompt(executor.primary?.relationship ?? '')})
${trusts.length > 0 ? `TRUSTEE: ${sanitizeForPrompt(trustee.primary?.name ?? clientFullName)} — Alternate: ${sanitizeForPrompt(trustee.alternate?.name ?? 'TBD')}` : ''}

FIRM:
  Name: ${sanitizeForPrompt(firmData.firmName ?? '')}
  Address: ${sanitizeForPrompt(firmData.firmAddress ?? '')}
  Phone: ${firmData.firmPhone ?? ''}
  Email: ${firmData.firmEmail ?? ''}
  Bar number: ${firmData.barNumber ?? ''}
  Website: ${firmData.firmWebsite ?? ''}

DATE: ${today}

${additionalData ? `ADDITIONAL DATA:\n${sanitizeForPrompt(JSON.stringify(additionalData, null, 2))}` : ''}

Generate the complete document now.
`.trim();

    console.log(`[generateFlexDocument] docType=${docType} client=${clientId}`);

    // ------------------------------------------------------------------
    // 4. Call AI
    // ------------------------------------------------------------------
    const raw = await callAI(systemPrompt, userPrompt, firmData, {
      model: 'gpt-5.4',
      temperature: docType === 'letterOfInstruction' || docType === 'coverLetter' ? 0.3 : 0.15,
      maxTokens: 6144,
      jsonMode: true,
    });

    let generated: FlexGeneratedDoc;
    try {
      const parsed = parseAIJson<{ title: string; content: string }>(raw);
      generated = {
        docType,
        title: parsed.title ?? `${docType} — ${clientFullName}`,
        content: parsed.content ?? '',
        status: 'draft',
      };
    } catch (err) {
      console.error(`[generateFlexDocument] Parse error for ${docType}:`, err);
      throw new HttpsError(
        'internal',
        `Failed to parse generated document: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    }

    // ------------------------------------------------------------------
    // 5. Save to Firestore
    // ------------------------------------------------------------------
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Use a timestamp-based doc ID for flex documents (multiple of same type allowed)
    const timestamp = Date.now();
    const docId = `${docType}_${timestamp}`;

    const docRef = db
      .collection('firms')
      .doc(firmId)
      .collection('clients')
      .doc(clientId)
      .collection('documents')
      .doc(docId);

    await docRef.set({
      id: docId,
      firmId,
      clientId,
      docType,
      displayName: generated.title,
      status: 'draft',
      content: generated.content,
      storagePath: '',
      fileName: `${docId}.html`,
      mimeType: 'text/html',
      currentVersion: 1,
      versions: [{
        versionNumber: 1,
        storagePath: '',
        createdAt: admin.firestore.Timestamp.now(),
        createdBy: auth.uid,
        changeNotes: 'Initial AI generation',
      }],
      generatedByAI: true,
      aiModel: 'gpt-5.4',
      requiresSignature: ['engagementLetter', 'codicil', 'trustAmendment', 'trustRestatement', 'hipaaRelease', 'certificationOfTrust'].includes(docType),
      notarized: ['certificationOfTrust', 'trustAmendment', 'trustRestatement', 'hipaaRelease'].includes(docType),
      tags: ['flex', docType],
      isConfidential: true,
      createdAt: now,
      updatedAt: now,
      createdBy: auth.uid,
      updatedBy: auth.uid,
    });

    // Update client updatedAt
    await db.doc(`firms/${firmId}/clients/${clientId}`).update({
      updatedAt: now,
      updatedBy: auth.uid,
    });

    console.log(`[generateFlexDocument] Saved ${docId}`);

    return {
      success: true,
      docId,
      docType,
      title: generated.title,
      status: 'draft',
    };
  },
);
