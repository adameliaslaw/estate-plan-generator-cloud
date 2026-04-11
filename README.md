# Estate Plan Generator

AI-powered estate planning document generation for solo and small law firms in New Jersey.
Generates complete, attorney-reviewed draft documents (wills, trusts, POAs, advance directives,
deeds, and more) from structured client questionnaire data.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui |
| Backend | Firebase Cloud Functions v2 (Node 20, TypeScript, `us-east1`) |
| Database | Cloud Firestore |
| Storage | Firebase Cloud Storage |
| AI | Anthropic Claude, OpenAI GPT-4.1, Google Gemini/Vertex — multi-provider with automatic fallback |
| Hosting | Firebase Hosting |

## Document Generation Modes

- **hybrid** (default) — Handlebars template + AI enhancement for unresolved fields
- **template** — Pure Handlebars rendering, deterministic
- **ai** — Full AI generation from scratch, no template required
- **high-fidelity** — Binary `.docx` output via docxtemplater *(planned, not yet available)*

## Quick Start

```bash
# Install dependencies
npm install
cd functions && npm install && cd ..

# Dev server
npm run dev

# TypeScript check (root)
npx tsc --noEmit

# TypeScript check (functions)
cd functions && npx tsc --noEmit
```

## Deployment

See `DEPLOYMENT.md` for full deploy instructions, environment variables, and CI setup.

```bash
# Deploy everything
firebase deploy --project estate-plan-generator

# Deploy specific targets
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only firestore
```

## Project Structure

```
estate-plan-generator/
├── src/                        # React frontend
│   ├── components/             # Shared UI components
│   ├── pages/                  # Route-level pages
│   └── services/               # API service wrappers
├── functions/src/              # Firebase Cloud Functions
│   ├── generate-documents.ts   # Batch generation entry point
│   ├── unified-generator.ts    # Single-doc generation orchestrator
│   ├── template-engine.ts      # Handlebars rendering + AI hybrid
│   ├── ai-client.ts            # Multi-provider AI routing
│   ├── client-data-serializer.ts  # Canonical prompt context builder
│   ├── generators/             # Per-doc-type AI generators (10 doc types)
│   └── templates/              # Handlebars (.hbs) template files
├── functions-backfill/         # Isolated embedding backfill package (see README inside)
├── .agent/                     # Agent rules, conventions, and workflows
└── DEPLOYMENT.md               # Full deployment and environment guide
```

## Supported Document Types

Will, Pour-Over Will, Revocable Living Trust, Financial POA, Healthcare POA / Advance Directive,
Deed, Affidavit of Consideration, GIT-REP3, Estate Plan Summary, Questionnaire Summary.

## Agent Rules

See `.agent/RULES.md` and `.agent/conventions.md` for coding standards and deploy conventions.
