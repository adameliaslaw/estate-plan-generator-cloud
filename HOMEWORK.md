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

## 🔲 #2 — Data & settings fixes from template-fidelity investigation

Four small data-side actions, all from the April 2026 POA + HC Directive test-generation
that revealed substitution drift. Code-side fixes shipped in the same session; these are
the remaining human-touch items.

**A. Set gender on existing clients.** Generation now fails loud if `personalInfo.gender`
is unset (no more silent male-default). Open Karen Elias (and any other pre-existing
client) in Clients → Edit Questionnaire → About You → gender step, pick Male/Female, save.
Newly-intaked clients are fine — the step is already in the questionnaire.

**B. Fix missing state on existing clients.** AddressField now auto-persists `NJ` on any
address edit, but existing records with empty `personalInfo.state` need the fix. Either:
  - Open the client → Edit Questionnaire → re-save the address step (triggers the fix), or
  - Edit Firestore directly: set `personalInfo.state: "NJ"` on any client whose address
    lacks one.

**C. Populate firm-doc fields that templates reference.** The HC Directive test rendered
blank witness names, blank witness addresses, and a nameless attorney signature because
these fields don't exist on the firm doc. Add them in Firestore:

```
// firms/elias-counsel
attorneyName:    "Adam J. Elias, Esq."
witness1Name:    "<witness #1 full name>"
witness1Address: "<witness #1 full address>"
witness2Name:    "<witness #2 full name>"
witness2Address: "<witness #2 full address>"
```

**D. Audit template variable mappings.** The AI templatizer mapped the HC Directive's
primary Health-Care Representative to `{{spouseTitle}} {{spouseFullName}}` (assumes HCR =
spouse) and mapped the successor HCR's address to `{{fiduciaries.powerOfAttorney.agent.address}}`
(wrong path). Use the Template Preview panel (built this session) against Karen's data to
find all such mis-mappings across uploaded templates, then correct them via the KB edit UI.
Expected variable names for HCR should be `{{fiduciaries.healthcareProxy.primary.name}}`,
`.relationship`, `.address`, etc.

---

## 🔲 #3 — Enable Cloud Scheduler + Pub/Sub APIs for weekly digest

The new `sendWeeklyDigest` function (Monday 8am ET) will deploy successfully
but will not fire until both APIs are enabled in GCP.

1. https://console.cloud.google.com/apis/library/cloudscheduler.googleapis.com?project=estate-plan-generator — click Enable
2. https://console.cloud.google.com/apis/library/pubsub.googleapis.com?project=estate-plan-generator — click Enable
3. Redeploy functions so Cloud Scheduler picks up the new schedule.

Also seed at least one recipient so the digest actually sends:

```
// Edit firms/elias-counsel in Firestore console
weeklyDigestRecipients: ['adam@adameliaslaw.com']
```

Firms with an empty or missing `weeklyDigestRecipients` array are silently
skipped — that's the opt-out mechanism.

---

## 🔲 #4 — Google OAuth client: fix origins + rotate credentials

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

## Completed (April 2026 build-out session — #2 future functionality)

- ✅ **Multi-client batch generation** — dashboard "Batch generate…" button on the Ready-to-Draft card lets staff pick clients, set shared options once, and run sequentially (client-side loop, per-client success/error summary).
- ✅ **Reporting exports** — Export PDF button on Analytics Overview (per-client roster) + weekly email digest (Mon 8am ET) with inline HTML summary + 2 PDF attachments. Per-firm opt-in via `weeklyDigestRecipients: string[]` on firm doc. *Requires Cloud Scheduler enablement — see open item #2 above.*
- ✅ **Document version diff** — "Compare versions" button on the Version History dialog opens a diff view with From/To version pickers, side-by-side and unified view modes, and word-level highlighting. Text-only diff (formatting changes not shown).
- ✅ **Time-to-completion metrics** — "Turnaround Times" card on the dashboard with five medians (questionnaire, draft, review, signing lag, full cycle) and a per-client "View breakdown" modal with stage chips, sortable columns, and stage filter. Derived from existing timestamps — no schema changes.
- ✅ **Template variable live preview** — "Show preview" toggle on the Upload Document Template dialog opens a split-pane with the template on the left and a live-rendered preview on the right. Client picker defaults to Karen Elias; same Handlebars helpers as production (client-side render via handlebars).

## Completed (April 2026 audit session + cleanup)

- ✅ **Smarter AI chat context** — `chat-ai.ts` now injects a DOCUMENT STATUS block per client that rolls up vault documents by docType, compares against the expected docs for their package, and lists each required doc as done / in-progress / not-yet-generated. Chat prompt updated to answer "what's left for this client?" from that block only (no invented docs).
- ✅ **Questionnaire edit-mode spinner** — staff opening a completed questionnaire for edit no longer hangs on an infinite spinner when the saved step index is past the end of visibleSteps (happens after step-definition amendments). `QuestionnaireShell` now clamps the out-of-range index back to step 0.
- ✅ **Client dashboard spinner (documents.firmId collection-group)** — added the missing single-field exemption for `documents.firmId @ COLLECTION_GROUP` so the main dashboard's Ready-to-Draft / Awaiting-Review queues can subscribe without the query failing.
- ✅ **Bulk template upload resilience** — `getDownloadURL` failures after a successful upload no longer abort the batch; `storagePath` is the authoritative pointer and `fileUrl` falls back to '' on permission errors (common when the user's ID token predates the admin claim).
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
