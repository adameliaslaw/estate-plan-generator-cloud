# CLAUDE.md

## Behavioral Rules

1. **Don't assume. Don't skip validation. Surface tradeoffs.** Read the code before changing it. Verify assumptions against logs, types, and actual data — never hypothesize and deploy. When choices have meaningful tradeoffs, name them out loud.
2. **Minimum code that solves the problem. Nothing speculative.** No future-proofing, no premature abstractions, no "while I'm here" cleanups. Three similar lines beat a clever helper.
3. **Touch only what you need. Clean up only your own mess.** Don't reformat unrelated files. Don't delete unfamiliar files/branches/state — investigate first; it may be in-progress work.
4. **Define success criteria. Loop until verified.** State what "done" looks like before starting. Run tsc, build, and (when UI) manual browser verification. Type-checks prove correctness of code, not of the feature.

## Build / Verify Commands

```bash
# Frontend
npm run dev                          # Vite dev server
npm run build                        # tsc -b && vite build
npm run lint                         # eslint .
npm run test                         # vitest run
npx tsc --noEmit                     # type check (root)

# Functions
cd functions && npm install
cd functions && npx tsc --noEmit     # type check (functions)

# Deploy (Firebase project: estate-plan-generator)
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## Key Conventions

- **TypeScript strict.** Never use `any` — use `unknown` with narrowing.
- **Frontend:** React 19 + Vite + Tailwind v4 + shadcn/ui (`components.json`). Routes under `src/pages/`, shared UI in `src/components/`, API wrappers in `src/services/`.
- **Backend:** Firebase Cloud Functions v2, Node 20, region `us-east1`. One concern per file under `functions/src/`.
- **AI routing:** multi-provider (Anthropic / OpenAI / Vertex) via `functions/src/ai-client.ts` with automatic fallback.
- **Templates:** Handlebars (`.hbs`) in `functions/src/templates/`; per-doc generators in `functions/src/generators/`.
- **Document modes:** `hybrid` (default), `template`, `ai`. `high-fidelity` is planned, not implemented.
- **Validation:** Zod schemas at API/function boundaries. DOMPurify for any HTML rendered.
- **Firestore rules** live in `firestore.rules`; storage rules in `storage.rules`. Both are large — read before editing.
- **Remove unused imports before committing.**

## Never-Break List

- **`firestore.rules` / `storage.rules`** — production access controls. Never loosen without explicit instruction; test with the emulator before deploying.
- **`firestore.indexes.json`** — composite indexes back live queries; removing one breaks reads silently in prod.
- **`functions/src/ai-client.ts` fallback chain** — keep all three providers wired; do not hard-code a single provider.
- **`functions/src/client-data-serializer.ts`** — canonical prompt context. Schema changes ripple into every generator and existing prompt cache.
- **`functions/src/templates/*.hbs`** — attorney-reviewed; do not edit prose without authorization.
- **`injectSecrets.cjs` / `.env.example`** — secret injection contract for build. Don't commit real secrets; mirror new vars in `.env.example`.
- **`firebase.json` rewrites and function names** — renaming a deployed function orphans clients; deprecate via alias.
- **Region `us-east1`** for functions. Don't change without coordinated client update.
- **Node 20** runtime for functions. Do not bump without testing the full deploy.
