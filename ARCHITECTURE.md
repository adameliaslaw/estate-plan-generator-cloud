# Architecture

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, TypeScript 5.9, Tailwind v4, shadcn/ui, react-router 6, react-hook-form + Zod |
| Editor | TipTap 3 (rich-text, used for document review/edit) |
| Backend | Firebase Cloud Functions v2 (Node 20, TypeScript), region `us-east1` |
| Database | Cloud Firestore |
| Storage | Firebase Cloud Storage |
| Auth | Firebase Auth + Google OAuth (`@react-oauth/google`) |
| AI | Anthropic Claude, OpenAI GPT-4.1, Google Vertex/Gemini — multi-provider fallback |
| Hosting | Firebase Hosting |
| Doc export | docxtemplater + pizzip (DOCX), jspdf + jspdf-autotable (PDF), mammoth (DOCX→HTML), pdfjs-dist (PDF parsing) |
| Test | Vitest, Testing Library, jsdom |

## Repository Layout

```
src/                          React app
  pages/                      route-level screens
  components/                 shared UI (shadcn under components/ui)
  services/                   client-side wrappers around Functions / Firestore
  contexts/  hooks/  lib/  utils/  types/  config/

functions/src/                Cloud Functions (one concern per file)
  index.ts                    function exports
  ai-client.ts                multi-provider router + fallback
  vertex-ai-client.ts         Vertex/Gemini adapter
  client-data-serializer.ts   canonical prompt context builder
  template-engine.ts          Handlebars + AI hybrid renderer
  unified-generator.ts        single-doc orchestrator
  generate-documents.ts       batch entry point
  generators/                 per-doc-type AI generators
  templates/                  Handlebars (.hbs) source templates
  document-schemas.ts         Zod schemas for documents
  knowledge-base.ts, kb-embeddings.ts, kb-vector-search.ts
  esign-service.ts, lawpay-integration.ts, levitate-sync.ts,
  google-drive-sync.ts, calendar-sync.ts, email-notifications.ts
  ...

functions-backfill/           isolated package for embedding backfill
firestore.rules               access control (large — read before editing)
firestore.indexes.json        composite indexes
storage.rules                 storage access control
firebase.json                 hosting rewrites + functions config
injectSecrets.cjs             build-time secret injection
.env.example                  env contract
```

## Data Flow — Document Generation

1. Client (`src/pages` → `src/services`) submits questionnaire data and a generation request to a Cloud Function.
2. `client-data-serializer.ts` builds the canonical prompt context (single source of truth for what the AI sees).
3. `unified-generator.ts` selects mode:
   - `template` → `template-engine.ts` renders the matching `.hbs` deterministically.
   - `hybrid` (default) → Handlebars render, then `ai-client.ts` fills unresolved fields / enhances prose.
   - `ai` → full generation via `generators/<doc-type>.ts` calling `ai-client.ts`.
4. `ai-client.ts` routes to Anthropic / OpenAI / Vertex with automatic fallback on error or quota.
5. Output flows through `document-structure-validator.ts` and `template-fidelity-validator.ts`, then is persisted via `document-save-helper.ts` to Firestore + Storage.
6. Exports: `export-docx.ts` / `export-pdf.ts` / `export-batch.ts` produce binary artifacts on demand.

## Supported Document Types

Will, Pour-Over Will, Revocable Living Trust, Financial POA, Healthcare POA / Advance Directive, Deed, Affidavit of Consideration, GIT-REP3, Estate Plan Summary, Questionnaire Summary.

## Key Conventions

- **TypeScript strict; no `any`.** Use `unknown` + narrowing.
- **Validation at boundaries** with Zod (`document-schemas.ts`, request DTOs).
- **HTML sanitization** via DOMPurify for anything user- or AI-authored that gets rendered.
- **One concern per Functions file**; export from `functions/src/index.ts`.
- **Region pinning:** all functions in `us-east1`. Client SDK must match.
- **Secrets** never committed; injected at build by `injectSecrets.cjs`. Add new vars to `.env.example`.
- **Firestore rules / indexes** are production contracts — change deliberately and deploy together with code that depends on them.
- **AI prompts** must serialize through `client-data-serializer.ts`; do not assemble ad-hoc context.
- **Templates** are attorney-reviewed source-of-truth prose — schema/variable changes are safe, prose edits require authorization.
- **Path alias** `@/` → `src/` (see `tsconfig.app.json`, `vite.config.ts`).
- **shadcn/ui** components under `src/components/ui` are generated; regenerate via `shadcn` rather than hand-editing.
