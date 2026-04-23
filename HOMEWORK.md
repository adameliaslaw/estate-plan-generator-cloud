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

**D. Audit template variable mappings.** Mostly resolved on 2026-04-23 — see the
Completed block below for the POA/HC/pour-over/Will consolidation and fixes.
Remaining: **Rizzo Living Trust** retemplatization produced poor output (0
fiduciary paths, 80.5% structural fidelity, 81 HTML tags lost). Path forward is
re-uploading the source DOCX and/or improving the templatize prompt for trust
documents. Tracked in user's re-upload queue.

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

## 🔲 #4 — Google Service-Account Key Rotation (still pending)

The OAuth portion of #4 is done (see Completed 2026-04-23 session below). What
remains is the GCP service-account key rotation:

- **GCP service-account key** `c059f6a569611c0aa9f74fa93fe1d45707f36d21` for
  `estate-plan-generator@appspot.gserviceaccount.com` — delete in GCP Console →
  IAM & Admin → Service Accounts → Keys, then create a new key and store it
  securely (not in git).

---

## Completed (2026-04-23 session — OAuth rotation, template consolidation, calendar sync)

**OAuth rotation (#4 closed):**
- ✅ Created new Google OAuth 2.0 client (`…donln8vkprbol5uk7hhui19fbnc7ff7j`) with correct Authorized JavaScript origins from the start.
- ✅ Updated `.env` → `VITE_GOOGLE_CLIENT_ID`; rotated Firebase `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` secrets (destroyed stale versions 1-4, kept v5).
- ✅ Redeployed all 7 OAuth-dependent functions + hosting.
- ✅ Deleted old `…nduck1v` OAuth client in GCP Console (leaked secret now dead).
- ✅ Added `Cross-Origin-Opener-Policy: same-origin-allow-popups` to hosting headers in `firebase.json` so Google's OAuth popup can post back to the parent window.
- ✅ Verified Calendar reconnection; `syncGoogleCalendar` no longer logs `invalid_grant`.

**Template consolidation (#2D largely closed):**
- ✅ **POA** — deleted redundant Sean Byrnes POA template (gender-twin of Jess's); kept Jessica Byrnes POA with `{{clientPronouns.*}}` helpers driving gender-neutrality. Fixed one hardcoded `his/her` → `{{clientPronouns.possessive}}`.
- ✅ **HC Directive** — deleted Sean Byrnes HC template; fixed Jessica Byrnes HC Primary HCR paragraph (`{{spouseTitle}} {{spouseFullName}}` → `healthcareProxy.primary.*`) and First Level Successor paragraph (wrong POA path + shifted-up tier → `healthcareProxy.alternate.*`).
- ✅ **Pour-Over Will** — deleted Vita Maria Rizzo template; fixed Vito Rizzo Initial Executor relationship (`{{spouseTitle}}` → `executor.primary.relationship`) and renamed Funeral Representative paragraph's duplicate "Appointment of Initial Executor" heading to "Appointment of Funeral Representative".
- ✅ **Will (LW&T)** — deleted Sean Byrnes Will; rewrote Jessica Byrnes Will executor chain. IL's four-tier chain (Initial / 1st / 2nd / 3rd Successor) was mapped off-by-one to the app's three-tier data model (`primary` / `alternate` / `successor`) — every tier was one slot up, with Initial Executor hardcoded to spouse. Dropped the 4th-tier paragraph, shifted the rest down to their correct fiduciary paths.

**Rizzo Living Trust (deferred):**
- 🔲 Retemplatization attempted via the per-template button (shipped in `0ab7fa2`). Output quality low: 0 fiduciary paths (worse than before), 80.5% structural fidelity. Queued for user to re-upload the DOCX via KB admin UI.

**Infra fixes shipped during the session:**
- ✅ `functions/src/ai-client.ts` — added custom undici `Agent` (10-min headers+body timeouts) on top of Node's `fetch` so large AI prompts don't get killed by undici's default 300s headersTimeout. Installed `undici@6` as a direct dep to match Node 22's bundled major version. Was causing Rizzo trust retemplatize to fail at exactly 301s.
- ✅ `functions/src/retemplatize-templates.ts` — bumped `timeoutSeconds` from 540 → 1800 so a 10-minute AI call doesn't surface as `deadline-exceeded` client-side; added `.cause` and stack-trace logging on caught errors.

**Calendar sync bonus work (follow-on from OAuth verification):**
- ✅ **Multi-calendar sync** — both `syncGoogleCalendar` (scheduled, every 5 min) and `triggerFirmCalendarSync` (Sync Now button) now enumerate all calendars via `calendarList.list?minAccessRole=reader` and sync every calendar the user has toggled on (`selected: true`) in Google Calendar's sidebar. Previously hardcoded to `primary`. No app-side UI needed — Google's own selection flag is the source of truth. Each Firestore event now carries `calendarId` + `calendarSummary` tags.
- ✅ **All-day event timezone fix** — Google returns all-day events as a bare date string (`2026-04-27`); `new Date()` parses these as UTC midnight, which shifts them to 8pm Eastern the previous day. Added `parseGoogleCalendarDate()` helper that anchors all-day events at noon UTC, putting them on the correct calendar date in every US timezone.
- ✅ **Orphan cleanup** — one-off script deleted 78 stale Firestore events that pre-dated the 2-year force-sync window and no longer exist in Google Calendar.
- ✅ **Client-side sync timeout** — `httpsCallable` has a 70-second client default that doesn't scale with the function's own timeout; bumped to 540s on the Sync Now button. Fix shipped after users saw `deadline-exceeded` on multi-calendar pulls that actually completed server-side in ~80s.

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
