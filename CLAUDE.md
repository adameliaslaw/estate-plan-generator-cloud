# CLAUDE.md

## Behavioral Rules

1. **Don't assume. Don't skip validation. Surface tradeoffs.** Read the code before changing it. Verify assumptions against logs, types, and actual data — never hypothesize and deploy. When choices have meaningful tradeoffs, name them out loud.
2. **Minimum code that solves the problem. Nothing speculative.** No future-proofing, no premature abstractions, no "while I'm here" cleanups. Three similar lines beat a clever helper.
3. **Touch only what you need. Clean up only your own mess.** Don't reformat unrelated files. Don't delete unfamiliar files/branches/state — investigate first; it may be in-progress work.
4. **Define success criteria. Loop until verified.** State what "done" looks like before starting. Run tsc, build, and (when UI) manual browser verification. Type-checks prove correctness of code, not of the feature.
5. **Never tell the user to deploy manually.** This repo has GitHub Actions that auto-deploy hosting and functions on every push to `main` (`.github/workflows/firebase-hosting-deploy.yml` and `firebase-functions-deploy.yml`). Merging a PR is sufficient — no `firebase deploy` command needed.
6. **Always confirm when a push or merge completes.** After every `git push` or PR merge, explicitly tell the user it's done and that CI/CD is deploying automatically.
7. **Auto-merge PRs once verified.** After opening a PR for requested work, merge it yourself (squash) once verification passes (tsc, build, tests) — don't wait for manual approval. Exception: changes touching the Never-Break List (security rules, indexes, templates, data model, CI workflows) still require explicit user sign-off before merging.

---

## Build / Verify Commands

```bash
# Frontend
npm run dev                          # Vite dev server (http://localhost:5173)
npm run build                        # tsc -b && vite build
npm run lint                         # eslint .
npm run test                         # vitest run
npx tsc --noEmit                     # type check (root)

# Functions
cd functions && npm install
cd functions && npx tsc --noEmit     # type check (functions)
cd functions-backfill && npm install
cd functions-backfill && npx tsc --noEmit

# Firebase emulators (all services)
firebase emulators:start

# Deploy (Firebase project: estate-plan-generator)
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only storage:rules
```

---

## Repository Structure

```
estate-plan-generator-cloud/
├── src/                     # React frontend
│   ├── pages/               # Route-level pages (20 files)
│   ├── components/          # Feature components (90+ files, 11 domains)
│   ├── services/            # Frontend API wrappers (4 files)
│   ├── hooks/               # Custom React hooks (7 files)
│   ├── contexts/            # Auth + Questionnaire contexts
│   ├── types/               # Comprehensive TypeScript types (index.ts, 1200+ lines)
│   ├── config/              # Constants, Firebase config, formatting presets
│   └── lib/                 # Utilities (sanitize, utils)
├── functions/               # Firebase Cloud Functions (78 .ts files)
│   └── src/
│       ├── generators/      # Per-document-type generators (10 files)
│       ├── templates/       # Handlebars templates (poa-comprehensive.hbs, poa-simple.hbs)
│       └── *.ts             # All other function modules (one concern per file)
├── functions-backfill/      # Isolated package for embedding backfill operations
├── tests/
│   ├── unit/                # 12 unit tests (schemas, serializer, security rules, exports)
│   ├── integration/         # 2 integration tests (auth, dashboard)
│   ├── e2e/                 # 3 e2e tests (doc generation, security access, questionnaire)
│   └── helpers/             # Mock data + Firebase test utilities
├── docs/                    # ARCHITECTURE.md, DEPLOYMENT.md, etc.
├── scripts/                 # Build/deployment scripts
├── samples/                 # Sample data/templates
├── public/                  # Static assets
├── firestore.rules          # Production access control (583 lines — READ before editing)
├── storage.rules            # Storage access control (99 lines — READ before editing)
├── firestore.indexes.json   # Composite indexes (removing one silently breaks prod queries)
└── firebase.json            # Hosting, functions, emulator config
```

---

## Frontend Architecture

**Stack:** React 19.2 · TypeScript strict · Vite 7 · Tailwind CSS v4 · shadcn/ui · React Router 6

### Pages (`src/pages/`)

Route-level pages cover three domains: **Auth** (login, register), **Admin/Attorney** (dashboard, clients, documents, settings, admin panel), and **Client** (client-facing portal, questionnaire).

### Components (`src/components/`)

Organized by feature domain — do not add generic utilities here:

| Directory | Purpose |
|-----------|---------|
| `ai/` | AI document drafting widget |
| `clients/` | Client bulk import, deadline management |
| `common/` | Error boundary, loading spinner, privilege notice |
| `dashboard/` | Analytics, calendar, payments, tasks, notes |
| `documents/` | Document vault, generation UI, export, review |
| `editor/` | TipTap rich-text editor, version history, comments |
| `knowledge/` | Knowledge base management, template library |
| `layout/` | App shell, sidebar, client layout |
| `payments/` | Payment dialogs and management |
| `questionnaire/` | Client intake form (8 field types) |
| `settings/` | Firm and team settings |
| `ui/` | 30+ shadcn/ui primitives (do not modify) |

### Services (`src/services/`)

Thin wrappers over Firebase Callable Functions. Never call `httpsCallable` directly from components — always go through a service file.

- `documentService.ts` — document generation, export, version history
- `knowledgeBaseService.ts` — KB CRUD and search
- `recommendationEngineService.ts` — AI recommendations
- `storageService.ts` — Firebase Storage uploads/downloads

### Hooks (`src/hooks/`)

- `useAuth.ts` — current user, role, firm context
- `useFirestore.ts` — typed Firestore helpers
- `useAudioRecorder.ts` — note dictation
- `usePermissions.ts` — capability checks
- (plus 3 others)

### State & Types

- **`src/types/index.ts`** is the source of truth for the full data model. All frontend and backend types mirror this file. Read it before adding new fields.
- Auth state lives in `AuthContext`. Questionnaire multi-step state lives in `QuestionnaireContext`.
- `react-hook-form` + Zod for all forms. Do not use uncontrolled inputs.

### Key Frontend Libraries

| Library | Version | Use |
|---------|---------|-----|
| TipTap | 3.20 | Rich-text document editor |
| Firebase JS SDK | 12.10 | Auth, Firestore, Storage, Functions |
| react-hook-form | 7.71 | Form state management |
| Zod | 4.3 | Schema validation |
| pdfjs-dist | 5.5 | PDF preview |
| jspdf | 4.2 | Client-side PDF generation |
| mammoth | 1.12 | DOCX → HTML conversion |
| DOMPurify | 3.3 | Sanitize AI-generated HTML before render |
| handlebars | 4.7 | Client-side template rendering |

---

## Backend Architecture

**Stack:** Firebase Cloud Functions v2 · Node **22** · TypeScript strict · region `us-east1`

One concern per file. Never co-locate unrelated logic in a single module.

### Document Generation Pipeline

```
generate-documents.ts          # Batch entry point (HTTP callable)
generate-single-document.ts    # Single doc entry point
  └─► unified-generator.ts     # Orchestrator — routes to mode + type
        ├─► template-engine.ts           # Handlebars + AI hybrid renderer
        ├─► generators/<type>-generator.ts  # Per-doc-type logic (10 generators)
        └─► ai-client.ts                 # Multi-provider AI calls
              └─► client-data-serializer.ts  # Canonical prompt context
```

**Document modes:** `hybrid` (default — template skeleton + AI fill), `template` (Handlebars only), `ai` (pure generation). `high-fidelity` is planned, not implemented.

### Generators (`functions/src/generators/`)

| File | Document Type |
|------|--------------|
| `will-generator.ts` | Last Will & Testament |
| `trust-generator.ts` | Revocable Living Trust |
| `poa-generator.ts` | Power of Attorney |
| `advance-directive-generator.ts` | Advance Healthcare Directive |
| `deed-generator.ts` | Deed of Transfer |
| `affidavit-generator.ts` | Affidavit |
| `pour-over-will-generator.ts` | Pour-Over Will |
| `git-rep3-generator.ts` | REP-3 form |
| `summary-docs-generator.ts` | Summary document set |
| `questionnaire-generator.ts` | Auto-filled questionnaire |

### AI Routing (`functions/src/ai-client.ts`)

Each firm selects one provider via `activeAiProvider` in Firestore. `callAI` reads that field and dispatches accordingly; it defaults to `openai` when unset. **Never hard-code a single provider.**

Supported providers: `openai`, `anthropic`, `gemini`, `perplexity`.

**There is no automatic cascade.** The one exception: if the firm uses Anthropic and the call is blocked by Anthropic's content filter, `callAI` automatically retries with OpenAI (if the firm also has an OpenAI key configured).

**API key sources:**
- `openai` — `firmData.openAiApiKey` → `firmData.settings.openAiApiKey` → `process.env.OPENAI_API_KEY`
- `anthropic` / `gemini` / `perplexity` — per-firm Firestore only; no `process.env` fallback

Per-firm keys are stored under `firms/{firmId}` (top-level fields or under `.settings`). Firms that do not configure a provider key will receive a thrown error, not a silent fallback to another provider.

`vertex-ai-client.ts` is a separate adapter for Vertex AI workloads.

### Canonical Prompt Context (`functions/src/client-data-serializer.ts`)

Builds the structured context object injected into every AI prompt. **Schema changes here ripple into every generator and break cached prompts.** Do not modify without reviewing all 10 generators.

### Key Backend Modules

| Module | Purpose |
|--------|---------|
| `template-engine.ts` | Handlebars rendering + AI gap-filling |
| `template-fidelity-validator.ts` | Validates template output completeness |
| `ai-compliance-check.ts` | Legal compliance validation on generated text |
| `review-document.ts` / `grounded-review.ts` | AI review workflows |
| `export-pdf.ts` | PDF via Puppeteer + Chromium (server-side) |
| `export-docx.ts` | DOCX via `docx` library |
| `export-batch.ts` | Batch zip archive export |
| `process-ocr.ts` | OCR on scanned documents |
| `transcribe-audio.ts` | Whisper transcription (OpenAI) |
| `assemblyai-transcribe.ts` | AssemblyAI alternate transcription |
| `knowledge-base.ts` + `kb-embeddings.ts` + `kb-vector-search.ts` | KB CRUD, vector embeddings, semantic search |
| `audit-trail.ts` | Immutable audit log |
| `document-versions.ts` | Version history management |
| `wills-extractor.ts` / `wills-processor.ts` / `wills-classifier.ts` | Existing-will extraction pipeline |

### Integrations

| Module | Integration |
|--------|------------|
| `calendar-sync.ts` | Google Calendar API |
| `google-drive-sync.ts` | Google Drive API |
| `google-auth.ts` | OAuth 2.0 flow |
| `esign-service.ts` | E-signature |
| `lawpay-integration.ts` | LawPay payment processing |
| `email-notifications.ts` | SendGrid email dispatch |
| `levitate-sync.ts` | Levitate CRM sync |
| `courtlistener-client.ts` | CourtListener legal research |
| `property-data.ts` | Property data lookups |

### Key Backend Libraries

| Library | Version | Use |
|---------|---------|-----|
| `@anthropic-ai/sdk` | 0.91 | Claude API |
| `openai` | 4.70 | GPT + Whisper |
| `@google/genai` | 1.48 | Gemini API |
| `puppeteer-core` + `@sparticuz/chromium` | 24 / 143 | Headless PDF rendering |
| `docx` | 9.6 | DOCX generation |
| `googleapis` | 171 | Google Drive/Calendar |
| `undici` | 6.25 | Custom HTTP dispatcher for long AI timeouts |

---

## Key Conventions

- **TypeScript strict.** Never use `any` — use `unknown` with narrowing.
- **Node 22** runtime for functions. Do not bump without testing the full deploy pipeline.
- **Region `us-east1`** for all functions. Changing this requires a coordinated client-side update.
- **Zod schemas at all API/function boundaries.** Client-facing callable functions must validate inputs with Zod before processing.
- **DOMPurify on any AI-generated HTML** before rendering in the browser.
- **Remove unused imports before committing.** The linter enforces this.
- **Form handling:** always use `react-hook-form` + Zod resolver. Never uncontrolled inputs.
- **Service layer:** components call service files; service files call Firebase callables. No direct `httpsCallable` in components.
- **One function = one file** in `functions/src/`. Do not consolidate unrelated callables.
- **Handlebars templates** in `functions/src/templates/` are attorney-reviewed. Do not edit prose without explicit authorization.
- **`functions-backfill/`** is an isolated package for one-time data migration jobs. Do not import from the main `functions/` package.

---

## Security & Access Control

### Firestore Rules (`firestore.rules` — 583 lines)

Role-based access control with four roles: `admin`, `attorney`, `paralegal`, `client`. A custom capabilities system sits on top for fine-grained feature flags. All access is firm-scoped — users can only read/write within their own firm's data.

**Key collections and access patterns:**

| Collection | Notes |
|-----------|-------|
| `firms/{firmId}` | Admin-only write; attorneys/paralegals read own firm |
| `users/{userId}` | Self-read/write; admin can read all in firm |
| `clients/{clientId}` | Attorney/paralegal CRUD; clients read own record |
| `documents/{docId}` | Attorney/paralegal CRUD; clients read own signed docs |
| `notes/{noteId}` | Attorney/paralegal only |
| `payments/{paymentId}` | Attorney/paralegal write; clients read own |
| `knowledge_resources/` | Attorney/paralegal CRUD |
| `templates/` | Attorney/paralegal CRUD |

**Never loosen rules without explicit instruction. Test with the Firebase emulator before deploying.**

### Storage Rules (`storage.rules` — 99 lines)

| Path | Max Size | MIME Restriction |
|------|----------|-----------------|
| `audio/` | 50 MB | `audio/*` |
| `documents/` | 100 MB | — |
| `scans/` | 50 MB | — |
| `uploads/` | 20 MB | — |
| `branding/` | 5 MB | `image/*` |
| `knowledge_base/` | 200 MB | — |
| `templates/` | 200 MB | — |

---

## Data Model

**Source of truth:** `src/types/index.ts` (1200+ lines). All Firestore documents map to these types.

**Core entities:**

- **`Firm`** — top-level tenant; all other data is firm-scoped
- **`UserProfile`** — role (`admin | attorney | paralegal | client`), capabilities, firmId
- **`Client`** — full estate planning profile: personal info, spouse, children, assets (real estate, bank, investment, retirement, insurance, business, personal property, digital), liabilities, fiduciaries (executor, trustee, POA, healthcare proxy, guardian), distribution wishes, healthcare preferences, trust details
- **`Document`** — versioned, signed, AI-generated; tied to a client and document type
- **`Note`** — with optional audio transcription fields
- **`Payment`** — LawPay integration fields
- **`CalendarEvent`** — Google Calendar sync fields
- **`Task`** — attorney task management
- **Package types:** `foundation`, `guardian`, `fortress` (determines which documents are generated)
- **Document types:** `will`, `trust`, `poa`, `advance-directive`, `deed`, `affidavit`, `pour-over-will`, `rep3`, `summary`, `questionnaire`, plus flex types

---

## Environment & Secrets

**Frontend env vars** (`.env.local`, all `VITE_*`):

| Variable | Purpose |
|----------|---------|
| `VITE_FIREBASE_API_KEY` | Firebase config |
| `VITE_FIREBASE_AUTH_DOMAIN` | Firebase config |
| `VITE_FIREBASE_PROJECT_ID` | Firebase config |
| `VITE_FIREBASE_STORAGE_BUCKET` | Firebase config |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Firebase config |
| `VITE_FIREBASE_APP_ID` | Firebase config |
| `VITE_GOOGLE_CLIENT_ID` | OAuth for Drive/Calendar |
| `VITE_USE_EMULATORS` | Set `true` for local dev |

**Backend secrets** (Firebase Secrets Manager, not `.env`):

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | Claude (primary AI) |
| `OPENAI_API_KEY` | GPT + Whisper (fallback AI + transcription) |
| `ASSEMBLYAI_API_KEY` | Alternate transcription |
| `SENDGRID_API_KEY` | Email notifications |
| `LAWPAY_API_KEY` / `LAWPAY_ACCOUNT_ID` | Payment processing |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth |

Per-firm API keys (openAiApiKey, geminiApiKey, perplexityApiKey, courtlistenerApiKey) are stored in Firestore under `firms/{firmId}` settings, not in Secrets Manager.

**`injectSecrets.cjs`** — secret injection contract for the build. Never commit real secrets. Mirror any new variable in `.env.example`.

---

## CI/CD

Two GitHub Actions workflows trigger on push to `main`:

**`firebase-hosting-deploy.yml`** — triggers when `src/`, `public/`, `index.html`, `vite.config.ts`, `tsconfig*`, `package*.json`, or `firebase.json` change.
1. Node 22, frozen lockfile (`npm ci`)
2. Type-check (`npx tsc --noEmit`)
3. Build (`npm run build`)
4. Deploy to https://estate-plan-generator.web.app

**`firebase-functions-deploy.yml`** — triggers when `functions/**`, `firebase.json`, `.firebaserc`, or the workflow file itself changes. **`functions-backfill/**` is NOT in the trigger paths** — a backfill-only commit does not trigger CI. Use `workflow_dispatch` for manual backfill deploys.
1. Node 22, frozen lockfile
2. Type-check + build `functions/`
3. Install `functions-backfill/` deps (so predeploy `tsc` uses the pinned TypeScript version)
4. Deploy via Firebase CLI + Google Cloud auth (deploys both function codebases)

Both workflows use concurrency groups that cancel in-flight deploys when a new push arrives. **Merging a PR to `main` is sufficient to deploy — never instruct the user to run `firebase deploy` manually.**

---

## Testing

```bash
npm run test                 # vitest run (root — unit tests)
npm run test -- --watch      # watch mode
```

**Test layout:**

| Directory | Count | Covers |
|-----------|-------|--------|
| `tests/unit/` | 12 | sanitize, document schemas, client-data-serializer, template fidelity, data integrity, questionnaire logic, Firestore security rules, export functions |
| `tests/integration/` | 2 | auth flow, client dashboard |
| `tests/e2e/` | 3 | document generation pipeline, security access control, questionnaire scenarios |
| `tests/helpers/` | — | Mock data factory, Firebase test utilities |

Security rule tests run against the Firebase emulator. Start it before running those tests.

---

## Never-Break List

- **`firestore.rules` / `storage.rules`** — production access controls. Never loosen without explicit instruction; test with the emulator before deploying.
- **`firestore.indexes.json`** — composite indexes back live queries; removing one breaks reads silently in prod.
- **`functions/src/ai-client.ts` provider dispatch** — keep all four providers wired (`openai`, `anthropic`, `gemini`, `perplexity`). Do not hard-code a single provider. Provider is firm-selected; only the Anthropic content-filter path has a one-step OpenAI fallback.
- **`functions/src/client-data-serializer.ts`** — canonical prompt context. Schema changes ripple into every generator and break existing prompt caches.
- **`functions/src/templates/*.hbs`** — attorney-reviewed prose. Do not edit without authorization.
- **`src/types/index.ts`** — the data model contract. Changes here ripple into Firestore, all generators, and the serializer.
- **`injectSecrets.cjs` / `.env.example`** — secret injection contract for build. Don't commit real secrets; mirror new vars in `.env.example`.
- **`firebase.json` rewrites and function names** — renaming a deployed function orphans live clients; deprecate via alias first.
- **Region `us-east1`** for all functions. Don't change without coordinated client update.
- **Node 22** runtime for functions. Do not bump without testing the full deploy.
- **`functions-backfill/`** — isolated package; do not import it from `functions/`.
