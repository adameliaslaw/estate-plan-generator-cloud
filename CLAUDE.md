# CLAUDE.md

## Behavioral Rules

1. **Don't assume. Don't skip validation. Surface tradeoffs.** Read the code before changing it. Verify assumptions against logs, types, and actual data — never hypothesize and deploy. When choices have meaningful tradeoffs, name them out loud.
2. **Minimum code that solves the problem. Nothing speculative.** No future-proofing, no premature abstractions, no "while I'm here" cleanups. Three similar lines beat a clever helper.
3. **Touch only what you need. Clean up only your own mess.** Don't reformat unrelated files. Don't delete unfamiliar files/branches/state — investigate first; it may be in-progress work.
4. **Define success criteria. Loop until verified.** State what "done" looks like before starting. Run tsc, build, and (when UI) manual browser verification. Type-checks prove correctness of code, not of the feature.
5. **Never tell the user to deploy manually.** This repo has GitHub Actions that auto-deploy hosting and functions on every push to `main` (`.github/workflows/firebase-hosting-deploy.yml` and `firebase-functions-deploy.yml`). Merging a PR is sufficient — no `firebase deploy` command needed.
6. **Always confirm when a push or merge completes.** After every `git push` or PR merge, explicitly tell the user it's done and that CI/CD is deploying automatically.

---

## Build / Verify Commands

```bash
# Frontend
npm run dev                          # Vite dev server (localhost:5173)
npm run build                        # tsc -b && vite build
npm run lint                         # eslint .
npm run test                         # vitest run
npm run test:watch                   # vitest (watch mode)
npx tsc --noEmit                     # type check (root)

# Functions
cd functions && npm install
cd functions && npx tsc --noEmit     # type check (functions)
cd functions && npm run build        # tsc + copy-templates.js

# Firebase Emulators (auth:9099, firestore:8080, functions:5001, storage:9199, ui:4000)
firebase emulators:start

# Deploy (CI/CD does this automatically — manual only for emergencies)
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
```

---

## Key Conventions

- **TypeScript strict.** Never use `any` — use `unknown` with narrowing. `noUnusedLocals` and `noUnusedParameters` are enforced. Remove unused imports before committing.
- **Frontend:** React 19 + Vite 7 + Tailwind v4 + shadcn/ui (`components.json`). Path alias `@/` → `src/`. Routes under `src/pages/`, shared UI in `src/components/`, API wrappers in `src/services/`, custom hooks in `src/hooks/`.
- **Backend:** Firebase Cloud Functions v2, **Node 22**, region `us-east1`. One concern per file under `functions/src/`. Compiled to `functions/lib/` (gitignored).
- **AI routing:** multi-provider (Anthropic → OpenAI → Vertex AI) via `functions/src/ai-client.ts` with automatic fallback. All free-text must be sanitized through `sanitizeForPrompt()` before embedding in prompts.
- **Templates:** Handlebars (`.hbs`) in `functions/src/templates/`; per-doc AI generators in `functions/src/generators/`.
- **Document generation modes:** `hybrid` (default), `template`, `ai`. `high-fidelity` is planned, not implemented.
- **Validation:** Zod schemas at all API/function boundaries. DOMPurify for any HTML rendered in the browser.
- **Firestore rules** live in `firestore.rules`; storage rules in `storage.rules`. Both are large — read before editing, test with emulator before deploying.
- **Rich text editing** uses Tiptap v3 (`src/components/editor/`). The editor stores HTML; sanitize with DOMPurify before persisting or rendering.
- **Form validation** uses React Hook Form v7 + Zod v4.

---

## Project Structure

### Repository Root

```
estate-plan-generator-cloud/
├── src/                        # React frontend (Vite SPA)
├── functions/                  # Firebase Cloud Functions (Node 22)
├── functions-backfill/         # Separate backfill jobs codebase
├── tests/                      # Test suites
├── samples/                    # Sample data / templates
├── scripts/                    # Build utilities
├── public/                     # Static assets
├── .github/workflows/          # CI/CD (hosting + functions auto-deploy)
├── firebase.json               # Firebase deployment config
├── firestore.rules             # Firestore security rules (RBAC)
├── firestore.indexes.json      # Composite indexes for live queries
├── storage.rules               # Cloud Storage security rules
├── .env.example                # Environment template (no real secrets)
├── cors.json                   # CORS configuration for Storage
├── vite.config.ts              # Vite build + chunk splitting
├── tsconfig.json               # Root TS config (strict)
├── tsconfig.app.json           # Frontend TS config
├── components.json             # shadcn/ui configuration
├── vitest.config.ts            # Frontend test config
├── ARCHITECTURE.md             # System design reference
├── DEPLOYMENT.md               # Manual deploy procedures
└── BACKLOG.md                  # Feature roadmap
```

### Frontend (`src/`)

```
src/
├── App.tsx                     # Main router & app shell
├── main.tsx                    # React entry point
├── types/
│   ├── index.ts                # All Firestore type defs (UserRole, DocType, PackageType, etc.)
│   └── questionnaire.ts        # Questionnaire field schema
├── config/
│   ├── constants.ts            # App-wide constants
│   ├── firebase.ts             # Firebase SDK initialization
│   ├── formatting-presets.ts   # Document styling presets
│   └── software-sources.ts     # Software vendor definitions
├── contexts/
│   ├── AuthContext.tsx         # Firebase Auth state
│   └── QuestionnaireContext.tsx # Multi-step form state
├── hooks/
│   ├── useAuth.ts              # Auth state & current user
│   ├── useFirestore.ts         # Firestore CRUD wrapper
│   ├── usePermissions.ts       # Role-based access control
│   ├── useFirmBranding.ts      # Firm-level styling config
│   ├── useAudioRecorder.ts     # Audio recording
│   ├── useSessionTimeout.ts    # Session expiry
│   ├── useRequireAuth.ts       # Auth guard hook
│   └── useGooglePlacesAutocomplete.ts
├── services/
│   ├── document-service.ts     # Cloud Functions callables for doc generation
│   ├── rag-chat-service.ts     # RAG chat SSE streaming + citation types
│   ├── knowledge-base-service.ts # KB & template CRUD
│   ├── ingest-service.ts       # Document ingestion pipeline
│   ├── storage-service.ts      # Cloud Storage wrapper
│   └── recommendation-engine.ts # Doc recommendation logic
├── lib/
│   ├── utils.ts                # General utilities (cn, etc.)
│   └── sanitize.ts             # Input sanitization
├── utils/
│   ├── activity-logger.ts      # Client-side audit logging
│   ├── audio-helpers.ts        # Audio processing helpers
│   ├── getAvailablePeople.ts   # Person list utilities
│   ├── pdf-reports.ts          # PDF report generation
│   ├── template-preview.ts     # Template rendering preview
│   ├── turnaround-stats.ts     # Turnaround time metrics
│   └── sanitize.ts             # DOMPurify wrapper
├── components/
│   ├── ui/                     # shadcn/ui base components (button, card, dialog, etc.)
│   ├── auth/ProtectedRoute.tsx
│   ├── layout/                 # AppLayout, AppSidebar, ClientLayout
│   ├── common/                 # ErrorBoundary, LoadingSpinner, PrivilegeNotice
│   ├── documents/              # GenerateDocumentsButton, DocumentVault, DocumentPreviewDialog,
│   │                           # DocumentDiffDialog, DocumentReviewDialog, DocumentStatusBadge,
│   │                           # ExportButton, BatchExportButton, BatchGenerateDialog,
│   │                           # ESignatureDialog, UploadDraftDialog, VersionHistoryDialog,
│   │                           # AiComplianceCheck, AttorneyReviewGate, FlexDocumentGenerator
│   ├── editor/                 # DocumentEditor (Tiptap), EditorToolbar, EditorStatusBar,
│   │                           # FindReplaceDialog, CommentsPanel, VersionHistory,
│   │                           # TemplateComparePanel, legal-blocks.ts
│   ├── questionnaire/          # QuestionnaireShell, StepRenderer, PackageSelector,
│   │                           # QuestionnaireComplete, QuestionnaireUploader,
│   │                           # PrintableQuestionnaire, SmartTooltip
│   │   └── fields/             # AddressField, ComboboxField, CurrencyField, DateField,
│   │                           # PersonPicker, RadioCardField, RepeaterField, YesNoField
│   ├── dashboard/              # AnalyticsWidgets, TurnaroundTimesCard, CalendarTab,
│   │                           # NotesTab, PaymentsTab, RecentNotes, TasksList,
│   │                           # UpcomingAppointments, TurnaroundDetailsDialog
│   ├── knowledge/              # AddResourceDialog, AddTemplateDialog, BulkTemplateUploadDialog,
│   │                           # EditTemplateContentDialog, EditTemplateTagsDialog,
│   │                           # KBBulkImportDialog, TemplatePreviewDialog, TemplatePreviewPanel
│   ├── clients/                # BulkImportModal, DeadlinesCard
│   ├── payments/               # ChargePaymentDialog, RecordPaymentDialog, SendPaymentDialog
│   ├── chat/                   # DraftTab, UploadDocumentModal
│   ├── settings/               # SettingsHelpers, TeamTab, settings-utils.ts
│   └── ai/GlobalAiWidget.tsx   # Floating AI assistant overlay
└── pages/
    ├── auth/                   # LoginPage, ForgotPasswordPage, UnauthorizedPage
    ├── admin/                  # DashboardPage, ClientListPage, ClientDashboardPage,
    │                           # NewClientPage, DocumentEditorPage, ChatPage,
    │                           # CalendarPage, KnowledgeBasePage, SettingsPage,
    │                           # PaymentsPage, ReceptionistPage, NameSplitsReview
    ├── client/                 # QuestionnairePage, QuestionnaireRegisterPage,
    │                           # PrintableQuestionnairePage, ClientPortalPage
    └── legal/                  # PrivacyPolicyPage, TermsOfServicePage
```

### Cloud Functions (`functions/src/`)

#### Entry & Generation

| File | Purpose |
|------|---------|
| `index.ts` | Exports all 50+ functions; Admin SDK init |
| `generate-documents.ts` | Batch doc generation (foundation/guardian/fortress packages) |
| `generate-estate-document.ts` | Estate plan orchestrator |
| `generate-single-document.ts` | One-off generation with spouseRole support |
| `generate-flex-document.ts` | Custom docs (engagement letters, invoices, etc.) |
| `unified-generator.ts` | Shared generation logic across doc types |
| `flex-prompts.ts` | Prompt templates for flex documents |

#### Document Generators (`generators/`)

| File | Document type |
|------|--------------|
| `will-generator.ts` | Last Will & Testament |
| `trust-generator.ts` | Revocable Living Trust |
| `poa-generator.ts` | Power of Attorney |
| `pourover-will-generator.ts` | Pour-over Will |
| `advance-directive-generator.ts` | Living Will / Advance Directive |
| `deed-generator.ts` | Property Deed |
| `affidavit-generator.ts` | Affidavit of Consideration |
| `git-rep3-generator.ts` | Gift, Release, Petition 3 |
| `questionnaire-generator.ts` | Auto-generate from questionnaire (34K, largest) |
| `summary-docs-generator.ts` | Estate Plan Summary (22K) |

#### Handlebars Templates (`templates/`)

Only two `.hbs` files exist — attorney-reviewed, do not edit prose without authorization:
- `poa-comprehensive.hbs` (13.6K) — Power of Attorney comprehensive variant
- `poa-simple.hbs` (4.9K) — Power of Attorney simple variant

#### AI & Core

| File | Purpose |
|------|---------|
| `ai-client.ts` | Multi-provider AI routing; 10-min undici timeout; `sanitizeForPrompt()` |
| `ai-memory.ts` | Conversation memory & context persistence |
| `ai-compliance-check.ts` | AI legal review of documents |
| `client-data-serializer.ts` | **Canonical** client prompt context — changes ripple everywhere |
| `client-context-aggregator.ts` | Assembles full client data for generation |
| `document-schemas.ts` | Zod schemas for document validation |
| `template-variables.ts` | Variable extraction & substitution |
| `template-engine.ts` | Handlebars template rendering |
| `vertex-ai-client.ts` | Google Vertex AI wrapper |

#### Export / Document Management

| File | Purpose |
|------|---------|
| `export-pdf.ts` | PDF generation (jsPDF + AutoTable) |
| `export-docx.ts` | DOCX generation (docx library) |
| `export-batch.ts` | Batch ZIP export |
| `document-save-helper.ts` | Firestore document persistence |
| `document-versions.ts` | Version history & rollback |
| `document-structure-validator.ts` | Content integrity checks |
| `review-document.ts` | Attorney review workflow |
| `grounded-review.ts` | AI review with citations |

#### Knowledge Base & RAG

| File | Purpose |
|------|---------|
| `knowledge-base.ts` | KB CRUD |
| `bulk-knowledge-import.ts` | Bulk KB ingestion |
| `kb-embeddings.ts` | Vector embeddings |
| `kb-vector-search.ts` | Semantic search |
| `rag-chat.ts` | RAG chat (Claude + PageIndex) |
| `pageindex-client-files-chat.ts` | Client-file-scoped RAG |
| `pageindex-retrieval.ts` | PageIndex API wrapper |

#### Template Management

`seed-templates.ts`, `process-template-file.ts`, `retemplatize-templates.ts`, `enhance-template.ts`, `cleanup-templates.ts`, `template-learning.ts`, `template-fidelity-validator.ts`, `templatize-kb.ts`

#### Wills Processing Pipeline

`wills-processor.ts` (orchestrator), `wills-drive-watcher.ts`, `wills-backfill.ts`, `wills-pilot.ts`, `wills-classifier.ts`, `wills-extractor.ts`, `wills-drive-client.ts`, `wills-schema.ts`, `wills-audit.ts`

#### Communications & Integrations

| File | Integration |
|------|------------|
| `email-notifications.ts` | SendGrid (invitations, completions, payments, reminders) |
| `weekly-digest.ts` | Weekly digest email |
| `chat-ai.ts` | Chat persistence & streaming |
| `transcribe-audio.ts` / `assemblyai-transcribe.ts` | AssemblyAI audio transcription |
| `calendar-sync.ts` | Google Calendar bi-directional sync |
| `google-auth.ts` | Google OAuth code exchange |
| `google-drive-sync.ts` | Google Drive doc sync & watch |
| `esign-service.ts` | E-signature integration |
| `lawpay-integration.ts` | LawPay payment processing |
| `receptionist-intake.ts` | Twilio intake call webhook |
| `register-client.ts` | Client registration from receptionist link |
| `levitate-sync.ts` | Levitate CRM sync |
| `courtlistener-client.ts` | CourtListener legal research API |

#### Utilities

`property-data.ts`, `branding.ts`, `ingest-document.ts`, `audit-trail.ts`, `user-management.ts`, `link-client.ts`, `process-ocr.ts`, `cost-estimator.ts`, `backfill-pageindex-firmid.ts`

---

## Firestore Data Model

### RBAC Roles (custom claims on Auth token)

| Role | Access |
|------|--------|
| `admin` | Full access everywhere |
| `attorney` | Full read/write on clients within their firm |
| `paralegal` | Read clients within firm; write notes/calendar/documents only |
| `client` | Read/write own client doc; read-only own documents/notes/calendar/payments |

### Collection Hierarchy

```
/firms/{firmId}
/firms/{firmId}/clients/{clientId}
/firms/{firmId}/clients/{clientId}/documents/{docId}
/firms/{firmId}/clients/{clientId}/notes/{noteId}
/firms/{firmId}/clients/{clientId}/payments/{paymentId}
/firms/{firmId}/clients/{clientId}/calendar/{eventId}
```

---

## AI Provider Configuration

`functions/src/ai-client.ts` implements a fallback chain: **Anthropic → OpenAI → Vertex AI**. A fourth provider (Perplexity) is also typed for citation-grounded queries.

- All prompts must pass through `sanitizeForPrompt()` to prevent prompt injection.
- A custom `undici.Agent` sets 10-minute `headersTimeout` / `bodyTimeout` to handle large templatization jobs that exceed Node's default 300s limit.
- Anthropic prompt caching (`cache_control`) is used to warm and read the cache on repeated similar requests.
- `MERCURY_API_KEY` in `.env.example` is for Inception Labs (diffusion LLM), not yet wired.

---

## Environment Variables

Frontend vars are prefixed `VITE_` and baked into the bundle at build time. Functions vars are injected at runtime from Firebase Secret Manager (never in source).

```
# Firebase (frontend — baked into bundle)
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID=estate-plan-generator
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_USE_EMULATORS=false

# AI providers (Secret Manager)
ANTHROPIC_API_KEY
OPENAI_API_KEY
GEMINI_API_KEY
MERCURY_API_KEY

# Integrations (Secret Manager)
SENDGRID_API_KEY
LAWPAY_API_KEY
LAWPAY_ACCOUNT_ID
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
PAGEINDEX_API_KEY
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN

# Internal
FUNCTIONS_BASE_URL=https://us-east1-estate-plan-generator.cloudfunctions.net

# Legal research (per-firm in Firestore, not secrets)
COURTLISTENER_API_KEY
FASTCASE_API_KEY
```

---

## CI/CD Workflows

Both workflows trigger on push to `main` and use Node 22 with `npm ci` (frozen lockfile).

**`firebase-hosting-deploy.yml`** — triggers on changes to `src/`, `public/`, `vite.config.ts`, `package*.json`, `index.html`. Runs `npm run build` then deploys to https://estate-plan-generator.web.app.

**`firebase-functions-deploy.yml`** — triggers on changes to `functions/`, `firebase.json`, `.firebaserc`. Runs `functions/npm run build` (tsc + copy-templates.js) then `firebase deploy --only functions --force`.

Secrets are pulled from GitHub Secrets (`FIREBASE_SERVICE_ACCOUNT_EPG`) and Firebase Secret Manager (API keys auto-injected at deploy time).

---

## Key Dependencies

### Frontend (`package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| react | 19.2.0 | UI framework |
| react-router-dom | 6.30.3 | Client-side routing |
| firebase | 12.10.0 | Auth, Firestore, Storage SDK |
| @tiptap/react | 3.20.0 | Rich text editor |
| react-hook-form | 7.71.2 | Form management |
| zod | 4.3.6 | Schema validation |
| tailwindcss | 4.x | Utility CSS |
| @radix-ui/* | 1.4.3 | Accessible UI primitives |
| typescript | ~5.9.3 | Type checking |
| vite | 7.3.1 | Build tool |
| vitest | latest | Unit testing |
| dompurify | latest | HTML sanitization |
| jspdf | 4.2.1 | Client-side PDF |
| date-fns | latest | Date utilities |
| diff | latest | Text diffing |

### Functions (`functions/package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| firebase-admin | 13.8.0 | Admin SDK |
| firebase-functions | 7.2.5 | Functions framework |
| @anthropic-ai/sdk | 0.91.1 | Claude API |
| openai | 4.70.0 | OpenAI API |
| @google/genai | 1.48.0 | Vertex AI / Gemini |
| googleapis | 171.4.0 | Google APIs |
| handlebars | 4.7.8 | Template rendering |
| docx | 9.6.0 | DOCX generation |
| jsPDF | 4.2.1 | PDF generation |
| puppeteer-core | 24.38.0 | Headless PDF (Chromium) |
| undici | 6.25.0 | HTTP agent with extended timeouts |
| archiver | 7.0.1 | ZIP batch export |

---

## Never-Break List

- **`firestore.rules` / `storage.rules`** — production access controls. Never loosen without explicit instruction; test with the emulator before deploying.
- **`firestore.indexes.json`** — composite indexes back live queries; removing one breaks reads silently in prod.
- **`functions/src/ai-client.ts` fallback chain** — keep all three providers wired; do not hard-code a single provider.
- **`functions/src/client-data-serializer.ts`** — canonical prompt context. Schema changes ripple into every generator and the existing prompt cache.
- **`functions/src/templates/*.hbs`** — attorney-reviewed prose; do not edit without authorization.
- **`injectSecrets.cjs` / `.env.example`** — secret injection contract for build. Don't commit real secrets; mirror new vars in `.env.example`.
- **`firebase.json` rewrites and function names** — renaming a deployed function orphans existing clients; deprecate via alias first.
- **Region `us-east1`** for all functions. Don't change without a coordinated client update.
- **Node 22** runtime for functions. Do not bump without testing the full deploy.
- **`functions/src/generators/*.ts`** — each generator must call `client-data-serializer.ts` for context; do not inline client data assembly.
