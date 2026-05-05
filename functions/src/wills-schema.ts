/**
 * functions/src/wills-schema.ts
 *
 * TypeScript type definitions for the Wills → PageIndex ingestion pipeline.
 *
 * Schema version: 1.0
 *
 * Universal fields: Section 3.1 of the build runbook (locked).
 * Controlled vocabularies: Section 3.3 of the build runbook (locked).
 * Type-specific fields: inferred from Section 8.2 extraction prompt —
 *   marked DRAFT pending review of Wills_Metadata_Schema_v1.0.docx.
 *   Do NOT start Phase 5 (backfill) until Adam has reviewed and corrected
 *   the type-specific interfaces below.
 */

// ---------------------------------------------------------------------------
// Controlled vocabularies (Section 3.3 — do not add values without updating
// the extraction prompt accordingly)
// ---------------------------------------------------------------------------

export const TRUST_STRUCTURES = [
  'QTIP', 'Spendthrift', 'GST', 'Bypass', 'Credit-Shelter', 'Special-Needs',
  'Marital-Deduction', 'Generation-Skipping', 'Charitable-Remainder',
  'Pour-Over', 'Testamentary', 'Inter-Vivos-Reference', 'ILIT', 'IDGT', 'Other',
] as const;

export const BENEFICIARY_CATEGORIES = [
  'Spouse', 'Children', 'Grandchildren', 'Siblings', 'Parents',
  'Charity', 'Trust', 'Specific-Bequest', 'Residuary', 'Other',
] as const;

export const POWERS_GRANTED = [
  'Real-Estate', 'Banking', 'Investments', 'Tax', 'Retirement', 'Gifts',
  'Trust-Powers', 'Business-Operations', 'Litigation', 'Insurance',
  'Personal-Property', 'All-Powers',
] as const;

export const DISTRIBUTION_STANDARDS = [
  'HEMS', 'Ascertainable', 'Discretionary', 'Mandatory', 'Hybrid', 'Other',
] as const;

export const DOCUMENT_TYPES = [
  'Will', 'POA-Financial', 'POA-Healthcare', 'Healthcare-Directive',
  'Trust', 'Codicil', 'Letter-of-Instruction', 'Correspondence', 'Intake', 'Other',
] as const;

export type TrustStructure       = typeof TRUST_STRUCTURES[number];
export type BeneficiaryCategory  = typeof BENEFICIARY_CATEGORIES[number];
export type PowersGranted        = typeof POWERS_GRANTED[number];
export type DistributionStandard = typeof DISTRIBUTION_STANDARDS[number];
export type DocumentType         = typeof DOCUMENT_TYPES[number];

export type FileFormat           = 'docx' | 'pdf' | 'doc' | 'other';
export type FirmOrigin           = 'predecessor' | 'current' | 'unknown';
export type Language             = 'en' | 'ar' | 'es' | 'mixed';
export type EstimatedComplexity  = 'simple' | 'moderate' | 'complex' | 'high-net-worth';
export type FundedStatus         = 'funded' | 'unfunded' | 'unknown';
export type LifeSupportChoice    = 'withdraw' | 'maintain' | 'conditional';
export type CprDirective         = 'DNR' | 'full-code' | 'conditional';
export type OrganDonation        = 'yes' | 'no' | 'partial';

// ---------------------------------------------------------------------------
// Universal fields (Section 3.1 — locked)
// ---------------------------------------------------------------------------

export interface UniversalFields {
  drive_file_id: string;
  drive_path: string;
  client_name: string | null;
  matter_id: string | null;
  file_format: FileFormat;
  file_size_bytes: number;
  created_date: string;           // ISO 8601
  modified_date: string;          // ISO 8601
  document_type: DocumentType;
  firm_origin: FirmOrigin;
  version_label: string | null;   // 'draft' | 'v1' | 'final' | 'executed' | etc.
  is_likely_executed: boolean;
  page_count: number;
  language: Language;
  ingest_timestamp: string;       // ISO 8601
  schema_version: '1.0';
  classification_confidence: number;   // 0.0–1.0
  needs_human_review: boolean;
  needs_human_review_reasons: string[];
  requires_ocr: boolean;
}

// ---------------------------------------------------------------------------
// Per-field confidence map — conservative fields only (Section 4.1)
// ---------------------------------------------------------------------------

export interface FieldConfidence {
  [fieldName: string]: number;    // 0.0–1.0
}

// ---------------------------------------------------------------------------
// Type-specific field groups
// DRAFT — inferred from Section 8.2 extraction prompt.
// Review against Wills_Metadata_Schema_v1.0.docx and correct before Phase 5.
// ---------------------------------------------------------------------------

/** Will / Last Will and Testament */
export interface WillFields {
  testator_name: string | null;
  executor_name: string | null;
  executor_alternates: string[];          // in order named
  witnesses: string[];
  execution_date: string | null;          // ISO 8601
  governing_law: string | null;
  is_executed: boolean | null;
  has_self_proving_affidavit: boolean;
  has_no_contest_clause: boolean;
  has_pour_over_provision: boolean;
  referenced_trust_name: string | null;  // external trust this Will pours into
  referenced_trust_date: string | null;  // ISO 8601
  trust_structures: TrustStructure[];    // e.g. ['Testamentary']
  beneficiary_categories: BeneficiaryCategory[];
  guardian_name: string | null;          // guardian for minor children
  is_holographic: boolean;
  has_residuary_clause: boolean;
  estimated_estate_complexity: EstimatedComplexity | null;
  notable_clauses: string[];             // free-text, anything unusual
}

/** Durable / Springing Financial Power of Attorney */
export interface PoaFinancialFields {
  principal_name: string | null;
  agent_name: string | null;
  agent_alternates: string[];
  notary_name: string | null;
  execution_date: string | null;
  governing_law: string | null;
  is_executed: boolean | null;
  is_durable: boolean;                   // true if survives incapacity
  is_springing: boolean;                 // true only if activates on a triggering event
  nj_form_compliant: boolean;            // N.J.S.A. 46:2B-8.1 et seq.
  powers_granted: PowersGranted[];
  gift_authority: boolean;               // express gift-making power granted
  notable_clauses: string[];
}

/** Healthcare Power of Attorney / Proxy / Surrogate */
export interface PoaHealthcareFields {
  principal_name: string | null;
  agent_name: string | null;             // healthcare representative
  agent_alternates: string[];
  notary_name: string | null;
  execution_date: string | null;
  governing_law: string | null;
  is_executed: boolean | null;
  is_durable: boolean;
  hipaa_authorization: boolean;
  religious_or_cultural_provisions: string | null;  // verbatim or near-verbatim
  notable_clauses: string[];
}

/** Living Will / Advance Directive for Health Care */
export interface HealthcareDirectiveFields {
  declarant_name: string | null;
  healthcare_representative_name: string | null;
  healthcare_representative_alternates: string[];
  witnesses: string[];
  execution_date: string | null;
  governing_law: string | null;
  is_executed: boolean | null;
  life_support_choice: LifeSupportChoice | null;
  artificial_nutrition_choice: string | null;   // too varied to enumerate
  cpr_directive: CprDirective | null;
  organ_donation: OrganDonation | null;
  hipaa_authorization: boolean;
  religious_or_cultural_provisions: string | null;  // verbatim or near-verbatim
  notable_clauses: string[];
}

/** Any trust agreement (revocable, irrevocable, testamentary, SNT, etc.) */
export interface TrustFields {
  trust_name: string | null;
  grantor_name: string | null;           // also: settlor
  trustee_name: string | null;           // initial trustee
  trustee_alternates: string[];          // successor trustees in order
  execution_date: string | null;
  governing_law: string | null;
  is_executed: boolean | null;
  trust_structures: TrustStructure[];
  beneficiary_categories: BeneficiaryCategory[];
  distribution_standard: DistributionStandard | null;
  funded_status: FundedStatus;
  amendment_history_referenced: boolean;  // doc references prior amendments
  spendthrift_clause: boolean;
  has_pour_over_provision: boolean;       // this trust is a pour-over recipient
  estimated_estate_complexity: EstimatedComplexity | null;
  notable_clauses: string[];
}

/** Amendment or supplement to an existing Will */
export interface CodicilFields {
  testator_name: string | null;
  witnesses: string[];
  execution_date: string | null;
  governing_law: string | null;
  is_executed: boolean | null;
  referenced_will_date: string | null;   // date of original Will being amended
  nature_of_amendment: string[];         // one entry per substantive change
  has_self_proving_affidavit: boolean;
  notable_clauses: string[];
}

/** Letters, emails, memos — non-instruments */
export interface CorrespondenceFields {
  date_sent: string | null;              // ISO 8601
  author_name: string | null;
  recipient_name: string | null;
  topic_summary: string | null;
  referenced_client_name: string | null; // client referenced if different from folder
  notable_clauses: string[];
}

/** Client questionnaires, intake forms, family/asset worksheets */
export interface IntakeFields {
  client_name_self_reported: string | null;
  intake_date: string | null;
  spouse_name: string | null;
  has_minor_children: boolean;
  estimated_estate_complexity: EstimatedComplexity | null;
  documents_requested: string[];         // doc types client requested
  notable_clauses: string[];
}

/** Union of all type-specific groups; null for Other and requires_ocr docs */
export type TypeSpecificFields =
  | WillFields
  | PoaFinancialFields
  | PoaHealthcareFields
  | HealthcareDirectiveFields
  | TrustFields
  | CodicilFields
  | CorrespondenceFields
  | IntakeFields
  | null;

// ---------------------------------------------------------------------------
// Classification result (output of Haiku 4.5)
// ---------------------------------------------------------------------------

export interface ClassificationResult {
  document_type: DocumentType;
  confidence: number;                       // 0.0–1.0
  firm_origin: FirmOrigin;
  is_likely_executed: boolean;
  language: Language;
  page_count: number;
  needs_human_review: boolean;
  needs_human_review_reasons: string[];
  requires_ocr: boolean;
  notable_classification_concerns: string[];  // e.g. 'Multi-document bundle: ...'
}

// ---------------------------------------------------------------------------
// Extraction result (output of Sonnet 4.6)
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  extraction_confidence: number;    // 0.0–1.0 overall
  field_confidence: FieldConfidence; // per-field map for conservative fields
  type_fields: TypeSpecificFields;
}

// ---------------------------------------------------------------------------
// Full Firestore document (wills_documents/{drive_file_id})
// ---------------------------------------------------------------------------

export type ProcessingStatus = 'pending' | 'classified' | 'extracted' | 'indexed' | 'error' | 'skipped';

export interface WillsDocument extends UniversalFields {
  // Extraction metadata
  extraction_confidence: number | null;
  field_confidence: FieldConfidence | null;
  type_fields: TypeSpecificFields;

  // PageIndex registration
  pageindex_doc_id: string | null;
  pageindex_namespace: 'work-product';

  // Operational fields
  firmId: string;
  processing_status: ProcessingStatus;
  processing_error: string | null;
  last_processed_at: string | null;    // ISO 8601
}

// ---------------------------------------------------------------------------
// Pipeline state (Firestore: pipeline_state/{docId})
// ---------------------------------------------------------------------------

export type PipelineMode = 'live' | 'backfill' | 'paused';

/** pipeline_state/control */
export interface PipelineControl {
  enabled: boolean;
  mode: PipelineMode;
  kill_switch_set_by: string | null;   // uid of user who last changed it
  kill_switch_set_at: string | null;   // ISO 8601
  daily_spend_usd: number;
  daily_spend_reset_at: string | null; // ISO 8601
}

/** pipeline_state/drive_sync */
export interface DriveSyncState {
  last_page_token: string | null;
  last_sync_at: string | null;         // ISO 8601
  watch_expiry: string | null;         // ISO 8601 — Drive watch channels expire ~7 days
  watch_resource_id: string | null;
  watch_channel_id: string | null;
}

/** pipeline_state/backfill_progress */
export interface BackfillProgress {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  total_files_discovered: number;
  total_published: number;
  total_processed: number;
  total_errors: number;
  started_at: string | null;           // ISO 8601
  completed_at: string | null;         // ISO 8601
  last_updated_at: string | null;      // ISO 8601
  current_folder: string | null;       // Drive folder currently being paginated
  started_by: string | null;           // uid of admin who triggered it
}

// ---------------------------------------------------------------------------
// Pub/Sub message (published by Drive watcher and backfill orchestrator)
// ---------------------------------------------------------------------------

export interface WillsIngestMessage {
  drive_file_id: string;
  drive_path: string;              // full folder path, e.g. "Wills/Smith, John/2024"
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
  created_time: string;            // ISO 8601
  modified_time: string;           // ISO 8601
  event_type: 'new' | 'modified' | 'deleted';
  source: 'drive_watch' | 'backfill';
}

// ---------------------------------------------------------------------------
// Pipeline audit log (Firestore: pipeline_audit_log/{auto_id})
// Separate from the firm-level auditLog at firms/{firmId}/auditLog/{logId}.
// ---------------------------------------------------------------------------

export type PipelineAuditAction =
  | 'ingestion_started'
  | 'ingestion_completed'
  | 'ingestion_failed'
  | 'ingestion_skipped'
  | 'classification_completed'
  | 'extraction_completed'
  | 'pageindex_submitted'
  | 'kill_switch_toggled'
  | 'backfill_started'
  | 'backfill_completed'
  | 'document_queried';

export interface PipelineAuditEntry {
  action: PipelineAuditAction;
  drive_file_id: string | null;
  pageindex_doc_id: string | null;
  user_uid: string | null;
  query_text: string | null;
  results_returned: number | null;
  duration_ms: number | null;
  error: string | null;
  timestamp: string;               // ISO 8601
  firmId: string;
}
