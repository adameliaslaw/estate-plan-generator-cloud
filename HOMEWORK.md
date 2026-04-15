# Estate Plan Generator — Homework

Items requiring human action or decisions before the next agent session can proceed.

---

## 🔲 #1 — Upload remaining software templates

Firestore now contains only 9 real InteractiveLegal templates covering:
- `will` (2), `poa` (2), `livingWill` (2), `pourOverWill` (2), `trust` (1)

These doc types have no template yet (AI generation fallback applies):
- `deed`, `affidavitOfConsideration`, `gitRep3`, `estatePlanSummary`, `questionnaireSummary`

When InteractiveLegal (or another software source) provides templates for these types, upload them through the Knowledge Base admin UI with the correct `softwareSource` set.

---

## 🔲 #2 — Future functionality recommendations (not yet scoped)

Ranked by impact. Pick up in a future session.

**Efficiency multipliers:**
- **Multi-client batch generation** — staff currently runs one client at a time. A "generate for all pending" queue would cut time during busy weeks.
- **Reporting exports** — analytics widgets exist but are dashboard-only. Add CSV export + weekly email digest for the firm partner.

**Polish:**
- **Document version diff** — version history and restore already exist, but no side-by-side compare between two versions.
- **Time-to-completion metrics** — the data is already captured (timestamps on every event); no UI yet for intake → signed-plan duration by client or staff member.
- **Template variable live preview** — template authoring is blind; add a split-pane showing a template rendered against sample client data.
- **Smarter AI chat context** — chat-ai already pulls client data/notes/KB. Adding awareness of document status (e.g. "this client's will is in draft, their POA has not been generated") would make "what's left for this client?" a useful question.

---

## 🔲 #3 — Google OAuth client: fix origins + rotate credentials

Connecting Google Calendar from Settings → Integrations currently fails with
`Error 400: redirect_uri_mismatch` for `adam@adameliaslaw.com`. Root cause:
the OAuth client `749324460027-7f9s3sk22ckmp2r6u2v5u1o51nduck1v.apps.googleusercontent.com`
(the same one flagged for rotation below) is missing the current app origin
in its **Authorized JavaScript origins** list.

**Immediate unblock (add missing origins):**
1. https://console.cloud.google.com/apis/credentials?project=estate-plan-generator
2. Open the OAuth 2.0 Client ending in `…nduck1v`
3. Under *Authorized JavaScript origins*, ensure all of these are present:
   - `https://estate-plan-generator.web.app`
   - `https://estate-plan-generator.firebaseapp.com`
   - `http://localhost:5173` (only if running the dev server)
4. Save and retry the Connect button (~1 min propagation).

**Then rotate (ties into the credential rotation item below):**
1. Create a **new** OAuth 2.0 Client ID (Web application) with the origins above set from the start.
2. Update `.env` → `VITE_GOOGLE_CLIENT_ID=<new id>` and rebuild/redeploy hosting.
3. Store the new secret in Functions secrets:
   ```bash
   firebase functions:secrets:set GOOGLE_CLIENT_ID
   firebase functions:secrets:set GOOGLE_CLIENT_SECRET
   ```
4. Redeploy functions, verify Calendar + Drive connect flows, then delete the old client ID in GCP.

Also note: `syncGoogleCalendar` scheduled function is logging `invalid_grant` every 5 minutes — the stored refresh token is revoked. Reconnecting once the origins are fixed will clear it.

---

## ✅ Credential rotation (still pending user action in GCP/Google consoles)

These were handled in code (credentials removed from tracked files) but the credentials themselves must be revoked:

- **GCP service-account key** `c059f6a569611c0aa9f74fa93fe1d45707f36d21` for `estate-plan-generator@appspot.gserviceaccount.com` — delete in GCP Console → IAM & Admin → Service Accounts → Keys, then create a new key and store it securely (not in git)
- **Google OAuth credentials** — the `GOOGLE_CLIENT_ID` (`749324460027-7f9s3sk22ckmp2r6u2v5u1o51nduck1v.apps.googleusercontent.com`) and `GOOGLE_CLIENT_SECRET` (`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`) that were in `injectSecrets.cjs` — rotate both in Google Cloud Console → APIs & Services → Credentials, then run:
  ```bash
  firebase functions:secrets:set GOOGLE_CLIENT_ID
  firebase functions:secrets:set GOOGLE_CLIENT_SECRET
  ```

---

## Completed (April 2026 audit session + cleanup)

- ✅ **Dashboard action queues** — "Ready to Draft" (questionnaire-done, docs-pending) with compact one-click Generate buttons, and "Awaiting Review" (docs in draft/review/needs_review) listing clients with pending-doc counts. New firestore collection-group rule for `documents` scoped by `firmId`.
- ✅ **Deadline tracking** — added `ClientDeadline` type, per-client `DeadlinesCard` on the Info tab for add/complete/delete, and an "Upcoming Deadlines" section on the main dashboard with overdue/today/this-week/future color coding.
- ✅ **Hosting target lock** — `firebase.json` now targets `main` → `estate-plan-generator` site so deploys can't accidentally clobber `adamelias-ai.web.app` (or vice versa).
- ✅ **Cross-site hosting collision investigation** — traced adamelias.ai content being served at `estate-plan-generator.web.app`; root cause was the adamelias.ai CI running untargeted `firebase deploy`. Fixed on both sides.
- ✅ Firebase deploy (hosting + functions) — April 2026 audit commits live in production
- ✅ `firebase-functions` upgraded to v7, `firebase-admin` to v13 — 14 files migrated to `firebase-functions/v1` explicit imports
- ✅ Service-account private key removed from `.gitignore`
- ✅ Hardcoded OAuth credentials removed from `injectSecrets.cjs`
- ✅ `dangerouslySetInnerHTML` audit — all call-sites confirmed sanitized via DOMPurify
- ✅ `high-fidelity` mode traced → dead binary path → `HttpsError('unimplemented')` guard added
- ✅ Template upload root cause (`process-template-file.ts`) — confirmed already fixed in a prior commit; direct AI HTML templatization is in place
- ✅ Template mode raw-HTML fallback fixed (`template-engine.ts`)
- ✅ Null/undefined critical field detection — `markMissingFiduciaries()` inserts `[MISSING: label]`
- ✅ `_contextFailed` flag propagated through unified-generator → generate-documents → service → UI
- ✅ Preloaded context cascade fixed: batch preload failure now throws instead of silently degrading per-doc
- ✅ Property index fallback: `console.warn` + `_propertyIndexFallback` metadata flag
- ✅ AI client typed response interfaces (Anthropic, Gemini, Perplexity, OpenAI)
- ✅ Structural validator retry — confirmed retry re-prompts AI (not just marks `needs_review`)
- ✅ ~45 `any` usages cleaned across 14 functions files
- ✅ Debug scripts deleted (`check_empty_templates.js`, `diff-vars.js`, etc.)
- ✅ `.agents/` orphaned directory deleted
- ✅ `README.md` rewritten with project-specific content
- ✅ `DEPLOYMENT.md` repo name fixed + test count updated to 578
- ✅ `gemini.md` deleted
- ✅ `functions-backfill/README.md` created with OOM isolation explanation
- ✅ `AUDIT_HANDOFF.md` updated with session log and all checkbox states
- ✅ Dead template files removed (11 DOCX + `template-map.ts`) — Firestore is sole template source
- ✅ AI-generated Firestore templates flushed — 41 records deleted, 9 InteractiveLegal templates remain
- ✅ `flush-ai-templates.js` script added for future use
