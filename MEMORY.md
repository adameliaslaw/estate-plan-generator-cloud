# Memory

## Key Decisions
- Firebase end-to-end (Hosting + Functions v2 + Firestore + Storage + Auth) — single vendor, single deploy.
- Functions region pinned to `us-east1`; Node 20 runtime.
- Multi-provider AI (Anthropic / OpenAI / Vertex) with automatic fallback in `ai-client.ts` — no single-vendor lock-in for generation.
- Default generation mode is `hybrid` (Handlebars + AI fill) — deterministic where possible, AI only for unresolved fields.
- Canonical prompt context built exclusively by `client-data-serializer.ts` — one place to change what the model sees.
- Zod at boundaries; DOMPurify on any rendered HTML.
- TypeScript strict, no `any` — use `unknown` + narrowing.
- Tailwind v4 + shadcn/ui; path alias `@/` → `src/`.
- TipTap chosen over Slate/Lexical for the document editor.
- DOCX export via docxtemplater+pizzip; PDF via jspdf+autotable; DOCX→HTML via mammoth.
- Embedding backfill isolated in `functions-backfill/` to avoid bloating the main Functions bundle.

## Established Patterns
- One concern per file under `functions/src/`; re-exported from `index.ts`.
- Per-doc-type generators in `functions/src/generators/`; templates in `functions/src/templates/*.hbs`.
- Frontend: `pages/` (routes) → `services/` (Functions/Firestore wrappers) → `components/` (UI), shadcn primitives in `components/ui/`.
- Secrets injected at build via `injectSecrets.cjs`; mirror every new var in `.env.example`.
- Firestore composite indexes declared in `firestore.indexes.json` and deployed alongside dependent code.
- Validators (`document-structure-validator`, `template-fidelity-validator`) gate output before persistence.
- Debugging: read logs/types/data first — never deploy speculative fixes.

## Ruled Out
- `high-fidelity` binary `.docx` mode — planned, not implemented; do not assume availability.
- Single-provider AI — rejected; fallback chain is required.
- Ad-hoc prompt context assembly — must go through `client-data-serializer.ts`.
- Editing attorney-reviewed `.hbs` prose without authorization.
- Loosening `firestore.rules` / `storage.rules` for convenience.
- Renaming deployed functions in place (orphans clients) — deprecate via alias instead.
- Changing functions region or Node runtime without coordinated client update.
- `any` types and unused imports in committed code.
