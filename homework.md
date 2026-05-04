# Homework — Incomplete / Deferred Work

## Must Do Before Deploying to Production

### 1. Set Firebase Secrets
```bash
firebase functions:secrets:set PAGEINDEX_API_KEY
firebase functions:secrets:set ANTHROPIC_API_KEY   # if not already set
```
The `ragChat`, `pageIndexClientFilesChat`, and `ingestDocument` Cloud Functions will crash on cold start without these.

### 2. Run `npm install` in functions/
`@pinecone-database/pinecone` was removed from `functions/package.json`. The lockfile and `node_modules` need updating before the next deploy:
```bash
cd functions && npm install
```

### 3. Run `npm install` in scripts/ingest/
`scripts/ingest/package.json` was updated (removed Pinecone/Voyage, added firebase-admin). Run:
```bash
cd scripts/ingest && npm install
```

### 4. Restrict the Google Maps API Key in GCP Console
`getFirmBranding` exposes `googleMapsApiKey` to unauthenticated callers (required for Places Autocomplete in the questionnaire). Without HTTP referrer restrictions, the key can be harvested and used on external domains.

Go to: GCP Console → APIs & Services → Credentials → select the key → Application restrictions → HTTP referrers → add your firm's domains.

---

## Architecture / Feature Work (Deferred)

### 5. Move Draft Tab to Client Dashboard
`DraftTab` currently lives in the standalone `/chat` page. It should move to the Client Dashboard where client context is naturally available. The component (`src/components/chat/DraftTab.tsx`) and service function (`streamDraftChat`) are built — they just need to be wired into the Client Dashboard tab layout alongside the planned Chat tab.

### 6. Client Dashboard "Chat" Tab
Replace the static Research section on the Client Dashboard with a full chat interface that:
- Knows which client is active (no @mention needed)
- Fires both `streamRagChat` (reference + work-product) and `streamClientFilesChat` in parallel, scoped to that client
- Saves entire chat exchanges (not individual messages) to the Document Vault

The save-to-vault architecture needs a decision: save per exchange as a Firestore document under `firms/{firmId}/clients/{clientId}/vault/` or as a Cloud Storage file? The `documentService` pattern already exists — pick a path and wire it up.

### 7. Consolidate `PAGEINDEX_API_KEY` Storage
Currently the key lives in two places:
- Firebase Secret (`PAGEINDEX_API_KEY`) — used by `ragChat` and `pageIndexClientFilesChat`
- Firestore `firms/{firmId}.pageindexApiKey` — used by `chatAi` (GlobalAiWidget)

Both need the same key. Either read the Firebase Secret inside `chatAi` (cleaner) or keep Firestore as the source of truth and remove the Firebase Secret. Pick one and remove the other.

### 8. Fastcase Integration
The slot is built and ready (`functions/src/courtlistener-client.ts → searchFastcase`). Contact sales@fastcase.com (or 1-866-773-2782) to get API credentials. Once obtained:
- Implement `searchFastcase()` in `courtlistener-client.ts` (marked with TODO)
- Add `fastcaseApiKey` to the firm settings UI so each firm can configure it

### 9. DOCX Support for Ingestion
PageIndex only accepts PDFs via its `/doc/` endpoint. DOCX files are currently rejected with a clear error. If DOCX support is needed, add a conversion step (e.g. LibreOffice headless or a third-party API) before upload. The ingest pipeline in `ingest-document.ts` and `scripts/ingest/src/ingest.ts` is structured to accommodate this.

---

## Scripts to Run (One-Time)

### 10. Seed Existing PageIndex Docs into Firestore
If documents were uploaded to PageIndex before this migration (via the PageIndex web console), register them so the RAG functions can find them:
```bash
# Create a JSON manifest of existing docs:
# [ { "doc_id": "pi-xxx", "fileName": "nj-estates-act.pdf", "namespace": "reference" }, ... ]

cd functions && npx ts-node ../scripts/seed-pageindex.ts --input ../docs.json
```

---

## Smoke Tests (Run After Deploying)

### 11. End-to-End Smoke Test Checklist
- [ ] Upload a PDF via the Upload modal → confirm it appears in `pageindex_docs/{ns}/files` in Firestore
- [ ] Open `/chat` → Research tab → ask a question → citations show `section` + page number (not a score %)
- [ ] Confirm Client Files citations appear in a separate labeled section (right panel)
- [ ] Open `/chat` → Draft tab → select a work-product doc → generate a draft → streaming output renders
- [ ] Confirm non-staff user gets 403 on both `ragChat` and `pageIndexClientFilesChat` Cloud Functions
- [ ] Open GlobalAiWidget → switch to Research mode → verify PageIndex + CourtListener context appears in response
- [ ] Record a dictation note → confirm transcription status badge progresses `pending → processing → completed`
- [ ] Click Summarize on a completed transcription → confirm AI summary saves to Firestore

---

## Known Redundancy / Tech Debt

- **`staff` role** — defined in `firestore.rules` and `src/types/index.ts` but never assigned by any Cloud Function (only `admin`, `attorney`, `paralegal`, `client` are assigned). Either implement it or remove it from the rules and types.
- **`assemblyai-transcribe.ts` — `autoSummary` field in `EnhancedTranscript`** — `summary` is always `''` because AssemblyAI deprecated summarization. The field remains in the type but will never be populated. Remove it or replace with the post-transcription `summarizeTranscription` Cloud Function flow.
