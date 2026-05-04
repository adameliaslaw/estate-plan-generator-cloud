# Homework — Incomplete / Deferred Work

## Must Do Before Deploying to Production

### 1. Set Firebase Secrets
```bash
firebase functions:secrets:set PAGEINDEX_API_KEY
firebase functions:secrets:set ANTHROPIC_API_KEY   # if not already set
```
The `ragChat`, `pageIndexClientFilesChat`, `ingestDocument`, and `chatAi` Cloud Functions will crash on cold start without these.

### 2. Restrict the Google Maps API Key in GCP Console
`getFirmBranding` exposes `googleMapsApiKey` to unauthenticated callers (required for Places Autocomplete in the questionnaire). Without HTTP referrer restrictions, the key can be harvested and used on external domains.

Go to: GCP Console → APIs & Services → Credentials → select the key → Application restrictions → HTTP referrers → add your firm's domains.

---

## Architecture / Feature Work (Deferred)

### 3. Client Dashboard Chat — Save to Vault
The Draft tab is now on the Client Dashboard (Tab 8). The next step is saving generated drafts to the Document Vault. Decision needed: save per exchange as a Firestore document under `firms/{firmId}/clients/{clientId}/documents/` (reuses existing `documentService` pattern) or as a Cloud Storage file? The `documentService` pattern is the natural fit — pick a `docType` (e.g. `'custom'`) and wire a "Save to Vault" button in `DraftTab`.

### 4. Fastcase Integration
The slot is built and ready (`functions/src/courtlistener-client.ts → searchFastcase`). Contact sales@fastcase.com (or 1-866-773-2782) to get API credentials. Once obtained:
- Implement `searchFastcase()` in `courtlistener-client.ts` (marked with TODO)
- Add `fastcaseApiKey` to the firm settings UI so each firm can configure it

### 5. DOCX Support for Ingestion
PageIndex only accepts PDFs via its `/doc/` endpoint. DOCX files are currently rejected with a clear error. If DOCX support is needed, add a conversion step (e.g. LibreOffice headless or a third-party API) before upload. The ingest pipeline in `ingest-document.ts` and `scripts/ingest/src/ingest.ts` is structured to accommodate this.

---

## Scripts to Run (One-Time)

### 6. Seed Existing PageIndex Docs into Firestore
If documents were uploaded to PageIndex before this migration (via the PageIndex web console), register them so the RAG functions can find them:
```bash
# Create a JSON manifest of existing docs:
# [ { "doc_id": "pi-xxx", "fileName": "nj-estates-act.pdf", "namespace": "reference" }, ... ]

cd functions && npx ts-node ../scripts/seed-pageindex.ts --input ../docs.json
```

---

## Smoke Tests (Run After Deploying)

### 7. End-to-End Smoke Test Checklist
- [ ] Upload a PDF via the Upload modal → confirm it appears in `pageindex_docs/{ns}/files` in Firestore
- [ ] Open `/chat` → Research tab → ask a question → citations show `section` + page number (not a score %)
- [ ] Confirm Client Files citations appear in a separate labeled section (right panel)
- [ ] Open `/chat` → Draft tab → select a work-product doc → generate a draft → streaming output renders
- [ ] Confirm non-staff user gets 403 on both `ragChat` and `pageIndexClientFilesChat` Cloud Functions
- [ ] Open GlobalAiWidget → switch to Research mode → verify PageIndex + CourtListener context appears in response
- [ ] Open Client Dashboard → Draft tab → select a work-product doc → confirm streaming draft output
- [ ] Record a dictation note → confirm transcription status badge progresses `pending → processing → completed`
- [ ] Click Summarize on a completed transcription → confirm AI summary saves to Firestore

---

## Known Tech Debt

- **`PAGEINDEX_API_KEY` per-firm override** — `chatAi` now falls back to the Firebase Secret, but if a firm sets `pageindexApiKey` in Firestore it will still be used. If per-firm overrides are not needed, remove the Firestore field from the firm settings UI and clean up the fallback chain.
- **`/chat` Draft tab** — `DraftTab` still renders in the standalone `/chat` page as well as the Client Dashboard. If the `/chat` page should be research-only, remove the Draft tab from `src/pages/admin/ChatPage.tsx`.
