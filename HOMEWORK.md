# Estate Plan Generator — Homework

Items requiring human action or decisions before the next agent session can proceed.

---

## 🚩 START HERE NEXT SESSION — CI functions-deploy root-cause fix (issue #64)

**TL;DR — Last session (2026-07-02) shipped BV (OAuth needs-reauth, #82, live) and four CI-workflow patches (#81–#84) that tried to make the functions-deploy *survive* a symptom. Prod is healthy the whole time; the only open thing is CI-green + a 2.5h deploy that should be 10 min. STOP patching the symptom. Fix the disease.**

**The disease (diagnosed, not yet fixed):** Firebase decides redeploy-vs-skip per function by hashing the uploaded source bundle. That hash is unstable across CI runs → all ~80 functions look changed every run → we mass-deploy 80 CF v2 functions (~2.5h) → mass-deploying 80 at once trips a rotating burst of 409 "unable to queue the operation". Problem 2 is *caused by* problem 1. Fix the hash and the mass deploy, the runtime, and the 409 lottery all vanish — and PRs #81–#84's machinery (drain, straggler pass, patient retries) becomes deletable dead code.

**Prime suspect:** the source tarball firebase uploads includes file **mtimes**, and `git checkout` + `npm ci` stamp fresh mtimes every CI run → identical content, different tarball, different hash. This explains why even a plain *rerun* re-updates all 80 instead of skipping.

**Go-forward plan (investigate first, highest-leverage first):**
1. Confirm whether firebase-tools hashes source *content* or the *archive* (mtimes). Test in ONE `workflow_dispatch` run: normalize mtimes before deploy (`find functions/lib functions/src -exec touch -t 200001010000 {} +`, or `SOURCE_DATE_EPOCH`) and check the deploy reports "Skipped (No changes detected)" for unchanged functions.
2. **#1 (best):** if that stabilizes the hash, collapse the workflow back to a plain `firebase deploy --only functions` and DELETE the batch/drain/straggler/patient-retry machinery (~150 lines). Normal merges → ~10 min, only changed functions.
3. **#2 (fallback):** if the hash stays stubborn, diff-targeted deploy — compute changed functions from the git diff (map shared modules like `ai-client.ts` / `client-data-serializer.ts` to their dependents) and deploy only that set.
4. **#3 (only if forced):** split the 80 functions across multiple Firebase codebases.

**Guardrails (learned the hard way — non-negotiable):**
- Never-Break CI file → **Adam's explicit sign-off on the diff before merge.**
- **Never cancel a functions-deploy run mid-deploy** — orphans GCP ops that 409-poison later runs. `concurrency: cancel-in-progress: false` stays.
- Prod is healthy/current throughout — CI-green + speed fix only; nothing user-facing is broken.
- Verify workflow bash against the mock-harness pattern from last session before merging.
- After the first red, if the fix didn't work, **stop and re-diagnose — do not iterate retry knobs.** (That's the mistake that made last session 13 hours.)

**Definition of done:** a functions merge deploys only its changed functions, finishes green in ~10 min, issue #64 closed, this section removed.

**Meta-lesson:** after the first red deploy, the correct move was "why does everything look changed?" — not another retry knob. Ask the root-cause question first next time.

---

## 📍 SESSION — 2026-07-01 (Transcripts – Pending Filing queue shipped, #80; deploy-churn root cause found — follow-up logged, not yet done)

**✅ Shipped (#80, merged `63f8628`).** Staff-only "Transcripts – Pending Filing" queue: consult transcripts are transcribed outside this app by a separate, Admin-SDK-authenticated script and written to `firms/{firmId}/pendingTranscripts/{transcriptId}` — this app never handles audio. New `fileTranscriptToMatter` callable files a transcript into a client matter as a `Note` (`noteType:'transcript'`, `source:'system'`, full text in `transcription` — mirrors the existing audio-dictation Note convention), then marks the pending record `filed` (kept, never deleted). New staff page at `/transcripts`. Rules mirror the `auditLog` pattern (staff read-only, all writes Admin-SDK only). tsc/lint/build/640 tests all clean pre-merge.

**Deploy saga:** first functions-deploy run (`28522231845`) got cancelled by something external after 1h30m before reaching `fileTranscriptToMatter` or the rules update (not caused by a new push — `main` didn't move; cause of the cancellation itself wasn't identified). Re-triggered manually (`28530209691`); while it ran long again, root-caused **why** functions-deploys here always churn the full function set (see below) rather than just accepting it as cosmetic — investigation, not yet acted on.

**🟡 FOLLOW-UP (not blocking, do in a future session): split `functions/` into multiple Firebase codebases.**
- **Root cause, confirmed from `firebase-tools` source** (`lib/deploy/functions/cache/applyHash.js`): Firebase computes ONE hash for the entire packaged source zip **per codebase** and applies that identical hash to every function in it (`applyBackendHashToEndpoints` loops all endpoints, assigning the same `sourceHash`). This project has all ~84 functions in a single `default` codebase, so **any** change to **any** file under `functions/src` — not just "shared modules" as earlier sessions assumed — changes the zip hash, marks all ~84 functions as changed, and triggers a full-codebase redeploy every time. Confirmed empirically too: the 2026-07-01 deploy showed 49+ new Cloud Builds (all `SUCCESS`, ~1 every 2-3 min) for a change that only touched one new file + a one-line `index.ts` export — consistent with "all functions rebuilt," not a real per-function diff.
- **The fix Firebase provides for this:** multiple codebases (`firebase.json` → `functions: [{source, codebase}, ...]`), each with its own independent source hash. This repo already uses exactly this pattern for `functions-backfill/` (isolated on purpose) — the fix is to extend that pattern to the main `functions/` tree, e.g. split by domain (document generation, knowledge-base, wills-pipeline, integrations, etc.).
- **Why not done now:** real refactor, not a quick fix — shared modules (`ai-client.ts`, `auth-guards.ts`, `client-data-serializer.ts`, `template-engine.ts`, `firm-secrets.ts`, ...) need a home every codebase can import from (local workspace package, most likely); `firebase.json` and `.github/workflows/firebase-functions-deploy.yml` both need restructuring; every function's imports need re-pointing; needs careful testing across all ~84 functions before merge. Touches two Never-Break items (CI workflows; the deploy topology) — needs explicit sign-off, and is sized as its own session, not a bolt-on to unrelated feature work.
- **Adam's call (2026-07-01):** do the full split eventually; don't let it block feature work in the meantime (the current single-codebase churn is slow but not broken — it converges, just takes 30-90+ min per push that touches `functions/src`). Pick this up as a dedicated session when there's room for the refactor + testing.

---

## 📍 SESSION — 2026-07-01 (truth-in-status frontend cluster: CR/CS/CW shipped; e-sign = wire a real provider, PLANNING NEXT)

**TL;DR — 3 truth-in-status frontend fixes (CR, CS, CW) shipped + merged (#71, `b01370e`); hosting deploy auto-running (green CI path). CU (e-sign) escalated to a real-provider integration per Adam — that's the next work, and it needs Adam's provider choice + credentials before code.**

**Session start (clean):** `main` in sync at `9f3634c`; **83/83 functions ACTIVE, 0 FAILED** (prod healthy). No open criticals. Issue #64 (CI functions-deploy red) is still the cosmetic build-hash churn — deliberately left to clear over normal deploys (Adam's 6/30 decision); untouched this session. Deliberately picked **frontend-only** work so it deploys clean (hosting CI green) instead of tripping the functions churn.

**✅ Shipped #8 (#77, merged `e6adb78`) — functions-side, direct-deployed:** H + V.
- **H** (`unified-generator.ts`): removed dead code (identical-branch status ternary + three `generationMode ?? 'hybrid'` that can't fire).
- **V** (`ai-client.ts`, Never-Break — Adam signed off, dispatch untouched): truncation-recovery stub no longer fabricates `witnessRequired:false`/`notarizationRequired:false` (omitted → unknown; `_truncated:true` → needs_review).
- **Deploy (churn-safe):** merged, **cancelled the CI functions run before its deploy step** (run `28514889160`, no orphan ops), confirmed op-queue all-ACTIVE, then `firebase deploy --only functions:generateDocuments,generateFlexDocument,generateSingleDocument` (small batch → no 409). All 3 updated OK; **83 ACTIVE / 0 FAILED.** H+V now live on the generation path; other `ai-client` consumers pick up V over normal deploys (zero urgency).
- **T → wontfix** (openai 4.104 uses node-fetch + 10-min SDK timeout; no 300s cutoff — premise false). **AO → wontfix** (`callAI` firmData is routing-only, not prompt-injected; raw is safer than safeFirm).
- **✅ Functions-side mediums now fully resolved (H fixed, V fixed, T/AO wontfix).** Only remaining audit item overall: **CU (e-sign)** — planned, blocked on Adam's Dropbox Sign key. (Deferred T9 half was Adam's earlier skip.)

**✅ Shipped #7 (#76, merged `1e70498`, hosting deployed green):** bulk client import hardening (DK/DP/DQ/DR) — all in `BulkImportModal.tsx` (**frontend**, not functions; corrected my earlier mislabel). DK console.errors the swallowed import error; DP warns (non-blocking) on unknown package; DQ blocks malformed email (blank still allowed); DR records per-row outcome + shows the rows table with an outcome-aware Status column in the `complete` phase. Ledger DK/DP/DQ/DR → fixed.

**⚠️ Correction:** DK/DP/DQ/DR were mislabeled "functions-side (bulk-import)" in earlier notes — they're **frontend** (`BulkImportModal.tsx`). The genuinely functions-side mediums remaining are **H/T/V/AO** (H=`unified-generator.ts` dead code; **T**=`ai-client.ts` OpenAI path bypasses the 10-min timeout agent — the only high-value one; V=`ai-client.ts` parseAIJson fabricated will/POA metadata; AO=`summary-docs-generator.ts` un-sanitized firmData). **T and V touch `ai-client.ts` (Never-Break → sign-off) and are shared modules → heavy 409 churn on deploy.** Plus the deferred T9 half (Adam chose to skip). CU (e-sign) still planned/blocked on Dropbox Sign key.

**✅ Shipped #6 (#75, merged `ac4fdc8`, hosting deployed green):** DA — removed the dead "Regenerate with updated data" RowActions path in DocumentVault (never wired; editor already has Regenerate — Adam chose remove). Kept `DocumentStatusBadge`'s live `isStale` warning. Ledger DA → fixed. **All identified frontend audit cleanups are now closed except CU (e-sign, planned/blocked on Adam's Dropbox Sign key).**

**✅ Verified #5 — CX already fixed (#40, no new code):** AttorneyReviewGate now writes `reviewedAt: serverTimestamp()` + `reviewedBy` + terminal `status:'final'`; `Document` type has the review fields; disclaimer's "name and timestamp" promise matches the write. Ledger CX → fixed. **Only remaining frontend cleanup: DA (dead "Regenerate with updated data" action — wire or remove).**

**✅ Shipped #4 (#74, merged `077ec3f`):** CY duplicate version numbers — `saveVersion` computed the next number from the lagging `document.currentVersion`, so two snapshots in the subscription-lag window (autosave checkpoint + status change) collided. Now a `currentVersionRef` read+incremented synchronously before any await, seeded/kept >= persisted `currentVersion`. (onUpdate stale-callback half was already handled via `scheduleAutoSaveRef`.) Residual (accepted, 🟡): true cross-client concurrent editing would need a Firestore transaction. Ledger CY → fixed. Remaining frontend cleanups: CX (`reviewedAt`), DA (dead regenerate action).

**✅ Shipped #3 (#73, merged `d2f16a7`, hosting deployed green):** CV regenerate data-loss — the **core** was already fixed in #40 (`forceReloadRef` reloads the regenerated `editorContent` with `emitUpdate:false` + resets `hasUnsavedChanges`; verified regen writes to both `content` and `editorContent`). #73 closed the residual same-class window: editor now locked while `regenerating` + pending autosave timer cancelled at regen start. Ledger CV → fixed. Remaining non-T13 frontend cleanups: CX (`reviewedAt`), CY (TipTap onUpdate stale-closure → dup versionNumber), DA (dead regenerate action).

**✅ Shipped #2 (#72, merged `6479ddf`, hosting deployed green):** rest of the T13 truth-in-status cluster, frontend-only —
- **CT** (`GenerateDocumentsButton`): full-package (`generateAll`) path only errored on 0-generated; a partial result still claimed "All documents have been drafted." Now shows "Documents Partially Generated" + "N of M drafted, K failed" + red badge on error rows.
- **DG** (`ChargePaymentDialog`): "Payment Processed!" for any `success:true` ignored capture status. Now distinguishes captured/settled vs authorized-only (AffiniPay auto-captures daily → authorized isn't a failure, but isn't "processed" either).
- **DW** (`SettingsPage`): LawPay "Test Connection" faked success via an 800ms setTimeout. Now a neutral info toast; a real LawPay test callable is deferred (needs a functions deploy → churn).
- Verify: tsc -b + build clean, **634 tests**, eslint clean. Ledger rows CT/DG/DW marked fixed.

**Truth-in-status (T13) status:** CR/CS/CW (#71) + CT/DG/DW (#72) done. **Remaining in the cluster:** CU (e-sign — planned above, build next session). Non-T13 open frontend cleanups still available: CV (regenerate stale-content data-loss — DocumentEditor), CX (AttorneyReviewGate missing `reviewedAt`), CY (TipTap onUpdate stale-closure → duplicate versionNumber), DA (dead regenerate action).

**✅ Shipped (#71, merged, hosting deployed green):**
- **CR — `SingleDocumentGenerator`**: direct callable result AND the Firestore polling fallback both reported "saved to the Document Vault" ignoring status. A gen that ran but failed the vault save is written `status:'error'` (backend E) yet showed the green screen. Now both paths gate on `result.success`/`status!=='error'` → new `markFailure` (shares the settle guard) shows an honest failure.
- **CS — `FlexDocumentGenerator`**: `markSuccess` now routes an error-status doc to the error phase instead of "added to the Document Vault"; polling fallback no longer hardcodes `success:true`.
- **CW — `CommentsPanel`** (open half): reply `createdAt` was `null` forever (`serverTimestamp()` can't live inside an `arrayUnion` element) → every reply rendered "just now". Now stamps client-side `Timestamp.now()`.
- Verify: `tsc -b` clean, `vite build` clean, **634 tests pass**, no new lint warnings.

**✅ VERIFIED LIVE 2026-07-01 — full e-sign loop confirmed by Adam.** Callback URL set → sent to own email → signed → `dropboxSignWebhook` pulled the executed PDF into the vault → "Download signed document" opens it. Working end-to-end in prod. Real-world gates remain: (1) **paid Dropbox Sign API plan** to send to non-same-domain (real client) emails + non-watermarked binding docs; (2) **NJ legal validity** of e-signing wills/POAs/healthcare directives (wet-ink/witness/notary) — Adam's pending research; use e-sign only where valid.

**✅ SHIPPED 2026-07-01 (#79 `dcc3373`, direct-deployed) — signed-PDF retrieval (loop closed).** Verified live end-to-end: a test-mode send to Adam's own email succeeded (Dropbox Sign test mode only allows same-domain recipients — confirmed the send path incl. `file[0]` works). The `signature_request_downloadable` webhook now downloads the executed PDF via `GET /v3/signature_request/files/{id}`, stores it at `firms/{firmId}/clients/{clientId}/documents/signed_{documentId}_{sigReqId}.pdf` (staff+client readable per existing storage.rules), records `eSignature.signedStoragePath/signedFileName`, and DocumentVault shows a "Download signed document" action. Decided **non-embedded** signing (emailed link) is right for the solo practice; embedded is a paid-plan/phase-2 nicety.

**✅ SHIPPED 2026-07-01 (#78 `7a5538a`, direct-deployed).** Dropbox Sign built end-to-end and live: `sendForSignature` (real multipart send + PDF render), new `dropboxSignWebhook` (HMAC-verified status callbacks), `Document.eSignature`, Settings card (key + Test/Live toggle), honest `ESignatureDialog`. 84 functions ACTIVE (webhook created); hosting deploy green; 640 tests. **CU + BU resolved.**
> **🔴 ADAM — remaining setup before live use (do in this order):**
> 1. **Rotate** the API key you pasted in chat (Dropbox Sign dashboard → Settings → API → generate new, delete old).
> 2. Paste the **new** key into the app: **Settings → Integrations → Dropbox Sign → API Key → Save** (NOT chat). Leave the mode on **Test** for now.
> 3. Set the Dropbox Sign **account callback URL** to `https://us-east1-estate-plan-generator.cloudfunctions.net/dropboxSignWebhook` and click **Test** — it should return 200 (the webhook acks `callback_test`).
> 4. Do a **test-mode send** from a document's e-sign action. This validates the multipart file field (`file[0]`) against the live API — if the send 400s on the file param, tell me; it's a one-line fix.
> 5. Only flip Settings → **Live (binding)** once you're on a **paid Dropbox Sign API plan** (test mode is watermarked/non-binding and free).
> Also unresolved by design: whether NJ estate docs (wills/POAs/healthcare directives) can be *validly* e-signed vs. needing wet-ink/witnesses/notarization — your pending legal research; the tool sends regardless, so use it only where e-sign is legally valid.

**[SUPERSEDED — original plan, now shipped] CU (e-sign): wire Dropbox Sign (PLAN APPROVED 2026-07-01).** `functions/src/esign-service.ts` is an explicit **mock** — writes an activity-log entry, returns a fake `sig_req_${Date.now()}` with `success:true`, **sends no email**. UI (`ESignatureDialog`, live in `DocumentVault` via `onSendSignature`/`setSignDoc`) claims *"The signature request has been emailed to {client}"* — a false delivery claim on a legal doc. Audit's literal fix (gate on `res.success`) is a no-op (backend always returns `success:true`). **Adam's decisions:** provider = **Dropbox Sign** (ex-HelloSign); approach = **raw REST via `undici`** (already a dep) + hand-written HMAC verifier, NOT the `@dropbox/sign` SDK; **plan approved incl. the Never-Break `src/types/index.ts` change**; build it **next session** (not 7/1).

**Execution-ready plan (all API facts verified against official docs 2026-07-01 — do NOT re-research):**

*API cheat-sheet (verified):*
- **Auth:** HTTP Basic, API key as username + empty password → `Authorization: Basic base64(apiKey + ":")`.
- **Send:** `POST https://api.hellosign.com/v3/signature_request/send` as **multipart/form-data** (required when uploading `files[]` binary). Params: `files[]`=PDF, `signers[0][name]`, `signers[0][email_address]`, `subject`, `message`, `title`, `test_mode`, `metadata[firmId]` / `metadata[clientId]` / `metadata[documentId]` (correlation key, echoed in every webhook). Success → `response.signature_request.signature_request_id`.
- **Webhook:** arrives as **multipart/form-data with a `json` form field** (NOT raw JSON) — parse the `json` field. Verify: `event_hash` == HMAC-SHA256(`event_time` + `event_type`, **apiKey as secret**), `crypto.timingSafeEqual`. Endpoint MUST return HTTP 200 body literal **`Hello API Event Received`** (else 6 retries). Event types: `signature_request_sent|viewed|signed|all_signed|declined|canceled` (+ `callback_test` from the dashboard Test button). Config = **account-level callback URL** on Settings→API.
- **test_mode:** `test_mode:true` → free, no paid plan, watermarked/non-binding. Binding sends need a **paid API plan**.

*Build steps:*
1. **Secret/config:** add `dropboxSignApiKey` to `SECRET_KEY_FIELDS` (`functions/src/firm-secrets.ts`) → auto-handled by `updateFirmApiKeys` (`firm-settings.ts`) + `loadFirmSecrets`. Add non-secret `dropboxSignTestMode` bool on the firm doc, **default true**.
2. **Send (rewrite `esign-service.ts`):** keep staff-gate + firm-scope; load firm key (throw `failed-precondition` if unset); render PDF by reusing `buildLegalDocumentHtml()` + puppeteer from `export-pdf.ts` (bump memory to match export-pdf ~1GiB via `runWith`); POST multipart; persist `signatureRequestId` + `eSignature.status='sent'` on the doc; keep activity log; return the real id.
3. **Webhook (new `dropboxSignWebhook`):** mirror `lawpayWebhook` (onRequest v2, `invoker:'public'`, us-east1). Parse `json` field → get `metadata.firmId` → load that firm's key → verify `event_hash` → locate doc (firmId/clientId/documentId) → idempotent `eSignature.status` transition from `event_type` + activity log → return `Hello API Event Received`. Export from `index.ts`.
4. **Data model (⚠️ Never-Break — APPROVED):** add optional `eSignature?: { provider: 'dropbox-sign'; signatureRequestId: string; status: 'sent'|'viewed'|'signed'|'declined'|'canceled'; sentAt?; viewedAt?; signedAt?; declinedAt? }` to `Document` in `src/types/index.ts`. Additive/optional only.
5. **Frontend:** `src/pages/admin/SettingsPage.tsx` — add Dropbox Sign API-key field + test-mode toggle (mirror the SendGrid row, save via `updateFirmApiKeys`). `ESignatureDialog`/`DocumentVault` — show real `eSignature.status`.
6. **Verify:** functions tsc + root tsc -b + build + tests; add a unit test for the HMAC verifier (feed known event_time/event_type/apiKey → expected hash).
7. **Deploy (churn-aware):** two functions change → hits the CI functions-deploy churn. Use the #70 single-function direct-deploy: let CI go red, wait for op-queue all-ACTIVE, then `firebase deploy --only functions:sendForSignature,functions:dropboxSignWebhook`.

**Adam's prerequisites (do before live test):** (1) create Dropbox Sign account → Settings→API → copy API key → paste in app Settings (field added in step 5); (2) after deploy, set account callback URL = the `dropboxSignWebhook` function URL, hit Test (expect 200 + the literal string); (3) stays in test_mode (free/watermarked) until you upgrade to a paid API plan for binding sends.


## 📍 SESSION — 2026-06-30 (CI chunked-deploy + drain; convergence still unsolved — DECISION: let it resolve naturally)

**TL;DR — #69 (chunked deploy) + #70 (BM security fix) both LIVE; prod is healthy. The one open item is cosmetic CI-green, deliberately left to resolve over normal deploys.**

**Shipped:**
- **#69 (merged)** — reworked the functions-deploy step: rules → redeploy `default` codebase in batches of 5 with a state-based `drain()` (poll `firebase functions:list --json` until no fn is non-ACTIVE) → final full deploy as the gate; timeout 60→90. Supersedes the never-converging retry-the-full-deploy loop. (My earlier #68, full-first variant, was closed — redundant with the parallel session's #65 which I missed by not fetching at session start. See [[feedback_fetch_before_building]].)

**Still OPEN (cosmetic) — CI functions-deploy is RED; the build-hash churn won't converge in CI:**
- Root cause confirmed from run logs: Cloud Functions v2 returns `409 unable to queue the operation` because a function's prior update operation keeps **finalizing for MINUTES after it already serves `ACTIVE`**. The drain (waits for ACTIVE) is therefore insufficient — drained batches still 409. Manual convergence worked 6/29 only because it was paced **minutes** apart and never overlapped.
- **I made it worse then stopped:** an auto-re-trigger loop fired 6 runs back-to-back; `cancel-in-progress` killed them mid-deploy, but cancelling a CI run does NOT stop the GCP ops it started → **orphaned in-flight ops 409-poisoned every later run**. ~2.5h of CI, zero converged. Loop killed, orphan run cancelled, system left to settle. **Lesson: never auto-loop deploy runs here.** [[project_new_callable_deploy_footguns]]
- **Why it's cosmetic:** the ~51 "churned" functions already have the correct code (converged 6/29 — T6/T7/AR/T8/T9 all live). Only their build hash differs (CI's Linux build vs the 6/29 Windows-local build), so firebase wants to re-push them. **Nothing is broken for users.** Verified: 81 ACTIVE / 0 FAILED.
- **DECISION (Adam, 6/30): stop forcing it.** Let the churn clear over normal future functions deploys (each clean, non-overlapping run converts a handful permanently). CI may show red meanwhile — cosmetic. Open issue **#64** stays open until it clears.
- **If it must be forced later:** deploy ONE function at a time, polling each to fully finalize before the next (no concurrent ops → no 409), ~3h timeout. Slow but deterministic. (Never-Break CI file → needs sign-off.)
- ⚠️ **Caveat to watch:** because the chunked step re-attempts all 80 every run, a normal functions PR will likely also go red and *may* not cleanly deploy its own changed function through the storm. If a real deploy gets stuck, revisit (serialize, or settle-then-single-paced-run).

**✅ #70 (BM) — MERGED + LIVE (`4a54f56`).** Auth + per-firm rate-limit on the public `registerClientFromLink`: requires a session token, binds `linkedUserId` to the verified `request.auth.uid`, caps NEW stub creation at 50/firm/hour (transactional counter in the Functions-only `secrets` subcollection — no rules change). Verified tsc/lint/634 tests pre-merge. **Deployed directly, not via the merge's CI run:** that run (`28474985822`) would have churn-stormed, so I cancelled it while still in its build phase and ran `firebase deploy --only functions:default:registerClientFromLink` locally (clean queue, single function). **Verified live** — `registerClientFromLink` revision updated 2026-06-30T20:59Z, ACTIVE. The single-function direct deploy is the reliable pattern while the churn persists: cancel the CI run *before its deploy step starts* (no orphan ops), wait for the op-queue to settle (all ACTIVE), then deploy the one function. (App Check left as an optional follow-up — needs console + frontend setup; not bundled.)

---

## 📍 SESSION — 2026-06-30 (CI chunked-deploy rework — PR open, awaiting Adam's sign-off)

**✅ Implemented the chunked-deploy rework** for `.github/workflows/firebase-functions-deploy.yml` (the OPEN item below). The "Deploy functions + security rules" step now:
1. deploys `firestore:rules` + `storage` once (with retries),
2. enumerates deployed function short-names via `gcloud functions list --format="value(name)"` (basename-stripped for gen2 full paths) and redeploys them in **batches of 5** (`firebase deploy --only functions:a,functions:b,...`), each batch retried up to 3×,
3. runs a **final full `firebase deploy --only functions,firestore:rules,storage`** that catches brand-new functions + deletes removed ones; everything converged in step 2 is unchanged → skipped → **no 409 storm**. This final deploy is the authoritative convergence gate and **fails the job** (tripping the Notify-on-failure issue) if any per-function update 409s — the #63 fail-loud guarantee is preserved.
- `timeout-minutes` raised 45→60 for the ~15 batch invocations (each re-runs the predeploy build; unchanged functions skip fast).
- A batch that can't converge after retries is non-fatal — the final full deploy picks up its stragglers; only the final deploy gates the job.
- **Verified the bash control-flow locally** with mocked `gcloud`/`firebase`: happy path (13 fns → batches 5/5/3 → exit 0), final-deploy 409 storm → fail-loud exit 1, batch-fails-but-final-converges → exit 0 + info, gcloud-returns-0 → graceful fallback. YAML parses clean.

**🔴 DO NOT MERGE without Adam's explicit sign-off** — Never-Break CI file. Adam pre-approved the *direction* (chunked batches) last session, but the file itself needs his OK before merge. Once merged, the triggered CI run does one batched converge from CI's build → green + becomes the stable baseline (ends the local-build-vs-CI-build hash churn). PR opened on `claude/homework-continuation-0241ub`.

---

## ⏸️ PAUSED 2026-06-29 PM — pick up here tomorrow (CI deploy convergence)

**State at pause — PROD IS HEALTHY + FULLY CONVERGED.** An authoritative `gcloud functions list` sweep (gen1+gen2) shows **0 stale functions** except the 3 dormant `functions-backfill` jobs (separate codebase, console-only, expected). Every security fix (T6/T7/AR/T8/T9/#62) is now live on every function. SendGrid verified green. **Nothing user-facing is broken.**

**The one OPEN item — CI functions-deploy is RED and needs a chunked-deploy rework.** What we learned the hard way this session:
- The merged fail-loud guardrail (#63) **works correctly** — it caught non-convergence and failed the job (run `28405004871`) instead of going silent-green, and opened a CI-failure GitHub issue (assigned to @adameliaslaw).
- **But a full `firebase deploy --only functions` of this many (~70) functions gets 0 through** — every per-function update fails with HTTP 409 "unable to queue the operation" (Cloud Functions v2 shares one build/sourceToken; the op-queue cascades). Retrying the *full* deploy plateaus (8→8→4→4→4 failures, 0 successes). So "retry the full deploy" can't converge.
- **Small batches (≤5 functions per `firebase deploy --only functions:a,b,c,d`) succeed 100%** — that's how prod got converged this session (done manually, locally, batch by batch).
- **→ TOMORROW'S TASK: rewrite the functions-deploy step to deploy in small batches** instead of one big deploy. Plan: enumerate function names via `gcloud functions list --format="value(name)"` (clean; `firebase functions:list` is ANSI-table-noisy), deploy in chunks of ~4 (`firebase deploy --only functions:<chunk>` + `firestore:rules,storage` once), retry a failed chunk a couple times, then a final `firebase deploy --only functions` to catch any brand-new function (now all others are "unchanged" → no storm). Keep the fail-on-non-convergence check. This is a **Never-Break CI file → needs Adam's explicit sign-off before merge** (he pre-approved the *direction* this session). Once merged, the triggered CI run does one batched converge from CI's build → green + becomes the stable baseline (ends the local-build-vs-CI-build hash churn that makes CI want to redeploy everything).
- Interim: CI red is **expected and non-blocking** — prod is current. Don't panic-deploy; the next functions PR will go red the same way until the chunked rework lands. The open CI-failure issue can stay open until then.

---

## 🔴 OPEN CARRY-FORWARD (start here next session)

1. **✅ Smoke test — DONE/VERIFIED 2026-06-29.** "Test Connection" now returns **"API key is valid."** This conclusively closes **AR** and validates the full live path (migrated key → `loadFirmSecrets` merge → `testSendGridConnection`). The earlier *"not configured"* failure was NOT a data problem — the migration was fine; the live function + every email sender were frozen on **2026-06-25 pre-AR code** by the silent 409 deploy storm (see MAJOR FINDING below). Fixed by force-redeploying all stale functions from current `main` in small batches.

2. **Remaining audit items (no open criticals; ledger `docs/AUDIT-findings.md`):**
   - **T9 — mostly done (#62).** Zod length caps shipped on all 6 callables; HTML-escaping shipped on all email senders. **Deferred half:** "server-resolve email recipients" (ignore caller-supplied `to:` address, look it up from clientId server-side) — Adam chose to skip it: callable-contract + frontend change for marginal gain post-T6 staff-gating. Revisit only if that residual matters.
   - **App Check** — `registerClientFromLink` is public; add App Check / rate-limit (BM).
   - **Truth-in-status remainder** — CR/CU + the open halves of CS/CW.
   - **Medium cleanups** — DK/DP/DQ/DR (bulk-import), DM, DZ, H/T/V/AO (backend leftovers).
   - Never-Break gate (explicit sign-off) applies to: `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `functions/src/templates/*.hbs`, `src/types/index.ts`, CI workflows.

3. **Standing watch-item (passive):** OAuth durability alert — silence = healthy (see AUTOMATIC ALERTS section below).

---

## 📍 SESSION CLOSE — 2026-06-29 (T9 — input caps + email HTML-escape; DONE + deploying)

**✅ T9 mostly DONE (#62 `75fea30`, functions deploy run `28397761835` in progress).** Two API-compatible defense-in-depth hardenings:
- **Zod length caps** at the 6 callable boundaries that lacked them: `chatAi`/`saveMessageAsNote` (chat-ai.ts, v1), `enhanceTemplate`, `generateFlexDocument`, `createFirmUser`/`updateUserCapabilities`. `safeParse` replaces the manual presence checks; caps bound the free-form text feeding AI prompts (message 50k, customPrompt 20k, templateContent 500k, messageContent 100k). The createFirmUser role **enum** also rejects the legacy `'staff'` role (finding AV); capability allowlist unchanged. Removed the now-dead `ASSIGNABLE_ROLES` const + `FlexDocumentRequest` interface.
- **HTML-escape (finding BJ):** shared `escapeHtml()` in `email-notifications.ts`, applied to every caller-supplied scalar interpolated into firm-branded email HTML across all 7 senders + the createFirmUser welcome email + `ctaButton` href (names, descriptions, event details, doc-type list, link URLs). SendGrid recipient/display-name + audit fields keep raw values (not HTML contexts).
- **Deferred (Adam's call):** the "server-resolve email recipients" half of the BJ residual — rewrites the callable contract + frontend for marginal gain now that T6 gates every sender to staff. Not a blocker.
- Verify: functions `tsc` + root `tsc -b`/build clean; eslint **0 errors**; **634 tests** (added `tests/unit/email-escape-html.test.ts`, 5 cases).

**🔴 MAJOR FINDING — deploy pipeline was silently NOT converging (fixed 2026-06-29).** Investigating the SendGrid smoke-test failure uncovered that the recurring **409 "unable to queue the operation" storm** had stranded **~36 functions on 2026-06-25 code** — they never picked up T6 (#56/#57 staff-gates), T7 (firm-scope), AR (`loadFirmSecrets` merge), T8 (#58 storage-IDOR on `processQuestionnaireScan`), or #62. **The CI functions-deploy reports "success" even when most per-function updates 409-fail** (the 409s are warnings; the step still exits 0), so every "deployed green" claim for a shared-module change was partly false. Some functions win the concurrency race each run (the main generators were current → generation worked), others lose repeatedly. **Fixed:** swept all gen2 revisions, force-redeployed every stale function from current `main` in small batches via `firebase deploy --only functions:a,b,c,d,e` (5/batch stays under the ceiling). **Verified:** 0 stale functions remain except the 3 dormant `functions-backfill` jobs (separate codebase, console-only). [[project_new_callable_deploy_footguns]]

**🟠 FOLLOW-UP (recommended) — close the CI silent-409 gap.** The functions-deploy workflow must FAIL (or alert) when any per-function update 409s, instead of exiting 0. Until then, after any shared-module change, manually verify convergence (`gcloud run revisions` timestamp sweep) and small-batch redeploy stragglers. This is the same silent-failure class the GCP/CI alerts were built for — it just wasn't covered.

**▶️ Next — no open criticals. Remaining 🟠/🟡/⚪:** the CI silent-409 gap (above), App Check on `registerClientFromLink` (BM), truth-in-status remainder (CR/CU + open halves of CS/CW), medium cleanups (DK/DP/DQ/DR bulk-import, DM, DZ, H/T/V/AO). Ledger: `docs/AUDIT-findings.md`.

---

## 📍 SESSION CLOSE — 2026-06-29 (AR — firm API keys moved off the client-readable doc; DONE + migrated)

**✅ AR DONE (#59 + #60, deployed; elias-counsel migrated + verified).** Per-firm provider keys lived as top-level fields on `firms/{firmId}`, which `firestore.rules` lets any in-firm attorney/paralegal `read` via the client SDK → fetchable in any staff browser, XSS-exfiltratable. Firestore can't field-level-hide, and the browser must read the firm doc, so the secrets were moved out:
- **New Functions-only doc** `firms/{firmId}/secrets/apiKeys` (`allow read, write: if false`). Backend merges it onto firm data at ~13 load sites via `loadFirmSecrets()` (`functions/src/firm-secrets.ts`), so every reader (`firmData.openAiApiKey`, `getSendGridKey`, the 7 ai-client sites via callers, 9 email senders via `getFirmData`) is unchanged.
- **`updateFirmApiKeys`** callable (Zod, `manage_firm_settings`-gated) saves keys server-side + writes non-secret `{field}Set`/`{field}Last4` indicators on the firm doc for the masked Settings display. `SettingsPage` saves via it.
- **`migrateFirmApiKeysToSecrets`** (admin, idempotent) + self-hiding Settings banner moved elias-counsel's **9 keys** and deleted the raw copies. **Verified read-only:** 0 raw keys remain on the firm doc; secrets doc holds all 9; indicators set; `lawPayPublicKey` correctly kept (publishable, read in-browser by ChargePaymentDialog).
- Functions `tsc` + frontend `tsc`/build clean; eslint 0 errors; **629 tests** (added a rules test asserting `/secrets` client-denied).

**⚠️ Deploy saga (3 separate footguns hit — see [[project_new_callable_deploy_footguns]]):** (1) the CI functions deploy hit a **409 "unable to queue the operation" storm** — this PR changed shared modules imported by ~20 functions, exceeding the Cloud Functions v2 concurrent-op ceiling; `migrate` never created + several readers stayed on old code. Converged by deploying the stragglers in a **small batch** via `firebase deploy --only functions:a,b,...` (CI reruns are monotonic but slow). (2) New callables had **no `allUsers` run.invoker** (CORS on call) — root fix = declare `invoker:'public'` in the `onCall` options (not a manual gcloud grant); added in #60-followup. (3) Both callables OOM'd: I set `memory:'256MiB'`, overriding the global 512 floor → Node 22 cold-start OOM → generic `internal` 500. Fixed by omitting `memory` (#60).

**▶️ Next — no open criticals; remaining 🟠/🟡/⚪:** T9 (Zod length caps at callable boundaries + email recipient-resolution/HTML-escape residual from T6/BJ), App Check, truth-in-status remainder (CR/CU + open halves of CS/CW), medium cleanups (DK/DP/DQ/DR bulk-import, DM, DZ, H/T/V/AO). Ledger: `docs/AUDIT-findings.md`. **Recommended next: T9.**

---

## 📍 SESSION CLOSE — 2026-06-29 (T8 storage-path IDOR fixed + deployed)

**✅ T8 / BH DONE (#58 `5a628db`).** The three callables that download a caller-supplied storage path via the admin SDK — `bulkProcessKnowledgeFiles` (`bulk-knowledge-import.ts`), `processQuestionnaireScan` (`process-ocr.ts`), `transcribeAudio` (`transcribe-audio.ts`) — now validate the prefix themselves (`path.startsWith('firms/{firmId}/')` + reject `..`), matching the `processTemplateFile` template. The admin SDK bypasses Storage rules, so a staffer passing their own `firmId` (which passed the firm-claim check) plus a path into another firm's directory could read/OCR/transcribe a cross-tenant file. All four legitimate upload paths (audio, scans, knowledgeBase, templates) are already firm-scoped → no client change. Guard inlined per call site, NOT via `auth-guards.ts`, because `process-ocr`/`transcribe-audio` are **v1** callables where a v2 `HttpsError` gets swallowed → re-wrapped as generic `internal` (loses the `permission-denied` code). `tsc` clean; **627 tests pass**; functions deploy CI in progress (run `28384686930`).

**▶️ Next — remaining 🟠/🟡/⚪ (no open criticals).** AR (firm API keys readable in-browser — move off the client-readable firm doc), T9 (Zod length caps at callable boundaries + the email recipient-resolution/HTML-escape residual from T6/BJ), App Check. Then truth-in-status remainder (CR/CU + open halves of CS/CW), then medium cleanups (DK/DP/DQ/DR bulk-import, DM, DZ, H/T/V/AO backend leftovers). Never-Break gate applies to rules, templates, `types/index.ts`, indexes, CI. **Recommended next: AR (firm API keys in-browser) or T9 (Zod boundaries).** Ledger: `docs/AUDIT-findings.md`.

---

## 📍 SESSION CLOSE — 2026-06-29 PM (frontend audit Round 4 + reconciliation against shipped fixes)

Finished the audit-only sweep (Round 4 = frontend) and then **discovered this machine's local `main` had diverged from `origin/main` at `ce9a466`.** A **parallel Claude session** (`session_01KLDZSGMLWiv6...`) had been shipping audit fixes to the real `main` — **PRs #38, #40, #42, #43, #44, #45, #46** (now HEAD `5879857`). My audit ran against the stale `ce9a466` tree, so I integrated `origin/main`, then **re-verified every affected finding against current code** (3 verification subagents + diffstat). Full ledger + reconciliation: **`docs/AUDIT-findings.md`** → read the top **"⚖️ RECONCILIATION"** section first. Memory: [[project_codebase_audit]].

**The full 4-round audit is complete (~126 findings). Fixed + deployed: ~39; ~2 partial; rest open. 🎉 ALL 9 criticals fixed + deployed green (AF/BT/CH/E/DF + AP/AQ/AZ/BA #54 + BN #53), plus 🟠 AS #55. Zero open criticals; no PRs pending.** Remaining audit work is all 🟠/🟡/⚪.

**✅ FIXED this session (both merged + deployed green):**
- **AF** (PR #47, `1555d27`) — `sanitizeObject` no longer re-truncates the canonical `_serializedClientData` block at 5,000 chars (cap 100k; still injection-stripped). One edit in `ai-client.ts` fixed all 9 generators.
- **BT** (PR #50, `4a9f7a8`) — `process-ocr.ts` strips null/empty before the Firestore merge (`stripEmpty`), so a partial OCR scan can't null out existing client data; skips the write when nothing extracted.
- **CH** (PR #51, `fed4229`) — `QuestionnaireContext.performSave` now puts the primary `setDoc` inside the retry loop (+ defensive outer catch), so a failed autosave is retried and surfaced via `SET_ERROR` instead of rejecting silently while the UI shows "Saved." Deployed green.
- **E + A + AE + B** (PR #52, `8f8a5b6`) — doc-generation entry points now derive `success` from real status/counts (single: `status!=='error'`; batch: `errorCount===0`), make the post-gen client `.update()` best-effort, and re-throw `HttpsError` instead of flattening to `internal`. Deployed green.
- Regression tests added for AF/BT; **627 tests pass**; functions + hosting deploys all green.
- Also fixed the **hosting CI false-failure** (PRs #48 → #49): build-identical pushes were redding the deploy on Firebase's benign "is the current active version" 400; the workflow now treats only that case as success. Issues #39/#41 closed. The live frontend was current the whole time (verified).

**🔴 Criticals — ALL fixed + deployed green:**
- ✅ **AP / AQ / AZ / BA** (+ BB) — **#54:** `createFirmUser` admin/attorney-only with admin-only admin-minting; `updateUserCapabilities` admin-only; broken firm-scope predicate fixed in templates/KB reads.
- ✅ **BN** — **#53:** LawPay `reference` carries the payment doc id so `charge.completed` reconciles the pending doc (+ writes `lawPayTransactionId`).
- ✅ **AS** (🟠) — **#55:** paralegal dropped from `canManageFirmSettings`/`canManageBilling` (rules + hook).
- ✅ **AF** (#47), **BT** (#50), **CH** (#51), **E** (#52), **DF** (#40).

**Notable: the parallel session caught a real cross-tenant leak my Round 4 missed** — `useFirmBranding`'s global cache leaked one firm's branding incl. Maps API key to every other firm (fixed in #38). Good cross-check.

**✅ T6 FULLY DONE (#56 `124e75b` + #57 `a93b21e`, deployed green):** shared `auth-guards.ts` gating all staff-only callables (24 sites incl. the 6 email senders + testSendGridConnection in #57). `sendQuestionnaireCompleteNotification` intentionally un-gated (client-triggered on questionnaire submit — verified). Residual BJ hardening (server-resolve recipient + HTML-escape interpolated fields) reclassified to T9.

**▶️ Next — all criticals done + deployed; nothing pending review. Remaining 🟠/🟡/⚪:** T8 (storage-path IDOR in `bulkProcessKnowledgeFiles`/`processQuestionnaireScan` — caller-supplied storage path downloaded via admin SDK without prefix check), AR (firm API keys readable in-browser — move off the client-readable firm doc), T9 (Zod at boundaries + the email recipient-resolution/sanitization residual), App Check. Then truth-in-status remainder (CR/CU + open halves of CS/CW), then medium cleanups (DK/DP/DQ/DR bulk-import, DM, DZ, H/T/V/AO backend leftovers). Never-Break gate applies to rules, templates, `types/index.ts`, indexes, CI. **Recommended next: T8 (storage IDOR) — clear, self-contained, follows the `processTemplateFile` prefix-check template.**

> Process note: this machine's local branch was stale. **Always `git fetch` and check divergence at session start** before auditing or committing — the real work was happening on `origin/main` via PRs.

---

## 📍 SESSION CLOSE — 2026-06-23 PM (SendGrid unauthorized fix)

### 🔴 Open user actions

1. **Deploy functions** — run `firebase deploy --only functions` from the project root. The IAM `Service Account User` role was just added to `adam@adameliaslaw.com` on `estate-plan-generator@appspot.gserviceaccount.com`; wait ~2 minutes for propagation if the deploy still fails. This deploys the new `testSendGridConnection` function and the improved 401 error message.
2. **Rotate the SendGrid API key** — the key was shared in chat (potentially logged). Go to app.sendgrid.com/settings/api_keys, delete the current key, create a new one with **Mail Send** permission, and save it in Settings → Integrations. Then click **Test Connection** to confirm it's valid before sending the next questionnaire.

### ✅ 2026-06-23 PM — SendGrid unauthorized fix

- **Root cause:** SendGrid API key stored in Firestore was invalid/expired, causing 401 on all questionnaire sends.
- **Contributing bug fixed:** The "Test Connection" button in Settings → Integrations was fake — always showed success after 800ms without touching SendGrid. This hid the bad key.
- **New cloud function `testSendGridConnection`** (`functions/src/email-notifications.ts`): calls `GET https://api.sendgrid.com/v3/scopes` to validate the stored key. No email sent. Returns `failed-precondition` with actionable message on 401/403.
- **Improved 401/403 error** in `sendViaSendGrid`: now surfaces "SendGrid API key is invalid or lacks Mail Send permission. Please update it in Settings → Integrations." instead of raw HTTP status.
- **Frontend wired up** (`SettingsPage.tsx`): Test Connection button for SendGrid now calls the real function and shows error/success toast based on actual result.
- **tsc clean** on both `functions/` and root.

---

## 📍 SESSION CLOSE — 2026-06-16 (all green, all shipped; board clean + self-monitoring)

Started from the 6/15 carry-forwards; a deep health audit + two root-cause investigations closed everything and added permanent monitoring. All on `main` (HEAD `75bf900`), CI green (both functions + hosting deploys verified green post-merge), tree clean, no open issues.

**Shipped + verified this session:**
- **Health audit — clean.** Wider `gcloud logging` pull (past the calendar-cron noise) showed the 256MiB OOMs were all **pre-deploy stragglers** before the 03:00 UTC global-512 deploy; zero errors since. 512 floor holds.
- **Google Calendar OAuth — root-caused + fixed (corrects the 6/15 premise).** NOT secret rotation (secrets stable since 4/23). Project has no GCP org → OAuth app forced **External** → stuck in **"Testing"** status → Google expired the refresh token every ~1–2 wks. Adam published consent screen to **production** (status WAS Testing — confirmed) + reconnected; sync healthy. Verification banner correctly ignored. [[project_google_oauth_refresh_token_expiry]]
- **Storage CI auto-deploy — root-caused + fixed (PRs #34 revert → #35).** Storage was provisioned, but the deployer SA's `defaultBucket` GET returned **404 not 403** — it lacked **`firebase.projects.get`** (had only narrow `firebase*.admin` roles). Proven via SA impersonation. Granted **`roles/firebase.viewer`** (read-only); deploy run `27619432044` green with `storage.rules` released. [[project_ci_deploy]]
- **Silent-failure monitoring stood up** (the session's theme — every prior outage was invisible except in `functions:log`):
  - **GCP log-based alerts** → email `adam@adameliaslaw.com` (verified channel): Function OOM, Function boot failure, syncGoogleCalendar invalid_grant. [[project_gcp_alerting]]
  - **GitHub CI-failure notifications** (PR #37): both deploy workflows open an **issue assigned to @adameliaslaw** on any failed step — closes the 4-day-outage gap (AI-Bot-authored commits meant GitHub's failure email never reached Adam).

🟢 **No blocking carry-forwards.** Standing watch-items (passive, no action unless they fire):
1. **OAuth durability** — if no `invalid_grant` alert email by ~6/30, the production fix is confirmed permanent. Silence = healthy. If it DOES fire, reinvestigate (token superseded / account revoke), don't just reconnect.
2. **Boot-failure alert noise** — watch for deploy-time-transient false positives; disable that one policy if it cries wolf.
3. **`backfillClientEmailLowercase`** 512 bump still rides the next backfill deploy (dormant console-only tool; unchanged from 6/15).

---

## 🔔 AUTOMATIC ALERTS — silent-failure monitoring (set up 2026-06-16)

This project's recurring weakness was **silent failures found late** (Calendar down 5+ wks, CI broken 4 days, OOM loops — all only in `functions:log`, never the UI). Now auto-paged via GCP log-based alert policies → email `adam@adameliaslaw.com` (verified channel `10320474330459174565`), each rate-limited 1/day:
- `12830096979394786379` — **Function OOM** (memory limit exceeded; the 256MiB/Node-22 class).
- `5934839025673898700` — **Function boot failure** (readiness/STARTUP probe; the "internal/CORS" masquerade). *Watch for deploy-time-transient noise; disable if it cries wolf.*
- `15160115989436873871` — **syncGoogleCalendar invalid_grant** (OAuth — see below).

No email = healthy. Manage at console.cloud.google.com/monitoring/alerting. Full detail + how to add more: [[project_gcp_alerting]].

**CI deploy failures — now covered too (PR #37, merged).** Both deploy workflows open a GitHub **issue assigned to @adameliaslaw** on any failed step (lint/test/build/deploy), appending to the existing open issue rather than duplicating. Closes the gap behind the 4-day June outage (commits authored by "AI Bot" → GitHub's default failure email never reached Adam). No new secret (built-in `GITHUB_TOKEN` + `permissions: issues:write`); verified both deploys still go green post-merge. Between the GCP alerts (OOM/boot/OAuth → email) and this (CI failures → assigned issue), every silent-failure class that's bitten this project is now auto-surfaced.

## 🔔 AUTOMATIC ALERT — Google OAuth durability (no manual review needed)

**A GCP log-based alert now watches for the recurring failure automatically** — replaces the manual 2026-06-30 poll (catches it whenever it happens, not just one date; no credentials stored anywhere).
- **Alert policy:** `projects/estate-plan-generator/alertPolicies/15160115989436873871` ("syncGoogleCalendar invalid_grant — Google OAuth token died"). Condition = any new log matching `resource.type="cloud_run_revision" AND resource.labels.service_name="syncgooglecalendar" AND textPayload:"invalid_grant"`; rate-limited 1/day.
- **Notification channel:** email → `adam@adameliaslaw.com` (channel `10320474330459174565`, **VERIFIED** 2026-06-16).
- **If the alert fires:** the token died again. Root cause was an External OAuth app in "Testing" status (fixed by publishing to production 6/16). A fresh failure despite production status means a DIFFERENT cause (token superseded by re-auth / account-level revocation) — **reinvestigate, do NOT just reconnect** (the band-aid this investigation replaced). See [[project_google_oauth_refresh_token_expiry]].
- **If no alert by ~2026-06-30** (past the ~14-day window where it died before): fix confirmed permanent; can close the OAuth item. No action otherwise — silence = healthy.

---

## 📍 SESSION — 2026-06-16 (health audit clean + Google OAuth churn root-caused)

Picked up from HOMEWORK. Health check + the two open Google/Storage carry-forwards. No code shipped (findings + one memory). Tree clean, `main` at `289025e`.

**✅ Deep health audit — CLEAN.** Default `firebase functions:log` is dominated by the 5-min calendar cron and hides everything else, so pulled a wider `gcloud logging read severity>=ERROR` window. Initially looked alarming — ~13 functions OOMing at 256MiB on 6/15 23:xx–6/16 00:26 (incl. `exchangeGoogleAuthCode`, which 6/15 claimed was bumped to 512). **But it's NOT a contradiction:** every function got rebuilt to 512Mi in one comprehensive global-default deploy at **2026-06-16T03:00:24Z** (gen 38/39). All the OOM errors predate 03:00 — they're stale stragglers from last session's incremental whack-a-mole before the global `setGlobalOptions(512MiB)` fully propagated. **Zero errors of ANY kind after the 03:00 deploy** (~9h clean). Last session's conclusion holds; the 512 floor is genuinely effective.

**✅ Google Calendar OAuth churn — ROOT-CAUSED (corrects the 6/15 premise).** Item #3 was "investigate WHY the OAuth client/secrets keep rotating." **They don't rotate** — `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are stable on **version 5 since 2026-04-23** (~2 months, across all 3 breakages). The premise was wrong. Real cause: the firm's **refresh token keeps dying** (`"Token has been expired or revoked"`). The GCP project belongs to **no organization** (`gcloud projects describe` → empty `parent`), so the OAuth consent screen User type **cannot be Internal** → it's **External**. An External app with a **sensitive scope** (Calendar) left in **"Testing" publishing status** has refresh tokens **periodically expired by Google** (~7-day window). Every reconnect was a band-aid. **Permanent fix (Adam, console): OAuth consent screen → Publish App (Testing → In production), then reconnect once.** Confidence 7/10; weak point = current publishing status (Testing vs Prod) can't be read via CLI (IAP oauth-brands API deprecated + needs an org), and observed gap was ~14d vs documented ~7d. Saved [[project_google_oauth_refresh_token_expiry]].

**✅ #1 DONE (same session).** Adam published the consent screen to production — status WAS "Testing," confirming the diagnosis — and reconnected Calendar. Sync verified healthy (no `invalid_grant`, syncs completing every 5 min). Google then showed "Your app requires verification" → **intentionally ignored.** Verification is a separate axis from publishing status; "In production" alone removes the 7-day expiry. Don't submit for review (single-user internal app; Calendar=sensitive scope + Drive can be restricted → heavyweight review for zero benefit). **Durability watch: if Calendar survives past ~6/30 with no `invalid_grant`, the Production fix is confirmed permanent. If it dies AGAIN despite Production, the cause is different (token superseded / account-level revoke) — reinvestigate, don't just reconnect.** Console owner = `adamelias66@gmail.com` (project owned by personal Gmail, not the Workspace domain — root of the no-org/External situation).

**✅ #2 DONE — Storage provisioned AND CI auto-deploy of storage.rules restored (root-caused).** Adam provisioned Firebase Storage (defaultBucket registered; resolves HTTP 200; live rules byte-identical to repo `storage.rules`).
- First re-add to CI (PR #34, `2a15861`) FAILED (run `27618316599`): under the deployer SA it errored `"Firebase Storage has not been set up"` and aborted the whole deploy → **reverted** (`957bb60`) to keep main green.
- **Root cause (proven via SA impersonation, NOT guessed):** the SA's `defaultBucket` GET returned **404, not 403** (owner got 200 on the identical call; quota header irrelevant — purely identity). It was NOT a storage-permission gap — the SA already had `firebasestorage.admin` incl. `defaultBucket.get`. The SA had only the four narrow `firebase*.admin` roles and **lacked `firebase.projects.get`** (no general `firebase.viewer`/`admin`); firebasestorage needs that project read to resolve the defaultBucket singleton, so it 404'd for the SA but not an owner. To impersonate I temporarily self-granted `iam.serviceAccountTokenCreator` on the SA, then **revoked it** after testing.
- **Fix:** granted the deployer SA **`roles/firebase.viewer`** (read-only) — impersonation-verified the GET flips 404→200 — then re-added `storage` (PR #35, merged). **Deploy run `27619432044` GREEN**, CI log confirms `released rules storage.rules to firebase.storage` + firestore + functions. storage.rules now auto-deploys in CI. See [[project_ci_deploy]].

**Net 2026-06-16 — BOTH 6/15 carry-forwards CLOSED:** #1 Calendar OAuth fixed at the root (published to production; durability-watch until ~6/30). #2 Storage provisioned + CI auto-deploy of storage.rules restored. Only standing watch-item: OAuth durability (~6/30).

---

## 📍 SESSION CLOSE — 2026-06-15 (all green, all pushed)

Began as a one-line verification of the 6/02 KB-embedding OOM fix; cascaded into several real root-cause fixes. All commits on `main` (HEAD `81e2ff9`), CI green, working tree clean. Full detail in the session block below.

**Shipped + verified this session:**
- **KB embedding** — root cause was a `chunkText` infinite loop (not memory), fixed (`8bdf4eb`). Re-embedded the whole KB to one model: **151/151 active resources on `text-embedding-005`** (was 34% retrievable). Added `concurrency:1` to embedding triggers.
- **CI functions-deploy** — broken since 6/11 (storage target + missing rules IAM); fixed by dropping `storage` from the CI command (`a165225`) + granting the deployer SA `firebaserules.admin` + `firebasestorage.admin`. #32's security changes finally deployed.
- **Node 22 256MiB cold-start OOMs** — fixed project-wide with a **512MiB global default** (`setGlobalOptions` in `global-options.ts`); zero functions remain at 256MiB.
- **`Missing VITE_GOOGLE_CLIENT_ID`** — CI hosting build never injected it; added (`afc0e29`). Permanent.
- **Google Calendar** — `exchangeGoogleAuthCode` OOM (masquerading as CORS) bumped to 512; Adam reconnected; **sync verified live (56 events).**

🔴 **Carry-forward for next session (none blocking):**
1. **Firebase Storage provisioning** — Adam's console click (Storage → Get Started). Then re-add `storage` to `firebase-hosting`/`functions` deploy command so storage.rules auto-deploys again. Bucket exists + app works; only rules auto-deploy is affected.
2. **`backfillClientEmailLowercase`** bumped to 512 in code but lives in the `functions-backfill` codebase (not in the main workflow `paths:`) — goes live on the next backfill deploy. Dormant console-only tool; no urgency.
3. **Google auth churn** — Calendar/Sign-In OAuth has now broken 3× the same way (5/27, 6/01, 6/15: stale refresh token / rotated client). If it recurs, investigate WHY the OAuth client/secrets keep rotating (secrets are on v5) instead of just reconnecting.

---

## 📍 SESSION — 2026-06-15 (KB embedding fully fixed + 4-day CI-deploy outage fixed)

Started as a one-line verification of the 6/02 OOM fix; the drain check uncovered a much deeper problem. All shipped to `main`, CI green, verified live. **KB embedding is now fully healthy: 151/151 active resources embedded, 100% `text-embedding-005`, 0 unembedded.**

**ROOT CAUSE (the real bug) — `chunkText` infinite loop (`8bdf4eb`).** `functions/src/kb-embeddings.ts` `chunkText` had a termination bug: the guard `if (start >= text.length) break` can never fire (end is capped at `text.length`, so `start = end - overlap` is always ≤ `length - overlap`). On the final segment it re-set `start` to the same value every pass and pushed the same tail chunk **forever** → unbounded array → heap OOM that **scaled to fill any memory limit** (2GiB→2.3GB, 4GiB→4.5GB both died). Only docs > 12000 chars hit the chunked path, and the embed error is caught non-fatally — so large KB resources/templates **silently never embedded**. Reproduced locally (identical heap OOM) to prove it was logic, not Cloud Run memory. Fix = `break` when a chunk reaches `text.length` (matches the already-correct `functions-backfill` copy, which has both this guard and a `MAX_CHUNKS=200` cap). The 6/02 "2GiB OOM loop" fix treated a symptom; this is the disease.

**3-model embedding contamination — fixed.** Of 151 active KB docs, only **51** were on the canonical query model (`text-embedding-005`, 768-dim, used by `kb-vector-search`). The rest were retrieval-dead: **34** on OpenAI `text-embedding-3-small` (**1536-dim** → invisible to a 768-dim `findNearest`), **18** on `gemini-embedding-001` (768-dim but wrong vector space → mis-ranked), **48** unembedded. So RAG saw only **34%** of the KB. Re-embedded all 100 non-canonical docs by clearing `embeddedAt`/`embeddingModel` to re-fire the production trigger → now uniformly `text-embedding-005`.

**`concurrency:1` on both embedding triggers (`83e3c2a`).** Default gen2 concurrency (80/instance) let a write burst (bulk import / this backfill) stack embeds and exceed 2GiB. Serialize per instance; Cloud Run scales horizontally. (Memory briefly bumped 2→4GiB in `9e5a479` as a stop-gap, then reverted to 2GiB in `8bdf4eb` once the loop — the true cause — was fixed.)

**CI functions-deploy was BROKEN since 2026-06-11 (4 days) — fixed.** PR #31 added `storage` to `firebase deploy --only functions,firestore:rules,storage`; the deployer SA `github-action-1189038360` had **no storage and no firebaserules permissions**, and any one target failing aborts the **whole** deploy. So #32's function changes (**Zod validation + staff-role auth checks on transcribe/OCR**) never reached prod either. Fixes:
- Granted deployer SA **`roles/firebasestorage.admin`** + **`roles/firebaserules.admin`** (both reversible; same least-privilege pattern as the original CI bootstrap).
- Dropped `storage` from the CI deploy command (`a165225`) — Firebase Storage's `defaultBucket` resource isn't registered for this project (see open item), so the storage target can't deploy rules regardless of IAM. `firestore:rules` stays in CI (the IAM grant fixed it).

🔴 **Open follow-ups (none blocking):**
- **Firebase Storage not provisioned.** The GCS bucket `estate-plan-generator.firebasestorage.app` exists and the app uses it, but `firebase deploy --only storage` errors "Firebase Storage has not been set up" (defaultBucket resource unregistered). `storage.rules` is therefore **manual-deploy only** and currently NOT auto-deployed. To restore CI auto-deploy of storage rules: provision Storage (Firebase console → Storage → Get Started, or `firebase init storage`), then re-add `storage` to the workflow deploy command. Storage rules are already live and change rarely, so low priority.
- ✅ **Stale footgun deleted (2026-06-15).** `functions/scripts/embed-unembedded-kb.cjs` embedded with `gemini-embedding-001` (the wrong model — it's what put 18 docs in the wrong vector space); re-running it re-contaminated the KB. The production trigger now handles all embedding correctly, so it was obsolete. Removed. (`functions-backfill` remains the correct path for any future bulk backfill.)
- **`functions-backfill/src/kb-embeddings.ts`** has the correct `chunkText` (capped + forward-progress guard) — no change needed, noted for awareness that the two copies had diverged.

### Health sweep (same session) — two more live issues caught

**256MiB cold-start OOMs from the Node 22 bump — fully fixed via a 512MiB global default (`5da585b`, `0d62ee9`, `985f2e3`, `9897e6c`).** `firebase functions:log` showed functions OOMing on cold start, barely over (256 → 257/278 MiB used). PR #33's Node 20→22 bump raised the memory baseline enough to push the whole 256 tier over on cold start; the instance fails its readiness check before responding → surfaces as a generic **CORS / `FirebaseError: internal`** (e.g. `exchangeGoogleAuthCode` threw a fake "CORS policy" error that was really an OOM, blocking the Google OAuth reconnect). Progression this session: bumped 7 observed, then `exchangeGoogleAuthCode` (8th), then — rather than whack-a-mole — set a **project-wide `setGlobalOptions({ memory: '512MiB' })`** (`functions/src/global-options.ts`, imported FIRST in `index.ts`) + replaced the 10 remaining explicit `256MiB`. **Verified: zero us-east1 functions remain at 256MiB**; functions with explicit higher memory (generators/embedding triggers) kept their values; new functions inherit the 512 floor automatically. Lone exception: `backfillClientEmailLowercase` in the isolated `functions-backfill` codebase (bumped in code, but that codebase isn't in the main workflow's `paths:` — goes live on the next backfill deploy; it's a dormant console-only migration tool, zero user-facing risk). See [[project_function_oom_256mib]].

🔴 **Google Calendar sync DOWN — needs Adam (recurring).** `syncGoogleCalendar` throwing `invalid_grant` every 5 min for elias-counsel ("authorisation revoked — reconnect via Settings → Integrations → Google Calendar"). Same failure as the 2026-06-01 fix; the firm's stored refresh token is invalid again. **User action:** Settings → Integrations → Google Calendar → reconnect. `GOOGLE_CLIENT_ID`/`SECRET` are on version 5 now, so something rotated them — if it keeps recurring after reconnect, investigate OAuth-client churn (same root-cause pattern as the 2026-06-01 and 2026-05-27 Google auth breakages).

**✅ `Missing VITE_GOOGLE_CLIENT_ID` — ROOT-CAUSE fixed (`afc0e29`).** When Adam went to reconnect Calendar, Settings → Integrations showed "Missing VITE_GOOGLE_CLIENT_ID" (also blocks the Drive card). **The recurring root cause:** the **hosting** CI workflow's build step (`firebase-hosting-deploy.yml`) injected `VITE_FIREBASE_*` but **omitted `VITE_GOOGLE_CLIENT_ID`**, so every CI hosting deploy baked an empty client ID into the bundle. The 2026-06-01 "fix" was a manual `npm run build` off the local `.env` (which has the value) — a band-aid that any subsequent CI deploy silently undid. Permanent fix: added `VITE_GOOGLE_CLIENT_ID: 749324460027-donln8vkprbol5uk7hhui19fbnc7ff7j.apps.googleusercontent.com` (public OAuth client ID, matches backend `GOOGLE_CLIENT_ID` secret v5) to the workflow's build env. Verified live: the deployed `SettingsPage-*.js` chunk now contains the client ID. **Adam must hard-refresh (Ctrl+Shift+R) then reconnect Calendar — this unblocks the reconnect that clears the `invalid_grant` above.** (The client ID is a lazy route chunk, not `index.js` — grep `SettingsPage-*.js`, not the main bundle, when verifying.)

---

## 📍 SESSION — 2026-06-02 (health-check fix: KB embedding OOM loop)

Session-start `firebase functions:log` health check caught a live OOM loop the UI never surfaces: **`onKnowledgeResourceWritten`** (KB re-vectorization trigger) was configured at `1GiB` but peaks **1107–1153 MiB** during embedding → container killed on signal 9 **before** writing `embeddedAt`, so the resource stayed unembedded and got reprocessed indefinitely (loop visible at 17:02 / 17:09 / 17:19…).

**Fix (`5c28c07`, pushed to `main`, CI auto-deploying):** bumped trigger memory `1GiB → 2GiB` in `functions/src/kb-embeddings.ts:234`, matching its sibling `onTemplateWritten` (same embedding workload, same file, already at 2GiB). One-line change; functions `tsc --noEmit` clean.

✅ **VERIFIED 2026-06-15.** Deployed revision `onknowledgeresourcewritten-00033-dax` confirmed running at **2Gi** (deployed 2026-06-03 01:35 UTC, right after the fix push). No OOM / signal-9 / reprocessing lines in recent `functions:log` — the every-~7-10-min loop activity is gone. Item closed.

---

## 📍 SESSION CLOSE — 2026-06-02 (everything below verified green + live)

All shipped to `main`, CI green, and verified in the live app. No open blockers from this session.

**Secret cleanup + incident (recovered):** Destroyed `FIRECRAWL_API_KEY` cleanly. Destroying `MERCURY`/`PAGEINDEX`/`VERTEX_AI` broke 7 functions on cold start — **firebase deploy never strips a secret dropped from code**, so deployed revisions still bound them. Recovered by recreating the secrets + granting runtime-SA accessor (and rebuilding PAGEINDEX to version 7 for chatAi's pin); all 7 verified booting. Those 3 remain **inert placeholders — do NOT destroy** (see [[project_firebase_secret_binding_not_removed]] / incident block below). `firestore:rules` deployed (dropped dead pageindex_docs block).

**Stale validation findings (`0e2d079`):** `saveDocumentToVault` now clears `validationFindings`/`warnings` on a clean regen (was leaving ghosts via `update()`). Cleared Karen's stale flag.

**Models:** Background tasks `gpt-4o-mini` → **`gpt-5.4-nano`** (`b9c4404`, verified live). Primary drafting model corrected — it's the per-firm `documentDraftingModel` field (was **claude-opus-4-6**, NOT the gpt-5.4 fallback), bumped to **`claude-opus-4-8`** (`dd76a73` allowlist+pricing; field set; verified via clean generation). See [[project_primary_drafting_model]].

**CI (`ee09e61`):** workflow actions bumped off deprecated Node 20 — checkout@v6, setup-node@v6, auth@v3 (both workflows). Deploys verified green on new versions.

**Research mode — fully fixed + verified in UI:**
- Added **CourtListener API key field** to Settings → Integrations (`544b52a`) — it never existed, so the key was empty and case law returned 0. Adam added the key; case law now flows.
- Perplexity hard-restricted to a **primary-law domain allowlist** (`c0a5d54`, tightened to `law.justia.com` in `5185525`) — no more law-firm marketing.
- **CitationBlock** now renders case-law citations (was counting-but-hiding them) (`5185525`); reverted a citation reorder that misaligned the answer's `[N]` markers (`1ac0e77`).

**`.env.example`:** corrected OpenAI-key reality (per-firm Firestore; unbound Secret Manager secret) + dead `VERTEX_AI_KEY` declaration removed.

🔴 **Carry-forward (optional, none blocking):**
- Research web results are now strict primary-law only — niche queries may get sparse web citations; widen the allowlist in `callPerplexityWithCitations` (`ai-client.ts`) if needed.
- Off-topic-but-authoritative sources (e.g. an njcourts.gov contracts jury charge on an estate query) can still appear — domain filtering controls authority, not relevance. One-off; no fix applied.

---

## ✅ API/LLM CONSOLIDATION — COMPLETE (2026-06-01). See the "COMPLETE" summary below for the manual cleanup queue.

**To resume:** start a fresh session and say **"Resume with HOMEWORK.md"**. The consolidation is finished; the only open items are the 5 manual `firebase`/`gcloud` steps in the **API/LLM CONSOLIDATION — COMPLETE** block below. After those, the next real work is the **template-options** thread (further down) or the **optional follow-ups** (AssemblyAI→Whisper, `.env.example` drift).

**Context:** Evaluated whether the tool still needs all its APIs/LLMs now that document generation defaults to **Template** (no LLM) and AI-from-scratch is removed. Verdict: core functionality needs only **Vertex embeddings + Anthropic + OpenAI (fallback)**; the rest is secondary or dead.

**Adam's feature-usage answers (drove the cuts):** USES Research chat (Perplexity + CourtListener) and Audio transcription. Does NOT use client-file chat (PageIndex). → Keep: Vertex embeddings, Anthropic, OpenAI (+content-filter fallback), Perplexity, CourtListener, transcription, SendGrid, LawPay, Google. Cut: Firecrawl, Fastcase, Mercury, PageIndex.

**✅ Firecrawl** removed entirely last session (commit `ee3d0cc`). **✅ Fastcase / Mercury / PageIndex** all removed this session — see the three numbered sections below for details.

**The three cuts (all DONE — commit + verify + push each, CI auto-deploys):**

### 1. ✅ Fastcase — DONE (commit `d1cf32d`, pushed to main, CI deploying)
- Removed `searchFastcase` + the fastcase branch in `searchCaseLaw` (`courtlistener-client.ts`), the `'fastcase'` member of `CaseLawResult.source`, the `fastcaseKey` read + call-site param in `chat-ai.ts`, and the `.env.example` Fastcase block. Repo-wide grep confirmed **no** frontend/settings-UI/type references existed (homework's "per-firm settings UI" guess was moot). CourtListener untouched. functions `tsc --noEmit` + root `npm run build` both clean.
- 🔴 Manual verify still open: confirm research chat (CourtListener path) still answers end-to-end in the live UI.

### 2. ✅ Mercury — DONE (commit `ca2570d`, pushed to main, CI deploying)
- Removed from `ai-client.ts`: `_callMercury`, the `provider === 'mercury'` dispatch, the `m.startsWith('mercury')` detection, and the `mercury` entries in `KNOWN_MODELS` + `DEFAULT_MODELS`. Anthropic/OpenAI/Vertex fallback chain untouched.
- Re-routed all **5** hard-coded `model:'mercury-2'` call sites → **`gpt-4o-mini`** (cheap, OpenAI allowlist; firm already has an OpenAI key — Whisper transcription uses it): `transcribe-audio.ts` (summarizeTranscription), `knowledge-base.ts` (analyzeKnowledgeContent), `bulk-knowledge-import.ts` (enrichResourceWithAI), `ai-memory.ts` (×2 — fact + correction extraction).
- **`analyzeKnowledgeContent` snag fixed:** it had passed empty `firmData` and depended entirely on the `MERCURY_API_KEY` secret in `process.env`. Now loads the firm doc (firmId from `request.auth.token.firmId`, mirroring `bulkProcessKnowledgeFiles`) so `callAI` reaches the firm's OpenAI key. (Gemini was NOT viable for the `{}` sites — `_callGemini` has no `process.env` fallback.)
- Dropped `MERCURY_API_KEY` from every `secrets:[...]` array (`transcribe-audio`, `knowledge-base`, `bulk-knowledge-import`, `chat-ai` — the last no longer calls Mercury at all), the `.env.example` Mercury block, and the CI workflow comment.
- 🔴 **GCP secret still to destroy:** `firebase functions:secrets:destroy MERCURY_API_KEY` (no code consumers left). Manual.
- 🔴 Manual verify still open: confirm KB tagging / transcription summary / KB-import enrichment still run on `gpt-4o-mini` post-deploy.

### 3. ✅ PageIndex — DONE (commit `bc56ed5`, pushed to main, CI deploying)
- **Key discovery that corrected the plan:** the `/chat` "Research Chat" page was **100% PageIndex** — its main gray bubble = `ragChat` (0-doc namespaces) and its emerald bubble = client-files. It had **no** Perplexity bubble. The Perplexity research mode Adam uses lives in the **floating AI widget** (`GlobalAiWidget.tsx` → `chatAi` callable, `mode:'research'`) — that's "the Research bubble" the homework meant to keep, and it's preserved (Perplexity + CourtListener intact). Also found `DraftTab.tsx` (Client Dashboard tab, not in the homework) rode `ragChat` draft mode → PageIndex.
- **Adam's call: retire both `/chat` + the Draft tab fully** (the AI widget already covers research + draft).
- Backend deleted: `pageindex-retrieval.ts`, `pageindex-client-files-chat.ts`, `rag-chat.ts`, `ingest-document.ts`, `backfill-pageindex-firmid.ts` + their `index.ts` exports. `chat-ai.ts` research mode stripped of PageIndex (kept Perplexity+CourtListener, dropped `PAGEINDEX_API_KEY` secret + `pageIndexSources` field). `wills-processor.ts` PageIndex upload step + `_uploadToPageIndex` + secret removed; wills pipeline otherwise unchanged (docs finish at status `extracted`; inert `pageindex_doc_id/namespace` record fields kept to avoid a 15-site ripple).
- Frontend deleted: `ChatPage.tsx` + `/chat` route + sidebar "Research Chat" link + `ROUTES.CHAT`; `DraftTab.tsx` + its tab trigger/content; `rag-chat-service.ts`, `ingest-service.ts`, `UploadDocumentModal.tsx`.
- Config: removed pageindex_docs `firestore.rules` block, `PAGEINDEX_API_KEY` from `.env.example` + CI comment, and `scripts/ingest` + `scripts/seed-pageindex` tooling.
- Verified: functions `tsc --noEmit` clean, root `npm run build` clean, **613/613 tests pass**.
- 🔴 **Two manual steps remain:**
  - **Manual rules deploy:** `firebase deploy --only firestore:rules` (rules deploy is NOT in CI — the pageindex_docs block is removed from the file but still live in prod until you deploy; harmless meanwhile since the collection is gone).
  - **Destroy GCP secret:** `firebase functions:secrets:destroy PAGEINDEX_API_KEY` (no code consumers left).
- 🔴 Manual verify: confirm the AI widget's Research mode still answers end-to-end post-deploy.

---

## ✅ API/LLM CONSOLIDATION — COMPLETE (all 3 cuts shipped)

Fastcase (`d1cf32d`) + Mercury (`ca2570d`) + PageIndex (`bc56ed5`) all on `main`, CI auto-deploying. **Kept:** Vertex embeddings, Anthropic, OpenAI (+content-filter fallback), Perplexity, CourtListener, transcription (Whisper/AssemblyAI), SendGrid, LawPay, Google. **Cut:** Firecrawl, Fastcase, Mercury, PageIndex.

### ⚠️ SECRET-DESTROY INCIDENT + RECOVERY (2026-06-02) — READ BEFORE TOUCHING SECRETS

Attempted the secret-destroy cleanup below. **Only `FIRECRAWL_API_KEY` destroyed cleanly** (genuinely no consumers). Destroying `MERCURY_API_KEY`, `PAGEINDEX_API_KEY`, and `VERTEX_AI_KEY` **broke 7 functions** on cold start (generateDocuments, generateSingleDocument, generateEstateDocument, bulkProcessKnowledgeFiles, analyzeKnowledgeContent, summarizeTranscription, chatAi).

**Root cause — the critical finding:** `firebase deploy` ADDS/updates secret bindings but **NEVER removes** a secret binding you delete from code. Every "successful" CI deploy (Mercury `ca2570d`, PageIndex `bc56ed5`, Vertex `3fe6a45`) left the dead `secrets:[]` bindings live on the deployed revisions. So the secrets were still mounted by running functions even though no code reads them — destroying the Secret Manager values made instance startup abort ("Secret Version … is in DESTROYED state" / "permission denied").

**Recovery performed (all functions verified booting via cold-start curl → clean JSON 401):**
- Recreated `VERTEX_AI_KEY` + `MERCURY_API_KEY` (placeholder values) and **manually granted `roles/secretmanager.secretAccessor`** to the runtime SAs `estate-plan-generator@appspot…` + `749324460027-compute@developer…` (firebase's `secrets:set` did NOT grant IAM — it deferred to "please deploy"). Gen2 functions mount these via a legacy Cloud Run alias annotation (`secret-…:projects/…/secrets/VERTEX_AI_KEY`); gen1 by literal name+version 1.
- `PAGEINDEX_API_KEY`: chatAi pinned version **7** (which got destroyed). Can't un-destroy a version, and `firebase deploy` re-pins 7 (won't bump), so it kept failing. Fixed by **deleting + recreating the secret and adding 7 placeholder versions** so version 7 resolves again, + IAM grants. chatAi boots.

**Net state:** all functions healthy. `FIRECRAWL_API_KEY` gone. `VERTEX_AI_KEY`/`MERCURY_API_KEY`/`PAGEINDEX_API_KEY` exist as **inert placeholders** — bound to functions but unread by any current code (zero functional impact).

🔴 **To ACTUALLY destroy these 3 secrets (DON'T just re-run destroy — it will re-break the same 7 functions):** the deployed revisions must first stop binding them. firebase won't remove the bindings; options are (a) `gcloud run services update <svc> --remove-secrets=KEY` for the gen2 ones — currently **crashes** on the legacy alias annotation (`Invalid secret path … in annotation`), so the annotation must be cleaned first via `gcloud run services replace` with edited YAML; (b) recreate the gen1 functions cleanly. This is non-trivial surgery — leaving the inert placeholders is the low-risk default. See [[project_firebase_secret_binding_not_removed]].

#### Original destroy queue (superseded by the incident block above)
1. ✅ `firebase functions:secrets:destroy FIRECRAWL_API_KEY` — DONE (no consumers, clean).
2. ⚠️ `MERCURY_API_KEY` — do NOT destroy (bound to 3 live functions; see above).
3. ⚠️ `PAGEINDEX_API_KEY` — do NOT destroy (bound to chatAi; see above).
4. ⚠️ `VERTEX_AI_KEY` — do NOT destroy (bound to 3 live functions; the code declaration was removed in `3fe6a45` but the DEPLOYED revisions still bind it — firebase didn't strip it).
5. ✅ DONE (2026-06-02): `firebase deploy --only firestore:rules` — compiled + released; the dead `pageindex_docs` block is gone from live rules. Verified diff was that block only (no other rule changes since the Carmela deploy).
6. ✅ Generation smoke-test DONE (2026-06-02): generated + reviewed Karen's POA in **Exact Fidelity (template)** and her Will in **Enhanced (Hybrid)** — both clean (Hybrid exercises the AI client + KB/Vertex path, confirming full recovery from the secret incident). 🟡 Remaining optional functional checks (research chat/CourtListener, AI-widget/Perplexity, KB tagging/transcription) use keys the incident never touched — low priority.

### ✅ 2026-06-02 PM session close (per Adam)
- **Karen data gaps — DONE (per Adam).** Will/POA `[MISSING]` markers (trustee, Roger Kondos's alternate-agent address, successor executors, funeral wishes) resolved.
- **Lucas Polo regen + iPhone deploy unlock (1b/1c) — DONE (per Adam).**
- **Stale-findings bug — FIXED + DEPLOYED (`0e2d079`, CI green).** `saveDocumentToVault` now clears `validationFindings`/`warnings` on a clean regen instead of letting `update()` preserve stale flags. Cleared the one stale flag on Karen's POA too.
- **Model audit (2026-06-02, corrected):** ⚠️ The PRIMARY document-drafting model is **`claude-opus-4-6`** (Claude Opus 4.6, Anthropic) — set on `firms/elias-counsel.documentDraftingModel`, read by all 9 generators as `safeFirm.documentDraftingModel || 'gpt-5.4'`. The `gpt-5.4` is only the **unused fallback** (an earlier note here wrongly called gpt-5.4 the primary). Latest Opus is `claude-opus-4-8` (4.8) — NOT in `KNOWN_MODELS` (allowlist has `claude-opus-4-6`/`claude-4-opus`) and not in cost-estimator; bumping the primary 4.6→4.8 would need both added + a generation smoke test. **Open decision for Adam — not done.** (Briefly mis-set documentDraftingModel to `gpt-5.5` on the wrong premise, then reverted to `claude-opus-4-6`.)
  - **Background tasks ✅ DONE + verified:** 5 sites moved `gpt-4o-mini` → `gpt-5.4-nano` (`b9c4404`, CI green, confirmed live via analyzeKnowledgeContent logs). These are genuine OpenAI calls; the nano upgrade stands.

### Optional follow-ups
- **❌ AssemblyAI → Whisper — DO NOT REMOVE (verified 2026-06-02).** The removal was predicated on AssemblyAI being redundant + the firm defaulting to Whisper. Both are false: (1) read-only Firestore check shows `elias-counsel` is **actively set to `transcriptionProvider: 'assemblyai'`** with a key present — it's the live provider, removing it breaks/downgrades transcription; (2) AssemblyAI is **not** redundant — it provides speaker diarization, entity extraction, speaker count, and confidence (`transcribe-audio.ts:202-219`) that Whisper doesn't. Keep AssemblyAI unless Adam explicitly switches the firm to Whisper first.
- **✅ `.env.example` drift — DONE (2026-06-02, commits `30ca62a` + `3fe6a45`).** Added `ASSEMBLYAI_API_KEY`; documented Perplexity + Gemini as per-firm Firestore keys (not env secrets, like CourtListener); documented Vertex embeddings as ADC-authenticated. Discovered `VERTEX_AI_KEY` was **declared-but-unread** on the 3 generate functions → removed the dead `secrets:[]` declaration. The Secret Manager value `VERTEX_AI_KEY` can now be destroyed (no consumers) — added to the manual queue below.

---

## ✅ (CLOSED 2026-06-02) earlier resume pointer — "template options" thread

**Closed per Adam's call (2026-06-02).** This was the resume pointer at the *start* of the prior session, but that session pivoted entirely into the API/LLM consolidation (which shipped). The template-options question was never actioned and no code was written for it. Adam is not actively adding a new document right now, so the thread is closed — not a pending blocker.

**Reference (if it ever comes back up):** adding a template **VARIANT** of an existing doc type (will, POA, trust, livingWill, pourOverWill, deed, affidavit, gitRep3, estatePlanSummary) needs **NO code** — upload via **Knowledge Base → Templates tab → Add Template** (fields: `docType`, `variant`, `content`, `isActive`, `isDefault`, `complexity`; engine `getTemplate()` at `template-engine.ts:1325` resolves variants automatically). A brand-new doc **TYPE** is heavyweight (~7-10 files) and likely unnecessary given the ~13 existing AI "flex" types.

### ✅ (RESOLVED 2026-06-02) scraped sites — already gone, nothing to purge
Adam's call: purge all the Firecrawl competitor pages. Read-only verification (full scan of all 162 `firms/elias-counsel/knowledgeBase` docs by `contentSource`, `source`, `category`, title, sourceUrl, and tags) found **zero** Firecrawl/competitor docs — no `contentSource:'firecrawl'`, no `firecrawl-*` tags, no competitor-domain matches (WealthCounsel/InterActive Legal/Smokeball/HotDocs/Wealth Docx/BeyondCounsel/Bolster). The 30 scraped pages were already removed at an earlier point (most likely during the Firecrawl integration removal / consolidation cleanup). The KB now holds only legitimate content: 97 Justia NJ Title 3B statutes, 39 system-seed (NJ statutes/case law/checklists/practice notes), 26 bulk-upload form templates + NBI CLE materials. No deletion performed — the target set was empty.

---

## 📍 2026-06-01 session log — CI fixed & GREEN, Carmela removed, name validation, scrape + prod bugs

### ✅ CI functions-deploy — FULLY FIXED & GREEN (had been failing for WEEKS)

Triggered by setting `FIRECRAWL_API_KEY`: `scrapeEstatePlanningSoftware` was 404 (never deployed), and **every** `firebase-functions-deploy.yml` run had failed since ≥2026-05-27. Peeled through many layers; final state: **run `26786510980` succeeded**, `scrapeEstatePlanningSoftware` is **ACTIVE + callable** → the **Scrape Software** button works.

Root causes & fixes (in order surfaced):
1. **Wrong SA in the CI secret.** `FIREBASE_SERVICE_ACCOUNT_EPG` authenticated as `firebase-adminsdk-fbsvc@…` (no deploy rights), not the purpose-built `github-action-1189038360@…` deployer SA. Confirmed via a temporary `client_email` diagnostic step (since removed). Fix (Path A, user-chosen, least-privilege): minted a fresh key for `github-action`, rotated it into the GitHub secret via `gh secret set`.
2. **functions-backfill predeploy `tsc` TS5107.** Workflow only `npm ci`'d `functions/`, so backfill's predeploy `tsc` used an ambient newer TS demanding `ignoreDeprecations:"6.0"` (local 5.9.3 uses/accepts only `"5.0"`). Fix (`2dd043e`): added an `npm ci` step for `functions-backfill` + set `ignoreDeprecations:"5.0"` to match `functions/`.
3. **Six least-privilege IAM grants on `github-action`** (each a distinct preflight/deploy layer): `iam.serviceAccountUser` on the **appspot** SA → `secretmanager.admin` → `datastore.viewer` → `iam.serviceAccountUser` on the **compute** SA (Gen2 runtime) → `run.admin` → `cloudscheduler.admin`.
4. **Invoker binding.** The function was created during a partial deploy *before* `run.admin`, so its Cloud Run service had no invoker. Manually granted `allUsers`→`roles/run.invoker` (matches other callable fns; auth still enforced in-code via `request.auth`).

**Known gaps:**
- Workflow `paths:` covers `functions/**` but **not** `functions-backfill/**` — backfill-only pushes won't auto-trigger (use `workflow_dispatch`). Consider adding it.
- A new user-managed key exists on `github-action-1189038360` (id `bfbc4eee…`); old `firebase-adminsdk-fbsvc` keys left intact (`service-account.json` uses one). Track/rotate per hygiene.

### ✅ Carmela (AI receptionist / Twilio) — REMOVED per user request

Its required `TWILIO_AUTH_TOKEN` secret (never set) was blocking the full-source CI deploy. Removed entirely (commit `e199609`): deleted `receptionist-intake.ts` + `ReceptionistPage.tsx`, stripped the export/route/`ROUTES.RECEPTIONIST`/`.env.example` Twilio block, and the `firestore.rules` blocks for `intakes`/`receptionistSessions`. **Rules deployed** (`firebase deploy --only firestore:rules`, released ✓) and the empty **`TWILIO_AUTH_TOKEN` secret deleted**. tsc + build clean.

### ✅ Name-split migration — DONE (committed, reviewed, approved)

- **Comma bug fixed (`20e2514`):** `split-names.cjs` left a trailing comma on comma-separated suffixes (`"Jose Polo, Sr." → lastName:"Polo,"`). Now strips it. Verified in live data post-approval: `Jose | Polo | Sr.`, joined `name="Jose Polo Sr."`.
- **`--commit` for `elias-counsel`:** 14 clients got `_pendingNameSplit`; **user reviewed & approved** at `/admin/name-splits` (queue now empty = done).
- **Diana Doran accidental approval — undone.** She had two people in one slot (`"Diana Lynn Doran & Michael Doran"`); the accidental approve set a garbage `middleName`. Removed the split fields from `executor.primary` (name preserved, renders fine). If Michael should be a real co-/alternate fiduciary, restructure her record (decision pending).
- **🔴 Remaining browser step:** regen Karen (married — expect byte-identical) + Lucas (widowed — Ibrahim renders by name; addresses still `[MISSING]` until filled).

### ✅ Name-field input validation — SHIPPED (`f7b4f6b`)

Blocks symbols/digits in first/middle/last name fields; **hyphen allowed only in last names**; apostrophes (O'Brien) + middle-initial periods kept. New `sanitizeName`/`sanitizeNameField` in `src/utils/sanitize.ts`, applied centrally at `QuestionnaireContext.updateField/updateFields` (covers all steps + PersonPicker), `RepeaterField.updateItem`, `NameSplitsReview`, `NewClientPage`, `QuestionnaireRegisterPage`. 9 new tests, full suite **613 pass**, build clean. (Suffix unaffected — constrained dropdown.) Backend/bulk-import is NOT yet guarded — possible defense-in-depth follow-up.

### ✅ Firecrawl scrape + two prod bugs it exposed (all fixed)

Scrape: **30 pages saved** total (29 first run + idempotent retry confirmed 30 existed), **2 permanently failed** — `beyondcounsel.com` + `/features`. **Diagnosed as the SITE being down/unreachable, not our bug:** DNS resolves (`207.148.248.143`) but port 443 refuses connections from this machine *and* all Firecrawl proxy modes (basic→`ERR_TUNNEL_CONNECTION_FAILED`, stealth/enhanced→`ERR_CONNECTION_CLOSED`). **Called done at 30 pages** (5 of 6 vendors fully covered). If BeyondCounsel content is ever wanted: retry when their site is up, or pull from web.archive.org. Two real bugs surfaced and were fixed:

- **KB page "Failed to load resources" (`ba912a8`).** `searchKnowledgeResources` loads up to 200 docs with full `content`; the 29 new ~50KB Firecrawl docs pushed the **256MiB** function into a startup OOM. Bumped to **512MiB** (matches sibling KB fns). Deployed, ACTIVE.
- **Mercury enrichment broken project-wide (`619a54f`).** `mercury-coder-small` was retired (403 for accounts created after 2026-02-24), so ALL Mercury calls failed (scrape enrichment, transcription summaries, ai-memory, bulk-import, KB analyze). Migrated → **`mercury-2`** across the default + 6 call sites + the allowlist, and **removed `diffusing:true`** (mercury-2 returns 400 on it for non-streaming). Verified live vs `api.inceptionlabs.ai`.
- **Re-enriched the 29 saved docs** via `functions/scripts/backfill-firecrawl-enrichment.cjs` (mercury-2 direct): **29/29 enriched** (titles/categories/tags/docTypes/summaries written; `onKnowledgeResourceWritten` re-vectorized them). Future scrapes enrich automatically.

---

## 📍 Earlier — 2026-06-01 PM (Google Calendar sync restored)

### ✅ syncGoogleCalendar scheduled fn — broken for 5+ weeks, fixed end-to-end

Session-start health check (per global rule) caught it: every 5-min cron invocation since at least 2026-04-23 was throwing `invalid_grant` on the refresh-token call. Two-stage fix:

1. **Stale OAuth refresh token (root cause).** Commit `88eff43` (2026-04-23) rotated `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` secrets but left the *firm's* `firms/elias-counsel.googleCalendar.refreshToken` pointing at the prior client. **Two prior sessions missed this** because the symptom (every-5-min scheduler error) only surfaces in `firebase functions:log`, not in the UI. Same blast-radius pattern as the Google Sign-In bug fixed 2026-05-27 (which had the same root cause and was found the same way). Fix: hosting was redeployed first because the Settings → Integrations → Google Calendar card was rendering `Missing VITE_GOOGLE_CLIENT_ID` — the deployed bundle predated that var being added to `.env`. After fresh `npm run build` + `firebase deploy --only hosting` the Connect button worked; reconnect minted a fresh refresh token from the current client.
2. **Stale sync checkpoint.** After the auth fix, next sync still failed on `adam@adameliaslaw.com` with `410 updatedMinTooLongAgo` — the firm-level `googleCalendarLastSyncAt` checkpoint was 5+ weeks old, past Google's ~30-day cap on `updatedMin`. One-shot Firestore update reset it to 7 days back. Next sync after reset: **67 events across 4 calendars** (KarenAdam 18, Elias Counsel LLC 34, info@ 0, adam@ 15) with no errors.

**Carry-forward gaps:**

- ✅ **Closed 2026-06-01** (commit `33d8c2b`, pushed to `main`). `VITE_GOOGLE_CLIENT_ID` is now mirrored in `.env.example` (frontend config block, blank value per convention). CLAUDE.md "mirror new vars" contract satisfied.
- The manual hosting deploy this session was done before the CLAUDE.md "Never tell the user to deploy manually" rule (#5) landed. Going forward: push to `main`, let `.github/workflows/firebase-hosting-deploy.yml` handle it.

---

## 📍 Earlier same day — 2026-06-01 (Firecrawl KB scraper SHIPPED, one manual step pending)

### ✅ Firecrawl estate planning scraper — merged to main

Two PRs merged and auto-deployed:

- **PR #22** — `scrapeEstatePlanningSoftware` Cloud Function (`functions/src/firecrawl-scraper.ts`)
  Scrapes 32 publicly accessible pages across WealthCounsel, InterActive Legal, Smokeball, HotDocs, BeyondCounsel, BolsterBruderLegacy. Saves each page to `firms/{firmId}/knowledgeBase/` as a `practice_note`, AI-enriches via Mercury, vectorizes automatically via the existing `onKnowledgeResourceWritten` trigger. Idempotent — skips already-scraped URLs.

- **PR #23** — "Scrape Software" button on Knowledge Base page (Resources tab, purple, beside Bulk Import)

### 🔴 One manual step required before the scrape will work

**Set the Firecrawl API key as a Firebase secret:**

```bash
firebase functions:secrets:set FIRECRAWL_API_KEY
```

Get your key at firecrawl.dev (free tier available). Without this, the function throws an internal error immediately.

**Then trigger the scrape:**

Go to Knowledge Base → Resources tab → click **Scrape Software**. Runs once (~2–5 min). All 32 pages will appear in Resources tagged `firecrawl-wealthcounsel`, `firecrawl-smokeball`, etc., and become available for RAG retrieval during document generation.

---

## 📍 Prior session — 2026-05-27 afternoon (name-split refactor SHIPPED, manual smoke pending)

### ✅ Name-split refactor — all 6 phases on main

5 commits pushed to `origin/main`. Build + tests + tsc all clean (604/604, both packages).

| Phase | Commit | What |
|---|---|---|
| A — Write-side migration | `ad83324` | Schema additions on `FiduciaryPerson` + `Child` + grandchildren/otherDependents items (added `firstName/middleName/lastName/suffix + _pendingNameSplit`). All 10 fiduciary questionnaire steps + 3 repeater inner-fields now render 4 inputs instead of "Full Name". PersonPicker writes split fields + `.name`. `client-context-aggregator.deriveNameInPlace` joins parts back into `.name` before any downstream consumer reads it — so existing Firestore templates bound to `{{...name}}` keep rendering with **zero template edits**. |
| B — Migration script | `294037c` | `functions/scripts/split-names.cjs` proposes splits into a `_pendingNameSplit` staging field. Idempotent. Flags: `--dry-run` (default), `--commit`, `--force`, `--firm <id>`, `--client <id>`. Handles Jr/Sr/II-V/Esq suffix detection. Never touches canonical fields. |
| C — Admin review UI | `831f6bf` | `/admin/name-splits` lists every client with pending splits. Per-row editable firstName/middleName/lastName/suffix; Approve commits split + writes joined `.name`; Skip clears proposal only. Bulk-approve per client. |
| D — Prompt-doc refresh | `4b30015` | `process-template-file.ts` + `retemplatize-templates.ts` AVAILABLE_FIELDS now lists split fields for every fiduciary + repeater item. Used on next template re-upload, not retroactive. |
| E — PersonPicker dedup upgrade | `bbe2da1` | `getAvailablePeople` dedup key upgraded from lowercase-name-string → `firstName|lastName` (case-insensitive). Falls back to legacy key when parts aren't both populated. |

### 🔴 Open user actions for next session

**Manual smoke-test of the refactor — 3 steps:**

1. **Browser smoke-test the questionnaire.** Open any client → Questionnaire → confirm the family repeater steps (children / grandchildren / otherDependents) and all 10 fiduciary steps render **4 inputs** (firstName / middleName / lastName / suffix) instead of a single "Full Name". On a fiduciary slot, pick someone from the PersonPicker dropdown and confirm all 4 split fields auto-fill. Repeat the pick on a third slot — confirm dedup (Phase E) collapses the same person to a single row.

2. **Run the migration script.** First dry-run, then commit if proposals look right:
   ```powershell
   node functions/scripts/split-names.cjs --dry-run --firm elias-counsel
   node functions/scripts/split-names.cjs --commit --firm elias-counsel
   ```
   Inspect splits for Karen / Lucas / Jessica / Vita Maria / Vito / Deepak rosters. Specifically confirm "Jose Polo Sr." → `{ firstName: Jose, lastName: Polo, suffix: Sr. }` and "Ibrahim Polo" → `{ firstName: Ibrahim, lastName: Polo }`. Re-run with `--client <id>` to scope down if a single client looks off.

3. **Review in `/admin/name-splits` + regen Karen + Lucas.** Navigate to the admin page; per row, Approve / edit-then-Approve / Skip. Bulk-approve once a client's section looks right. Then regen Karen (married — should be byte-identical to last known good) and Lucas (widowed — POA + HC should now show Ibrahim Polo populated in the appointment paragraphs). Diff each against last-known-good output.

**Why no functions deploy is needed:** the only function-side change is `client-context-aggregator.deriveNameInPlace`, a no-op when entries don't have `firstName` set. The migration UI commits canonical `.name` directly too, so generations work either way. **A deploy is still recommended** the next time you're shipping anything else, so the aggregator's deriveName runs on split entries someone fills in via the questionnaire without going through the admin UI.

**Pre-refactor blocker resolved today:** Google Sign-In was broken because a prior Claude Code session (commit `88eff43`, 2026-04-23) rotated the OAuth client via gcloud CLI but never PATCH'd Firebase Auth's IdP config to point at the new one. Old client deleted; replacement orphaned; nobody noticed for 5 weeks because stale sessions kept working. Fixed today: new OAuth client `749324460027-ej1n0hnqvtga3pa5d9bctiro1vcl0du9.apps.googleusercontent.com` created in GCP Credentials; Identity Toolkit IdP config PATCH'd to point at it. Google Sign-In end-to-end verified working. Memory saved at `feedback_audit_log_ai_attribution.md` so future sessions check git log + commit authors before assuming a human action when audit logs show destructive changes attributed to the user's gmail.

### 🔴 Open user actions (carried from prior session, still pending)

1. **iPhone-deploy unlock — 3 legs of setup.** Goal: deploys + edits + tests all possible without the laptop. Each leg is independent; do them in this order:

   **1a. CI bootstrap (closes the deploy loop):**
   - In GCP IAM, create a service account: `epg-deployer@estate-plan-generator.iam.gserviceaccount.com`
   - Grant roles: `Firebase Admin`, `Cloud Functions Admin`, `Cloud Build Editor`, `Service Account User`, `Firebase Hosting Admin`
   - Mint a JSON key for it; copy the JSON contents
   - In GitHub: repo Settings → Secrets and variables → Actions → New secret → name `FIREBASE_SERVICE_ACCOUNT_EPG`, value = the entire JSON
   - The deploy workflow already exists in `.github/workflows/` — confirm it references `FIREBASE_SERVICE_ACCOUNT_EPG` (or create one if missing)
   - Test by triggering the workflow manually from the GitHub Actions tab

   **1b. Editor for phone-side code work:** pick one
   - **Claude Code via claude.ai/code or Anthropic mobile app** — full agent that edits, tests, commits, pushes. Best for AI-driven sessions like this one.
   - **GitHub Codespaces** — browser-based VS Code with full terminal. Slow on iPhone Safari; usable on iPad with keyboard.
   - **GitHub mobile app** — for tiny edits only, no test runner.

   **1c. Why each leg matters:**
   - Without 1a: you can edit + commit from anywhere but deploys still require the laptop.
   - Without 1b: you can trigger deploys from GitHub mobile but can't write the code that triggers them.
   - Together: full PR → CI → deploy cycle works from a phone. iPad-with-keyboard is dramatically more practical than iPhone-alone for any non-trivial session.


---

## 📍 Prior session — 2026-05-27 evening (PersonPicker + AddressField fixes; name-split refactor queued)

### 🔄 What changed (2026-05-27 evening, after the PM functions deploy below)

- **CSP fix shipped** (commit `ea130aa`). Added `https://maps.gstatic.com` to `img-src` so Google Places autocomplete dropdown sprites (powered-by-google badge + autocomplete-icons) load instead of being blocked. Cosmetic fix but eliminated console noise.
- **AddressField keystroke-drop bug (React 19 + Maps Autocomplete) — fixed** (`4c2c814` + `d4c2630`). `google.maps.places.Autocomplete` attaches native listeners that suppress React 19's controlled-input event flow across the entire address sub-form. Converted all 5 inputs (street, city, state, zip, county) to uncontrolled `defaultValue + onChange + ref sync` pattern. `useEffect` syncs each ref when canonical state changes externally (initial load, "Same as my address", autocomplete fill).
- **RepeaterField stale-closure clobber — fixed** (`bb97201`). When AddressField fires a multi-field address update inside a RepeaterField item (children section), the InnerField loops `onFieldChange` 5 times. Each call read `items` from the closure at render time; sequential dispatches each REPLACED the children array with a version that had only ONE field set, so only the last (county) survived. Fix: `itemsRef` updated optimistically before each `onChange` so successive same-tick updates build on each other.
- **PersonPicker shipped** (`761cb14`). New dropdown at the top of every fiduciary slot (10 slots total: executor primary+alt, trustee primary+alt, POA agent+alternateAgent, HC agent+alternateAgent, guardian primary+alt). Aggregates people already in the questionnaire — spouse (if `hasSpouse`), children, other-dependents, and anyone previously named in another fiduciary slot. One-click selection fires a single multi-path `updateFields` dispatch that auto-fills name + relationship + gender + phone + email + full address composite. Storage = copy-at-selection (no live link). Renders null when the pool is empty so first-time questionnaires are unaffected.

### 🔴 Open user actions (carried, still pending)

1. **Fill Ibrahim Polo + Jose Polo Sr. addresses via admin UI** — Lucas's 4 fiduciary roles all point at one of them with `{ name, relationship, phone, email }` only. After the fixes today, you should now be able to type/autocomplete/copy successfully. Once filled, regenerate POA + HC for Lucas to confirm `[MISSING: <role> address]` markers clear.
2. **UI smoke-test the marital-status sweep** — regen Karen (married, should be byte-identical) + Lucas (widowed, should now show Ibrahim by name).
3. ~~**One-time CI bootstrap**~~ — ✅ DONE 2026-06-01. CI functions-deploy is green; see top section for the full bootstrap (key rotation + 6 IAM grants + invoker).
4. ~~**Activate Carmela**~~ — ❌ MOOT 2026-06-01. Carmela removed entirely per user request; see top section.
5. **Merge `incoming-ai-chambers` in adamelias.ai** when ready.

### ✅ Name-split refactor SHIPPED 2026-05-27 afternoon — see top of file for the rundown + manual smoke-test steps.

---

## 📍 Earlier in 2026-05-27 PM — functions deploy + Mercury 2 activation + warn-fires verified

### 🔄 What changed (2026-05-27 PM)

- **Functions deploy succeeded.** 81 functions in `default` codebase redeployed on revisions `00043-muh` (generateDocuments) / `00048-zim` (generateSingleDocument) + all others. Ships every queued change since 2026-04 (warnNonMarriedFiduciaryGaps backstop, maritalStatus case-fix, content-integrity false-positive fix, SendGrid backend, codebase audit P1s). Backfill codebase untouched (no source changes).
- **Mercury 2 activated.** `MERCURY_API_KEY` secret created (version 1). The 4 functions piloted on Mercury (`chatAi`, `transcribeAudio`+`summarizeTranscription`, `knowledge-base` ops, `bulkProcessKnowledgeFiles`) will now actually invoke Mercury for non-attorney-facing async tasks (extraction, summarization, tagging, enrichment). Provider-fallback chain still catches errors → primary provider.
- **Carmela receptionist (e689ce5) intentionally NOT deployed this round.** `receptionistWebhook` + `receptionistStatus` need `TWILIO_AUTH_TOKEN` secret + Twilio phone-number wiring. Skipped via temporary `index.ts` export comment-out for the deploy; reverted in source. Carmela code remains in repo, ready to ship when Twilio is wired.
- **End-to-end verification.** Ran the deployed template engine against Lucas Polo's data via `functions/scripts/test-warn-fires.cjs`. Confirmed:
  - 4 `[template-engine] Non-married client (widowed) has named fiduciary with no address: fiduciaries.<role>.<level> name="Ibrahim Polo"` warnings fire (executor.primary, trustee.primary, powerOfAttorney.agent, healthcareProxy.agent)
  - Primary HC Rep renders **`I appoint my Son, IBRAHIM POLO, of [MISSING: healthcare proxy address]`** (was `[MISSING: primary healthcare proxy name and address]` pre-fix). The `{{#if hasSpouse}}` conditional works end-to-end in production code.
  - `[MISSING: healthcare proxy address]` marker will resolve once Ibrahim's address is entered.

_(Open user actions for this session are listed in the evening session block above — see top.)_

---

## 📍 Prior session — 2026-05-27 AM (IL marital-status binding sweep + dedup — SHIPPED)

### 🔄 What changed (2026-05-27)

**Dedup (4 templates deleted, payloads stashed to `tmp/dedup/__deleted/`):**

| Pair | Kept (canonical, isActive=true) | Deleted (isActive=false) |
|------|---------------------------------|---------------------------|
| Jessica HC 11.3.25 | `zNXZnZNN1YqGqSGWIEOe` | `QU978ikcinUlcKuMCqyg` |
| Jessica POA 11.3.25 | `SUJUQRIjiTTxjdKJO79o` | `fN5MXom5iYsVkdUAZd6l` |
| Rizzo Living Trust | `7HbUWAD8ofeHYYtq6tNZ` | `mcrsbJBXr8zBeZamjXbJ` |
| Jessica LW&T 11.3.25 | `CCepgSwMNusH1jsWPRf8` | `nGH7jfJINVP08BK1mc7A` |

`isActive` flagged the canonical version in every pair — the kept ones are post-2026-04-28 retemplatized (correct `.alternateAgent` paths, full address composites, no hardcoded "my mother"). The deleted ones were pre-2026-04-28 legacy with cross-fiduciary bind bugs and Jessica-specific hardcoded family relationships. Diff dossiers in `tmp/dedup/<pair>__bindings.txt`. Backups recoverable at `tmp/dedup/__deleted/`.

**Binding sweep (8 surgical patches across 6 templates):** wraps each fiduciary-appointment paragraph in `{{#if hasSpouse}}…{{else}}fiduciaries.<role>.<level>.*…{{/if}}` so widowed/single clients route through the fiduciary record instead of empty `{{spouseFullName}}` + `{{spouseInfo.address}}` bindings. Original content stashed in `templateBaseline_pre_marital_sweep` field on each touched template (revert: `update({ content: data.templateBaseline_pre_marital_sweep })`).

Used `{{#if hasSpouse}}` (boolean from `pi.maritalStatus === 'Married' || 'Domestic Partnership'`) NOT `{{#if spouseFullName}}` — the latter can be falsely truthy if a widowed client retains the deceased spouse's name in `spouseInfo` for documentation purposes.

| Template | Paragraph | Fallback fiduciary path |
|---|---|---|
| `aPLknv` Deepak HC | Primary HC Rep | `fiduciaries.healthcareProxy.agent` |
| `zNXZnZNN` Jessica HC | Primary HC Rep | `fiduciaries.healthcareProxy.agent` |
| `SUJUQRI` Jessica POA | Primary AIF | `fiduciaries.powerOfAttorney.agent` |
| `7uu7gxTN` Vita Maria PourOver | Funeral Rep + Initial Executor | `fiduciaries.executor.primary` |
| `ltaUcvCq` Vito PourOver | Funeral Rep | `fiduciaries.executor.primary` |
| `CCepgSw` Jessica LW&T | Funeral Rep + Initial Executor | `fiduciaries.executor.primary` |

Funeral Rep paragraphs additionally drop the "If {{spouseFullName}} is not living" spouse-contingency clause in the widowed/single branch (where the primary IS already the fallback, so the contingency is nonsensical).

**Backstop logging (template-engine.ts):** new `warnNonMarriedFiduciaryGaps()` called from `buildTemplateData` — logs a specific warning when a widowed/single/divorced/separated client has a named primary fiduciary with no address. Surfaces the data gap that the new conditional will otherwise paint over as blank address brackets.

**Intentionally skipped (different bug class, NOT the marital-status sweep):**
- **Joint-trust templates** (`5ASIRxxh` Joint Revocable, `7HbUWAD8` Rizzo Living, `aRzJFmoc` Olukhov) — require both grantors by template design. Single-grantor clients need a single-grantor trust template, not a conditional patch.
- **Family-info paragraphs** (12+ across remaining templates) — "I am married to X" / "I leave to my spouse Y" / "If my spouse predeceases me". Reference the actual spouse for legitimate family-history reasons. For widowed clients, prose may need to change ("I was married to X, who predeceased me"), but that's separate prose-design work, not a binding bug.
- **Trust-name composites** (`{{personalInfo.lastName}} {{spouseInfo.lastName}}`) — naming convention, not appointment.
- **POA powers** (`92qPzaWa` Deepak POA idx=17 "Gifts to Wife") — POA-power clauses keyed on `{{spouseTitle}}`. Different bug class (these powers don't apply when there's no spouse).
- **JessicaPOA pre-existing successor-binding bugs** (1st-Successor pointing at `agent` instead of `alternateAgent`; 2nd-Successor pointing at `executor.alternate` on a POA template). Unchanged by this sweep — pre-existing template-author bugs left for separate cleanup.

_(Same-day session continued — see 2026-05-27 PM section above for deploy details.)_

---

## 📍 Prior session — 2026-05-26 PM (PR #16 AI Chambers reverted — misfiled here; ported to adamelias.ai)

### 🔄 What changed

PR #16 ("AI Chambers — 6-app build from solo-lawyer grievance research") was determined to be misfiled in `estate-plan-generator`. The research brief that drove it explicitly intended adamelias.ai — confirmed by adamelias.ai already having a `/chambers/<tool>` route convention. The squash commit `a0f2b75` has been reverted from `main`.

PR #16's content was ported to adamelias.ai's `incoming-ai-chambers` branch (push pending merge):
- ✅ `billing-calculator/` — fully converted to adamelias.ai conventions, routed at `/chambers/billing-calculator`
- 🔶 `integrations-hub/`, `brief-analyzer/`, `automations/` — source files staged with per-tool rewiring READMEs (~30-90 min each to wire up)

**Not ported** (intentionally): Citation Verifier (adamelias.ai already has two better verifiers — `legal-verification-checklist` + `citation-verifier`). Enhancements to existing estate-plan-generator features that were bundled into PR #16 (Doc Review Billable Value, KB template drift, Research Chat anonymize + citation badges) were reverted with the rest — if any of these were desirable on their own merits, they can be re-implemented in a future PR scoped to estate-plan-generator alone.

**Permanent record:** the full untouched PR #16 squash lives on the `ai-chambers-export` branch in this repo (commit `a0f2b75`). Do not delete that branch.

### ✅ IL Template marital-status binding sweep + dedup — SHIPPED 2026-05-27 AM

See top of file for the full rundown (dedup table, patch list, intentional skips, validation plan). Live in Firestore now — no deploy needed since Firestore is the template source. Only outstanding items: smoke-test via UI, fill Ibrahim/Jose Polo addresses.

### 🟢 Also queued for the next functions deploy — content-integrity checker false-positive fix (2026-05-26 AM)

Commit `1290c9e` lands a one-line strip-then-collapse fix in `functions/src/doc-content-integrity-checker.ts`. Deploy the affected pair when convenient:

```powershell
firebase deploy --only functions:generateSingleDocument,functions:generateDocuments --project estate-plan-generator
```

- **Why.** Verified the checker against all 48 vault docs via `tmp/dryrun-integrity-checker.cjs` (read-only, no regen). The "Missing space after parenthesis" warning was firing on **16/48 docs (33%)**, almost entirely false positives from naive HTML stripping (`</p><p>` collapsed to nothing, so `(050422014)</p><p>Attorney at Law` looked like `(050422014)Attorney at Law` and tripped `PAREN_NO_SPACE`).
- **Fix.** Replace tags with a space, then collapse whitespace:
  ```diff
  - const stripped = html.replace(/<[^>]+>/g, '');
  + const stripped = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ```
- **Result.** Flag rate 33% → 6.3% (16 → 3). False positives cleared; real findings preserved. The existing unit test on `(050422014)Attorney for the firm.` inside a single `<p>...</p>` still trips the rule. 14/14 unit tests pass; tsc clean on both packages.
- **Real bugs the cleaned-up dry-run surfaced** — agent cleanup partially complete:
  - ✅ `firms/elias-counsel/clients/4Shw3Wp3Pf0kzozGAxGX/documents/unlKatUHBvVSzBdLUxxz` — **DELETED 2026-05-26 PM** via verify-then-delete (six safety checks passed: `uploaded-draft` tag intact, `Uploaded existing draft` changeNotes, editorContent <100 chars, content still had unresolved `{{...}}`, updatedAt before 2026-04-04, zero versions). Was a raw `.docx` template upload from project genesis (2026-03-16) — junk in the vault. Gone.
  - `firms/elias-counsel/clients/B6t17ajHjjNOddKz81td/documents/livingWill` (2026-04-15, `promptVersion: 951230f72536`) and `.../poa` (2026-04-15, `promptVersion: 8786226e19aa`) — AI-generated under pre-fix prompt versions. Empty `<strong></strong>` + "appoint my , , of , as HealthCare Representative" symptoms match the bug fixed in **commit `1609b31` on 2026-04-28: "`markMissingFiduciaries` — accumulator clobber bug"**. **Recommended action: regenerate both via the UI.** (Earlier note that this client "looks like genesis-day test data" was WRONG — it's **Lucas Anibal Polo**, a real 90-year-old widower prospect in Newark NJ with 2 children, full fiduciary slate, and 5 docs in his vault. Do NOT delete the client. Just regen the 2 buggy docs.)
- ✅ **Bonus case-fix shipped 2026-05-26 PM (commit `93219cd`)**: content-integrity checker now normalizes `maritalStatus` via `.toLowerCase()` before comparing, so capital-`M` `Married` (which real client data uses) no longer drops the spouse-name warning silently. Test added; 15/15 pass.

### ✅ 2026-05-26 — Smoke tests 3a + 3b closed

POA address rendering: **pass** (single-string composite address renders cleanly, no phantom blanks). Missing-address admin banner: **pass** (amber banner appears with the missing-slot list on clients with named fiduciaries but no address). Originally deferred from 2026-05-05, finally closed 2026-05-26.

---

## 📍 Prior session — 2026-05-13 AM (PageIndex chat-completion migration — verified end-to-end)

### ✅ 2026-05-13 — NJ Title 3B ingested into KB (97 statutes)

- **Scraped** `https://law.justia.com/codes/new-jersey/title-3b/` via Firecrawl CLI (firecrawl map → batch scrape with `--only-main-content --format markdown`). 97 of 98 sections retrieved after three retry passes; one section (`3B:31-40`) hit a Justia captcha and was skipped — manual upload if needed.
- **Parser** `functions/scripts/ingest-nj-title-3b.cjs` parses each markdown file (heading + universal citation + statute body, strips Justia chrome) and writes to `firms/elias-counsel/knowledgeBase/{deterministic-id}` as `category: 'statute'` with:
  - `title`: e.g. "N.J.S.A. 3B:1-2 - Definitions I to Z"
  - `citation`: `N.J.S.A. 3B:1-2`
  - `content`: cleaned statute body
  - `jurisdiction: 'NJ'`, `source: 'Justia'`, `sourceUrl`
  - `docTypes`: heuristic mapping by section range (3B:3-* → will, 3B:11-* → trust, etc.)
  - `tags: ['title-3b', 'NJ', 'statute', 'estate-administration']`
- **Deterministic doc IDs** (`nj-title-3b-1-2`) so re-runs upsert rather than duplicate.
- **Auto-embedding**: the existing `onKnowledgeResourceWritten` trigger fires on each insert, generating Vertex `text-embedding-005` vectors automatically. No manual backfill needed.
- **Impact:** the template engine's `searchKnowledgeBase` call during doc generation now has 97 grounded NJ statutes to retrieve from instead of an empty corpus. Direct soul-impact for accuracy/reliability of AI-augmented and hybrid generations.
- **Cost:** ~150 Firecrawl credits used (scrape + retries). 752 of 1000 remaining in May 2026 billing cycle. Vertex embeddings under $0.01 total.

### ✅ 2026-05-13 AM — Content-integrity checker (soul-direct generation defender)

- **New module `functions/src/doc-content-integrity-checker.ts`.** Runs after structural validation in `unified-generator.ts`, on EVERY generation mode (template, hybrid, ai, flex — the structural validator skips template mode; integrity check does not, because content symptoms can leak through any path).
- **Rules (v1):** unresolved Handlebars `{{...}}`, empty fiduciary slot pattern `", , ,"`, empty appointment clause `"appoint my , ,"`, trailing Oxford-list fragment `", and ."`, double-period typo `JR..`, empty `<strong></strong>` / `<em></em>` shells, missing space after parenthesis `)Word`. Plus client-data presence: client full name appears in the doc (error), spouse name appears for married clients (warning).
- **Wiring:** findings merge into the existing `validationFindings` array on the saved doc. Same Firestore schema, same `needs_review` status semantics — vault UI badges already light up on errors. No new save schema; no migration.
- **Non-blocking by design.** Findings flag, don't refuse. Attorney sees what's wrong but the doc still saves so it's reviewable in the editor.
- **Tests:** 14 new unit tests in `tests/unit/doc-content-integrity-checker.test.ts`. Full suite 603/603 pass.
- **Deployed:** `generateDocuments` + `generateSingleDocument` redeployed against new code. Both clean.
- **Soul-direct.** This catches the exact failure modes the prior session batches (April 27 → May 12) were chasing one-by-one in the template engine — unresolved vars, empty slots, missing names, typography drift. Going forward, regressions surface on the saved doc as visible warnings rather than silently shipping into the vault.

### ✅ 2026-05-13 AM — PageIndex retrieval → chat-completion migration (verified end-to-end)

- **End-to-end verified.** Asked "Who are Karen Elias's executors?" on `/chat` — emerald "From Client Files" bubble returned the full executor chain (Adam J. Elias → Roger Kondos → [MISSING] → [MISSING]) with markdown table, drew citations from `Last_Will_and_Testament_of_Karen_K_Elias_1778581009681.pdf` pages 3+4, citation panel populated. PageIndex chat round-trip ~14s.
- **Discovery during smoke-test:** PageIndex's chat-completion response contains BOTH inline `<doc=...;page=N>` markers AND a structured top-level `citations: [{document, page}]` array. We now use the structured array for SSE citation events (more reliable) and strip the inline markers from the visible content. Originally I only read the inline-tag format from the docs; the structured field came out of the actual response body during diagnosis.
- **Streaming temporarily disabled.** PageIndex `stream: true` works but its SSE chunks interleave tool-use blocks (`block_metadata.type === 'tool_use'`) with assistant content — a naive OpenAI-shape parser misreads the tool-call JSON as user-visible text. Switched to non-streaming (`stream: false`) which returns the assembled answer in one round trip. Re-enable streaming later by filtering on `block_metadata.type` for assistant content only.
- **New UX: "From Client Files" message bubble.** Pre-migration the `/chat` page intentionally discarded the `pageIndexClientFilesChat` text response (`onChunk: () => {}` — "RPC 1.6 isolated"), only surfacing citations to the right panel. With citations now populating, the missing answer became conspicuous. Wired the client-files answer into a separate emerald-tinted assistant bubble labeled "From Client Files" — keeps the attorney-client privilege boundary visually explicit (matches the backend's separate-function isolation). `ChatPage.tsx`: `Message.source?: 'research' | 'client-files'`, `AssistantBubble({ source })` tints + labels accordingly, `clientFilesStreaming` state shows a loading bubble during the ~15s round trip.
- **ChatPage subtitle updated.** Was "Powered by PageIndex · CourtListener · Claude". Claude removed — the LLM call lives inside PageIndex now for both ragChat and pageIndexClientFilesChat (Claude is still used elsewhere in the app, just not on `/chat`).
- **3 backend files migrated** (NOT 4 — `wills-processor.ts` only calls `/doc/` upload which the deprecation doesn't touch). All three deployed and clean. **tsc clean** on both packages.

### 📚 Namespace primer (recorded here so future sessions don't need to re-derive)

Three PageIndex namespaces under `pageindex_docs/{ns}/files`:
- **`reference`** — published authority (statutes, case law, treatises). Queried by `ragChat` (gray "Research Assistant" bubble). Currently 0 docs for `elias-counsel`.
- **`work-product`** — firm-internal work (prior memos, briefs, templates). Queried by `ragChat`. Currently 0 docs for `elias-counsel`.
- **`client-files`** — individual client docs (privileged). firmId-scoped. Queried EXCLUSIVELY by `pageIndexClientFilesChat` (RPC 1.6 isolated function, emerald "From Client Files" bubble). Currently 2 docs for `elias-counsel` (both are uploads of the same Karen will PDF).

The upload modal at `/chat` → Upload Document lets the user pick a namespace; defaults to `reference`. Until something gets uploaded to `reference` or `work-product`, the gray bubble will always return "No documents have been indexed yet" — that's the correct early-return.

### ✅ Previously-tracked: code-shipped state (kept for history)

- **3 files rewritten** (NOT 4 — `wills-processor.ts` only calls the upload endpoint `/doc/`, which is NOT deprecated; original HOMEWORK was over-inclusive):
  - `pageindex-retrieval.ts` — new `streamPageIndexChat(docs, userMessage, apiKey, onCitation)` async generator + rewritten `fetchPageIndexContext` (signature preserved for `chat-ai.ts`). Old `runPageIndexRetrievals`/`submitRetrieval`/`pollRetrieval` deleted.
  - `rag-chat.ts` — dropped Anthropic SDK + OpenAI fallback chain (PageIndex chat does both retrieval + synthesis now). Persona moved from `system` role to instruction prefix in the user message because the chat API doesn't accept `system` role. PageIndex chat failure → SSE error event (no document-less OpenAI fallback — confirmed with user that a hallucinated answer with no citations is worse than no answer for a legal-research tool).
  - `pageindex-client-files-chat.ts` — same migration shape, preserved firmId-scoped client-files isolation.
- **Architecture change:** PageIndex now handles BOTH retrieval AND LLM synthesis. The prior Anthropic-stream → OpenAI-fallback graceful-degradation chain (from commit `91c51f6`, 2026-05-06) is gone — the LLM call lives inside PageIndex. If PageIndex chat goes down, both functions surface SSE `{type: 'error'}`. The Anthropic key 401 issue mentioned in the prior session's follow-ups is now moot for these two functions (they no longer call Anthropic).
- **Citation shape regression:** PageIndex chat returns inline `<doc=file.pdf;page=N>` tags only — no `section`/`excerpt`/`nodeId`. Frontend `Citation` type kept; those three fields are empty strings now. The `CitationCard` in `ChatPage.tsx` renders them conditionally on truthiness, so they gracefully omit.
- **`chat-ai.ts` untouched.** Its `fetchPageIndexContext` consumer keeps the same `{ contextString, sources }` return shape — but the `contextString` is now LLM-synthesized prose ("here's what your firm docs say about X") rather than raw retrieval excerpts. Acceptable for downstream Perplexity injection.
- **tsc clean** on both `functions/` and root (`tsc -b --noEmit` EXIT=0 for both).

### ✅ 2026-05-12 PM — PageIndex key set + functions redeployed (then code reverted)

- **Real `PAGEINDEX_API_KEY` minted** on PageIndex dashboard. Critical learning: the dashboard masks existing keys (the `d75c0bbf****3e337025` string in HOMEWORK was the MASKED display of a real key whose unmasked value was lost — NEVER a placeholder per se; the `****` are literal display chars). The unmasked key is only visible **once in the creation dialog**, can never be recovered afterwards. After multiple failed paste cycles (clipboard captured Ctrl+V control char as a 1-byte secret; Get-Clipboard captured fragments of script text), the working flow was: paste into Notepad → Save As `pgkey.txt` (Text Documents, UTF-8) → `firebase functions:secrets:set --data-file pgkey.txt`. v7 confirmed: 32 bytes, first byte 'f' (0x66), last byte 'b' (0x62), zero non-printable bytes.
- **Versions 1–6 destroyed.** v3, v4, v5, v6 all stored bad values during the diagnostic-and-retry cycle (Ctrl+V char, 9-char fragment, 4-byte something, etc.). All explicitly destroyed by Firebase's automatic stale-version cleanup when v7 was set + functions redeployed.
- **4 PageIndex consumers redeployed against v7**: `ingestDocument`, `chatAi`, `ragChat`, `pageIndexClientFilesChat`. `willsProcessor` not yet deployed (Phase 2 / STOP GATE 3 still pending — will pick up v7 on first deploy).
- **HOMEWORK was wrong about `backfillPageIndexFirmId`** — it does NOT bind `PAGEINDEX_API_KEY` (it's a Firestore-only firmId backfill, doesn't talk to PageIndex). Was previously listed in the redeploy list.
- **End-to-end ingest path verified working**: upload a PDF → `ingestDocument` 200 OK in 2.2s → PageIndex stores doc → Firestore writes `pageindex_docs/client-files/files/<doc_id>` with `firmId: elias-counsel`. Two docs successfully indexed (one earlier upload + Karen's Will, doc IDs `pi-cmp2ivr4l02g601p7iqv37znl` + `pi-cmp2iz3t002g901p722d6r10t`).
- **Retrieval path BLOCKED on deprecated API** — see open item 1 above. Function plumbing is correct (Firestore lookup, firmId match, retrieval submission, polling all confirmed); the deprecated PageIndex endpoint just returns empty.
- **All diagnostic code reverted** at session close (per user request, since the migration will rewrite this code anyway). Reverted files: `ingest-document.ts` (cause-logging + key diagnostic + trim), `rag-chat.ts` (trim), `pageindex-client-files-chat.ts` (trim + pipeline-counts log + raw-body log), `wills-processor.ts` (trim), `pageindex-retrieval.ts` (raw-body log). **Cloud functions still have the temp code until next deploy** — benign for tonight but should be cleaned up in the next deploy cycle.

### 🆕 New follow-ups from this session

- **Anthropic API key is 401-ing.** `pageIndexClientFilesChat` + `ragChat` logs repeatedly show `Anthropic stream failed pre-chunk; falling back to OpenAI. err=401 invalid x-api-key`. Graceful-degradation (shipped 2026-05-06 in commit `91c51f6`) is doing its job — OpenAI substitutes successfully so user-facing chat still answers — but the Anthropic key needs re-rotation. HOMEWORK previously said it was rotated 2026-05-06; something has happened to it since. Run `gcloud secrets versions list ANTHROPIC_API_KEY --project=estate-plan-generator` to see current state, then mint a new key on console.anthropic.com if needed.

### ✅ 2026-05-12 hosting smoke-test bugs — all closed same day

- **A. In-law relationship translation** — added `IN_LAW_TRANSLATION` map in `unified-generator.ts` `swapFiduciaries`. Brother/Sister/Mother/Father → -in-Law on the spouse-swap view; preserves name + address, only the kinship label flips. Son/Daughter intentionally left alone (data can't distinguish joint biological from stepchild). Verified: Adam's docs now label Roger Kondos as Brother-in-Law; Karen's docs still show him as Brother.
- **B. Adam's address missing on HC Directive** — turned out to be TWO root causes:
  1. **`spouseInfo.address` was empty** — IL HC template renders the primary HC rep using `{{spouseInfo.address}}, .city, .state` (not `{{healthcareProxy.agent.address}}`). The questionnaire's spouse step never captures address. Added `autoFillSpouseInfoAddress` in `template-engine.ts` that defaults `spouseInfo.{address,city,state,zip,county}` to `personalInfo.*` when client is married and `spouseInfo.address` is blank (mirrors the existing `autoFillSpouseFiduciaryAddresses`).
  2. **Editor was showing stale `editorContent`** — `DocumentEditor.tsx` prefers `editorContent` over `content` when it has any text, but `document-save-helper.ts` only wrote `content` on regen. So every regenerate silently stranded the editor on the previous version. Fix: also write `editorContent: params.content` on every save.
- **C. Successor 2/3 Executor + Trustee slots "missing" from each Will** — NOT a rendering bug. `[MISSING: …]` markers ARE present (verified by inspecting `content` field of Karen's regen — 7-8 markers including second/third successor executor, trustee, guardian). User was observing the missing-data state correctly; the system is flagging it. Optional future enhancement: give `markMissingFiduciaries` markers the same orange inline styling that unresolved Handlebars vars get (template-engine.ts:2016) to make them visually prominent.
- **D. PR #9 subset-filter backend path** — verified working. Backend logs show exactly 6 `generateSingleDocument` invocations when 6 boxes were checked (no `estatePlanSummary` call). One side-finding closed same day; one logged for later:
  - ✅ **Progress modal lists all docs as "in generation" regardless of checkbox state** — closed 2026-05-12. `GenerateDocumentsButton.tsx:561` was iterating `packageDocs` (full list) instead of the selected subset. Switched to `selectableDocs.filter(d => selectedKeys.has(d.key))`. Hosting redeployed.
  - 🟡 **PR #9 dispatches per-doc serially** via `generateSingleDocument`, replacing the prior bulk path's 3-worker concurrent queue. All-checked case is now ~6× slower (each doc 30-60s sequentially). Worth a perf revisit.

### ✅ Closed during the 2026-05-06 + 2026-05-12 sessions

- **Hosting redeploy (closed 2026-05-12)** — `npm run build` clean (Vite v7.3.1, 7.36s); `firebase deploy --only hosting --project estate-plan-generator` uploaded 65 files and released. PR #9's per-doc checkbox UI in the Generate Estate Plan dialog is now live at https://estate-plan-generator.web.app. Browser smoke-test still pending — see open item 3.
- **OPENAI_API_KEY rotation (closed 2026-05-12)** — old leaked key (`sk-proj-52Mdei2rh2WJ…`) revoked on platform.openai.com; new key minted and set as version 2 via the file-based `firebase functions:secrets:set` flow (no cleartext in shell history). `ragChat` and `pageIndexClientFilesChat` redeployed against v2. Version 1 explicitly destroyed in Secret Manager (`gcloud secrets versions destroy 1`). `transcribe-audio` and `process-ocr` reference `process.env.OPENAI_API_KEY` but don't bind it, so they're unaffected. Verified: `gcloud secrets versions list OPENAI_API_KEY` shows v2 enabled, v1 destroyed.
- **Item 1** (browser hang UX) — verified closed against PR #6 commits.
- **Item 3 — Anthropic half** — `ANTHROPIC_API_KEY` rotated (twice — initial real key leaked, immediately re-rotated). KB-side admin chat smoke-tested and returned a complete answer.
- **Item 3 — `ingestDocument` region** — migrated `us-central1` → `us-east1`. The frontend was hardcoded to `us-east1` so the upload path was effectively broken in production before this fix.
- **Mid-term: RAG-chat graceful-degradation** — shipped in commit `91c51f6`. Both `rag-chat.ts` and `pageindex-client-files-chat.ts` now fall back to non-streaming `callAI()` (forced OpenAI gpt-5.4) when the Anthropic stream throws before any chunk has been emitted. Search Cloud Logging for `[ragChat-degradation]` / `[clientFilesChat-degradation]` to count fallback hits.

### 🟡 What's blocked vs. what's agent-codeable now

- **Blocked on deploy + smoke-test of the chat-completion migration** (open item 1). Code is on `main`; running `firebase deploy --only` on the two functions unblocks the Research chat right-panel citations end-to-end. Wills → PageIndex pipeline (mid-term) is no longer blocked on retrieval — upload path always worked; the deprecation only affected retrieval, which the wills-processor doesn't touch.
- **Agent-codeable without user blockers:** item 4 + item 5 are still user verification tasks.
- **Anthropic key re-rotation** is still agent-codeable if user wants it run, BUT it now only affects `chatAi` (research mode) — `ragChat` and `pageIndexClientFilesChat` no longer call Anthropic after the migration.

### 🧠 Memory added this session

`feedback_never_print_secrets.md` — guards future sessions from running `firebase functions:secrets:access` (which always returns cleartext). Use `gcloud secrets describe` or `gcloud secrets versions list` for existence/version checks.

---

## ⏱ Short-term (queued 2026-05-05 production deploy)

These items surfaced during the post-merge production deploy of PR #1 (`04a2739`). All non-blocking — production is live and validated. Knock these out in roughly the order listed.

### 1. ✅ Browser "hang" UX during long generations — closed 2026-05-05

**Resolution.** Two-part fix shipped:
1. Elapsed timer + progressive stage messages added to the generation modal (commit `956de17`): "Building context…" → "Drafting with AI… (this typically takes 2-3 min)" → "Saving to vault…"
2. Firestore polling fallback added to `SingleDocumentGenerator` and `FlexDocumentGenerator` (PR #6): subscribes `onSnapshot` to the client's `documents` collection filtered by `docType + updatedAt >= startTime`. Even if the HTTP connection drops silently, the listener detects the saved doc and marks success. A `succeededRef` guard prevents double-fire. Deployed and verified — modal resolves cleanly even when the function runs well past the browser timeout.

### 2. ✅ Gemini Embedding API 403 — migrated to Vertex AI (closed 2026-05-05)

**Resolution.** Migrated KB embeddings from `gemini-embedding-001` (firm-level API key, free tier — access revoked) to Vertex AI `text-embedding-005` (service-account / ADC, paid tier ~$0.10–0.15 per 1M tokens). PR #5. Both `functions/` and `functions-backfill/` redeployed in `us-east1`. All 54 KB resources and 11 templates re-embedded against the new model — vector search restored. The `[aggregateClientContext] Vector search failed, falling back to flat query` log line is gone.

**Two follow-on fixes shipped in the same PR:**
- Filter rewrite — backfill loop only passed `forceAll=true` on iter 1; old filter (`!embeddedAt`) made subsequent iters see zero candidates since everything had a stale Gemini timestamp. New filter (`embeddingModel !== 'text-embedding-005'`) drains the queue model-by-model.
- Metadata fetch limit raised from 50 → 500 in backfill codebase (Adam's KB had 54 resources; trailing 4 were silently skipped).

**Runtime project resolution** via `GoogleAuth.getProjectId()` instead of hardcoded `VERTEX_PROJECT = 'estate-plan-generator'`, so the same code runs under sibling projects (staging/forks) without `PERMISSION_DENIED`.

**Architecture note:** Vertex vector search (KB aggregation for doc generation) and PageIndex (interactive chat over client files) serve different roles and coexist intentionally. Vertex is batch/generation-time; PageIndex is user-facing/interactive. Cost delta is 1000-5000× per call in absolute terms but negligible at law-firm scale (~$0.005-0.015/PageIndex call vs ~$0.0000035/Vertex embed call).

### 3. PageIndex secret — still a placeholder (corrects the now-deleted "both keys rotated" claim)

**Anthropic half closed 2026-05-06.** Real `ANTHROPIC_API_KEY` set in Secret Manager (after **two** rotation cycles — original was leaked in cleartext via `firebase functions:secrets:access` during status confirmation, then a second time during pre-deploy verification of `OPENAI_API_KEY`. **Both keys rotated and the leaked versions revoked.** Memory entry `feedback_never_print_secrets.md` added so this stops happening.) `ragChat` and `pageIndexClientFilesChat` redeployed; KB-side chat smoke-tested at `/chat` with a complete streamed answer. ✅

**PageIndex half still open.** `PAGEINDEX_API_KEY` is the literal placeholder `d75c0bbf****3e337025` (the asterisks are real characters, not a Secret Manager mask — verified 2026-05-06). The pre-flight checklist in this doc was previously marked as "done 2026-05-05" but that claim was incorrect; the placeholder was never replaced. `ingestDocument` and `backfillPageIndexFirmId` are deployed but non-functional until a real key is set. Client-Files citation panel in the admin chat will be empty until then; this is also a hard prerequisite for the Wills → PageIndex pipeline (mid-term project below).

**To do when PageIndex account exists.**
1. Sign up at PageIndex, mint an API key.
2. `firebase functions:secrets:set PAGEINDEX_API_KEY --project estate-plan-generator` — use the file-based variant if PowerShell's interactive prompt swallows the paste:
   ```powershell
   $key = Read-Host "Enter PAGEINDEX_API_KEY" -AsSecureString
   $plain = [System.Net.NetworkCredential]::new("", $key).Password
   $tmp = [System.IO.Path]::GetTempFileName()
   [System.IO.File]::WriteAllBytes($tmp, [System.Text.Encoding]::ASCII.GetBytes($plain))
   firebase functions:secrets:set PAGEINDEX_API_KEY --data-file $tmp --project estate-plan-generator
   Remove-Item $tmp -Force; Clear-Variable plain, key
   ```
3. Redeploy the 4 PageIndex-consuming functions:
   ```powershell
   firebase deploy --only "functions:default:ragChat,functions:default:ingestDocument,functions:default:pageIndexClientFilesChat,functions:default:backfillPageIndexFirmId" --project estate-plan-generator
   ```
   (Codebase qualifier `default:` is required because `firebase.json` declares two codebases — `default` and `backfill`.)
4. Smoke-test admin chat — Client Files section in the right-panel citations should now populate after a question that hits indexed client files.

**`ingestDocument` region migration closed 2026-05-06.** Was deployed in `us-central1` while the frontend (`src/config/firebase.ts:88`) calls `getFunctions(app, 'us-east1')` — meaning **the upload path was effectively broken in production**. Added `.region('us-east1')` to `functions/src/ingest-document.ts`, deleted the orphaned `us-central1` instance, and redeployed to `us-east1`. All 4 RAG functions now confirmed in `us-east1`. ✅

### 3b. ✅ Generation UX improvements — deployed as PRs #7, #8, #9 (2026-05-05)

- **PR #7** — NJ POA `ACKNOWLEDGMENT` block now recognized as a valid Notary Block by the structural validator. Patterns: `acknowledg.*oath`, `) ss:`, `commission expires`. Prevents false-positive `needs_review` status on NJ POAs.
- **PR #8** — Hybrid template augmentation switched from `claude-sonnet-4-6` → `claude-haiku-4-5-20251001`. ~2.5× faster for the structure-preservation step (the step that matters most for latency UX). Quality is maintained since the task is structure/bracket-preservation, not creative drafting.
- **PR #9** — "Generate Estate Plan Documents" dialog now shows a checkbox list; attorney can select a subset to generate without regenerating the whole package. Defaults to all-checked (unchanged behavior). Married-couple pairs expand to per-role rows. **Hosting redeployed 2026-05-05** (laptop build + `firebase deploy --only hosting`).

### 3c. ✅ Dependency vulnerability sweep — closed 2026-05-05 (commit `b80509d`)

`npm audit fix` (semver-safe, no `--force`) brought us from 13 vulnerabilities (7 moderate, 5 high, 1 critical) → 2 non-exploitable moderate. Patched: `dompurify`, `vite`, `postcss`, `protobufjs` (critical RCE), `@xmldom/xmldom`, `hono`, `@hono/node-server`, `path-to-regexp`, `picomatch`, `brace-expansion`, `flatted`. Tests: 589/589 still passing. Build clean.

Remaining 2 moderate: `uuid <14` direct + transitive via `gaxios`. Advisory only triggers when caller passes a `buf` argument to `uuid.v3/v5/v6` — we don't, anywhere. `--force` upgrade would bump `gaxios`/`firebase-admin` majors for zero real exposure; left as-is.

### 4. POA smoke test (deferred from 2026-05-05)

The POA template is what changed most heavily in PR #1 (single-string address rendering, removed orphan `city/state/zip` placeholders). We validated the Will path end-to-end on deploy; POA needs the same. ~2 minutes. Generate a POA for any client with a fiduciary that has a name + address — confirm the `residing at <full address>,` line renders cleanly without phantom blanks.

### 5. Missing-address admin banner spot check

Open any client dashboard for a client who has at least one fiduciary named on file but no address (likely several pre-deploy clients qualify). Confirm the amber **"Missing fiduciary addresses: [slot list]"** banner shows up. ~1 minute.

---

## 🛠 Mid-term projects

### Wills → PageIndex ingestion pipeline — started 2026-05-05

**PR:** #4 merged | **Runbook:** `/docs/RUNBOOK.md` (paste into session to resume)

**Status: Phases 1–3 on main. Pre-flight required, then STOP GATE 3, then STOP GATE 4 before Phase 4.**

Phases shipped (all on main):
- **Phase 1** — `wills-schema.ts` (all types), Firestore rules/indexes, `functions/tsconfig.json` fix
- **Phase 2** — Full 10-step Document Processor: kill switch → cost circuit breaker → Drive fetch → text extraction (mammoth/pdf-parse) → folder-path parser → Haiku 4.5 classify → Sonnet 4.6 extract → Firestore write → PageIndex upload → audit log
- **Phase 3** — Drive watcher (`willsDriveWebhook`, `willsDriveWatchRenew`, `willsSetupDriveWatch`) + backfill orchestrator (`willsStartBackfill`)

---

#### Pre-flight checklist (one-time infrastructure — do before any deploy)

- [x] `ANTHROPIC_API_KEY` — real key in Secret Manager (rotated 2026-05-06, see item 3)
- [ ] `PAGEINDEX_API_KEY` — replace placeholder with real key (still pending — see item 3)
- [ ] `gcloud pubsub topics create wills-document-processing --project=estate-plan-generator`
- [ ] `gcloud services enable pubsub.googleapis.com cloudscheduler.googleapis.com drive.googleapis.com --project=estate-plan-generator`
- [ ] Create a service account with **Drive Viewer + Pub/Sub Publisher + Firestore User** roles
- [ ] Share Drive folder `1TuJOw7hy4xKm6EJeyFb5IYS4I6eoVk-j` with the service account (Viewer)
- [ ] Set `pipeline_state/control` in Firestore: `{ enabled: true, mode: "live", firmId: "<elias-counsel>", daily_spend_usd: 0 }`

---

#### STOP GATE 3 — Test the Document Processor (Phase 2) in isolation

**Do this before running the Drive watcher or backfill.** It confirms the 10-step pipeline works on a real file.

1. Deploy the processor only:
   ```
   firebase deploy --only functions:willsProcessor --project=estate-plan-generator
   ```
2. Pick any `.docx` or `.pdf` already in the Drive folder. Note its file ID (visible in the URL when you open it in Drive: `https://drive.google.com/file/d/<FILE_ID>/view`).
3. Publish a single test message via Cloud Console or gcloud:
   ```
   gcloud pubsub topics publish wills-document-processing \
     --project=estate-plan-generator \
     --message='{"drive_file_id":"<FILE_ID>","drive_path":"Smith, John","file_name":"TestWill.docx","mime_type":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","file_size_bytes":50000,"created_time":"2026-01-01T00:00:00Z","modified_time":"2026-01-01T00:00:00Z","event_type":"new","source":"backfill"}'
   ```
4. Watch logs: `firebase functions:log --only willsProcessor --project=estate-plan-generator`
5. Confirm success in Firestore → `wills_documents/<FILE_ID>`:
   - `processing_status` = `"indexed"`
   - `document_type` looks correct for the file you chose
   - `type_fields` populated with extracted metadata
   - `pageindex_doc_id` is not null
   - `pageindex_docs/work-product/files/<doc_id>` document exists

If `processing_status` = `"error"`, check `processing_error` field and logs before proceeding.

---

#### STOP GATE 4 — End-to-end Drive watcher + backfill (Phase 3 validation)

After STOP GATE 3 passes:

1. Deploy all wills functions:
   ```
   firebase deploy --only functions:willsProcessor,functions:willsDriveWebhook,functions:willsDriveWatchRenew,functions:willsSetupDriveWatch,functions:willsStartBackfill --project=estate-plan-generator
   ```
2. Note the `willsDriveWebhook` HTTPS URL from the deploy output (looks like `https://us-east1-estate-plan-generator.cloudfunctions.net/willsDriveWebhook`).
3. From an admin-role Firebase account, call:
   ```js
   willsSetupDriveWatch({ webhookUrl: "<willsDriveWebhook URL>" })
   ```
   Confirm `pipeline_state/drive_sync` in Firestore is populated with a channel ID and expiry.
4. Drop a test `.docx` into the Drive folder. Within ~30 seconds, confirm `wills_documents/<file_id>` appears in Firestore.
5. Call `willsStartBackfill()` from admin. Watch `pipeline_state/backfill_progress` tick up. Confirm all existing Drive files are queued and processed.

---

#### Phases remaining

- **Phase 4** — 30-doc synchronous pilot harness with acceptance-criteria report (agent task; start new session after STOP GATE 4 passes)
- **Phase 5** — Full backfill — **DO NOT START until:**
  - [ ] Adam reviews type-specific interfaces in `wills-schema.ts` against `Wills_Metadata_Schema_v1.0.docx` (field groups are currently DRAFT)
  - [ ] Few-shot PLACEHOLDER blocks in `wills-extractor.ts` (§8.3) replaced with real examples
- **Phase 6** — Multi-user + paralegal access, audit log review UI

#### Locked decisions (do not redesign)

- PageIndex namespace = `work-product`
- Classification model = `claude-haiku-4-5-20251001`
- Extraction model = `claude-sonnet-4-6`
- Full-document context (no chunking)
- Tool-use API for strict JSON output (not `callAI()`)

---

### RAG vs PageIndex pricing — revisit with screenshot (deferred 2026-05-05)

Adam sent a screenshot of PageIndex pricing during the session but it was skipped before context compaction. **Next session: paste the screenshot and reconcile against the cost estimates given** (~$0.005–0.015/call for PageIndex vs ~$0.0000035/Vertex embed). If the actual pricing tier is materially different, update the cost note in item 3 above and re-evaluate whether the two-stack architecture is justified.

---

### ✅ RAG-chat graceful-degradation when Anthropic streaming fails — closed 2026-05-06

**Resolution.** Both `rag-chat.ts` and `pageindex-client-files-chat.ts` now wrap the Anthropic `messages.stream()` block in a try/catch and fall back to non-streaming `callAI()` (forced OpenAI via `model: 'gpt-5.4'`) when the stream throws **before any chunk has been emitted**. Mid-stream failures still bubble to the outer error path, since previously-flushed SSE chunks can't be unsent.

- New secret binding `OPENAI_API_KEY` added to both function configs; service account auto-granted `secretAccessor` on first deploy.
- `firmData` loaded from Firestore (`firms/{firmId}`) on fallback; `OPENAI_API_KEY.value()` is layered in as a default if the firm hasn't configured its own OpenAI key.
- Degradation events log as structured one-liners — search Cloud Logging for `[ragChat-degradation]` or `[clientFilesChat-degradation]` to count fallback frequency.
- 589/589 root tests still pass; functions tsc clean. Both functions redeployed to `us-east1`.

**Long-term option (still parked).** Building a true `callAIStream()` adapter in `ai-client.ts` that normalizes streaming across providers is ~2-3 days. Only worth it if Anthropic outages become frequent enough that the all-at-once fallback feels slow, or we want streaming for cost/latency reasons.

---

## 🅿️ Parked decisions (revisit on a trigger, not speculatively)

### ✅ Gemini Embedding 2 upgrade — superseded by Vertex migration (2026-05-05)

This decision was pre-empted: Google revoked free-tier access to `gemini-embedding-001`, forcing the migration to Vertex AI `text-embedding-005` (PR #5, short-term item 2). The migration is complete — Vertex is now live with service-account auth, and all 54 KB resources + 11 templates are re-embedded. The "upgrade vs. stay" question is no longer relevant; we're already on Vertex.

**Upgrade to `text-embedding-005` → `text-embedding-006` (future):** park until Google publishes MTEB scores showing ≥10% retrieval improvement for English legal text. Migration would be a model-constant swap + full `backfillEmbeddings` run — the Vertex auth plumbing is already in place.

---

## ⏭ Next session — re-verify after deploy

**Tonight's verification (2026-04-28 AM, session 3) found a long bug list,
shipped 4 batches of fixes (commits `7bf4bb2` + `2cb994e`), and patched 9
templates in Firestore. Engine-side code changes need a cloud deploy of
`generateDocuments` + `generateSingleDocument` before re-running the
checklist. After deploy, regenerate Karen + Adam packages and confirm:**

1. **Karen's POA / AD primary HCR** renders full `93 Old Church Road, Monroe
   Township, NJ` (was truncating to street only).
2. **Karen's POA "Gifts to Husband"** heading (was "Gifts to Wife" — wrong).
3. **Adam's spouse-swap Will** uses `Testator` not `Testatrix` in the three
   notarial paragraphs.
4. **Adam's AD successor HCR** reads `I appoint my Brother, ROGER KONDOS,
   of [MISSING: alternate healthcare proxy address]` (was empty + wrong
   POA-tier label).
5. **Both Wills** have empty 2nd/3rd successor executor paragraphs replaced
   with `[MISSING: successor executor name/address]` instead of "I appoint
   , of, to serve". Same for empty trustee + guardian slots in Articles
   VIII / XI.
6. **Typography sweeps**: `JR.` (no double period), `, NJ, as` (space after
   comma), `(050422014) Attorney` (space after paren), `ARTICLE XII No
   Contest` (space between).

Items still to verify from the original 2026-04-27 checklist (not yet done):
- **Item 3**: Editor toolbar Regenerate button — appears, picks up `_spouse`
  suffix from doc id, produces matching output.
- **Item 4**: Vault top toolbar — `Generate Individual Document` is a
  top-level button, dialog shows Karen / Adam-spouse toggle for married.

Phase-2 (shipped same session): optional `gender` select added to all 10
fiduciary slots in the questionnaire — guardian primary/alternate, executor
primary/alternate, trustee primary/alternate, POA agent/alternate-agent,
healthcare agent/alternate-agent. Field is `'male' | 'female' | ''`,
defaults to blank. The pronouns resolver already prefers an explicit
gender over the relationship-inference fallback, so populating the field
overrides the inference for ambiguous relations (Parent/Child/Sibling/
Friend/etc).

---

## Completed (2026-04-28 AM, session 3 — verification + batch fixes)

User uploaded all 6 generated docs (Karen + Adam Will/POA/AD); diffed
against the verification checklist. Most items passed but six categories
of bugs surfaced and were fixed.

- **Batch A (`7bf4bb2`)** — `cleanEmptyListSlots` extended with 6
  `[MISSING: ...]` injection regexes for empty 2nd/3rd successor executor,
  empty trustee primary, and primary/alternate/successor guardian slots.
  Marker injection runs BEFORE the comma/space collapse so the patterns
  aren't pre-mangled.
- **Batch D (`7bf4bb2`)** — new `typographyCleanup` pass: `JR..` → `JR.`,
  `,letter` → `, letter`, `)Capital` → `) Capital`, `ARTICLE XII<word>` →
  `ARTICLE XII <word>`. Segment-walker preserves tag attributes.
- **Batch B (`2cb994e`)** — `fix-poa-address-composite.cjs` patched 7 IL
  templates to expand bare `{{...address}}` into the full
  `{{address}}, {{city}}, {{state}}` composite. Upload-prompt rule #16
  added to forbid bare-address future re-uploads.
- **Batch C (`2cb994e`)** — new `normalizeTestatorTitle` pass keys off
  `clientPronouns.subject` (he → Testator, she → Testatrix). Replaces
  the wrong form globally. Plus extended `normalizeSpouseTitles` with a
  `Gifts to {Wife|Husband|Spouse|Partner}` heading rewrite.
- **Batch E (`2cb994e`)** — `fix-hc-template-paths.cjs` patched 2 IL HC
  templates: (1) `healthcareProxy.alternate.X` → `.alternateAgent.X` (data
  is at `.alternateAgent`, not `.alternate`); (2) the IL HC author had
  mis-routed the successor HCR address through `powerOfAttorney.
  alternateAgent.{address,city,state}` — re-routed to
  `healthcareProxy.alternateAgent.{address,city,state}`. Upload-prompt
  AVAILABLE_FIELDS docs in `process-template-file.ts` and
  `retemplatize-templates.ts` corrected.
- **Phase-1 AIF/HCR pronouns** (post-batches commit pending) — added 8 new
  computed pronoun fields to `ClientContext.computed`:
  `poaAgentPronouns`, `poaAlternateAgentPronouns`, `healthcareRepPronouns`,
  `healthcareRepAlternatePronouns`, `executorPronouns`,
  `executorAlternatePronouns`, `trusteePronouns`,
  `trusteeAlternatePronouns`. Resolution priority: explicit `gender` field
  on fiduciary → spouse-relationship + spouse pronouns → gendered family
  relation (Mother/Father/Sister/etc → female/male) → neutral. Spouse-swap
  path in `unified-generator.ts` recomputes all 8 fields after the swap.
  `fix-aif-pronouns.cjs` patched 2 active POA templates to swap
  `{{clientPronouns.possessive}}` / `{{spousePronouns.possessive}}` for
  `{{poaAgentPronouns.possessive}}` in the "Restriction on Authority"
  sentence. Upload prompts (`process-template-file.ts` and
  `retemplatize-templates.ts`) updated to teach the AI which pronoun
  source belongs to which fiduciary subject.
- **Verification harness extras**: 5 inspection scripts added
  (`inspect-ad-template.cjs`, `inspect-poa-template.cjs`,
  `inspect-poa-deepak.cjs`, `inspect-deep-fid.cjs`, `inspect-saved-ad.cjs`)
  for Firestore-side template + saved-doc + fiduciary-data inspection.

Tests: 589 passing throughout. **Cloud deploy still pending** — Firestore
template patches are live but engine code changes (`cleanEmptyListSlots`,
`typographyCleanup`, `normalizeTestatorTitle`, expanded `normalizeSpouseTitles`)
need `generateDocuments` + `generateSingleDocument` redeployed.

---

## ⏭ Old verification block (2026-04-27 evening, session 2) — superseded

Tonight's session ended after a long sequence of generation-pipeline fixes
landed but were not all hand-verified by the user. **First action next session:
regenerate the wills/POAs/ADs for both Karen and Adam and confirm each item
below renders correctly.** If anything looks off, the relevant fix is listed
in the "Tonight's session 2" block further down — point at the symptom and
we'll diagnose from there.

Manual verification checklist:
1. **Karen — full package** (her vault, generationMode=Template):
   - Will: name `<strong>KAREN K. ELIAS</strong>` bold + uppercase throughout
     (title, body, executor block, witness, notary)
   - Will: children list reads `ADDISON, ALINA, and ADAM JR.` (Oxford comma + "and")
   - Will: no trailing blank fourth child
   - Will: no `ARTICLE I —` em-dash; just `ARTICLE I `
   - Will: Article X heading is centered (was misclassed as `tr-art2`)
   - Will: Article III subheaders title-cased: `If My Husband Survives.` not
     `If my husband Survives.`
   - POA: primary agent (Adam, Husband) renders address `93 Old Church Road,
     Monroe Township, NJ` (auto-fill from spouse-shared household)
   - POA: alternate (Roger, Brother) renders `[MISSING: alternate POA agent
     address]` (correct — Roger isn't household)
   - AD (livingWill): generates without hanging or gender errors (the stored
     template's pipe-syntax bug was hand-fixed in Firestore tonight; upload
     prompt now forbids it for future re-uploads)
   - All saved docs have `templateBaseline` populated → editor's Compare
     mode is available on every doc, not just AI-enhanced hybrid ones
2. **Adam — full package via `spouseRole='spouse'` from Karen's vault** (his
   own client doc has empty `fiduciaries: {}`, so spouse-swap is the working
   path):
   - Will: title and body show `<strong>ADAM J. ELIAS</strong>` bold + uppercase
   - Will: spouse references read `my wife, KAREN K. ELIAS` (gender title
     correctly inverted from Karen's view of `husband`)
   - Will: "if my wife survives" / "if my wife does not survive" — not "my husband"
   - Will: no `Gender is required` error (swap-time gender backfill inverts
     Karen's `female` → `male` for Adam's testator slot)
   - Will: no blank address `, , ,` — swap-time address backfill copies the
     household address into Adam's swapped `personalInfo`
   - POA: agent is Karen (Wife) with full address — spouse-fiduciary remap
     swaps Karen's "Adam (Husband)" entry to "Karen (Wife)" on Adam's swap
   - AD: same — Karen as healthcare rep, full address
3. **Editor toolbar Regenerate button** — verify it appears on each doc, picks
   up the doc's spouseRole from `_spouse` suffix, and produces matching output.
4. **Vault top toolbar** — `Generate Individual Document` is a top-level button
   (not buried in a dropdown), and clicking it opens the dialog with the
   `Whose document?` Karen / Adam-spouse toggle when applicable.

If all of the above passes, mark this section complete and move to the open
items below.

---

## Completed (2026-04-27 evening, session 2 — generation-pipeline polish)

Continuation of session 1's work after the user re-uploaded 11 IL templates
fresh and began rapid-fire visual testing. Caught and fixed a long string of
mostly template-side and post-render issues. **All commits between `5a6377d`
and `4d74d45`** belong to this session. Tests still 589 passing.

### Verification harness — `functions/scripts/`
- `audit-il-templates.cjs` — per-template audit on 6 criteria. 11 active IL
  templates passed; 5 vestigial inactive duplicates flagged.
- `test-generate-one.cjs` — end-to-end generation against Karen + IL Will
  template, dumps content checks (inline styles, unresolved Handlebars,
  sample-name leakage, provenance fields).
- `test-export-parity.cjs` — feeds generated HTML through PDF + DOCX
  builders, audits the resulting DOCX XML for paragraph count, alignment,
  indents, fonts. Used to verify the `<TAGattribute=` malformed-tag fix.
- `test-save-and-provenance.cjs` — full vault round-trip: invokes
  `generateDocument`, reads saved Firestore doc, asserts all 8 provenance
  fields persist (generationMode, triggerSource, templateId,
  templateSourceCollection, softwareSource, promptVersion, currentVersion,
  content non-empty).
- `test-poa.cjs` — POA-specific verification of the spouse-as-fiduciary
  auto-fill (Karen's POA agent address rendering).
- `inspect-and-backfill-adam.cjs` — backfills missing personalInfo fields
  on a client doc from a paired client.
- `inspect-karen-fiduciaries.cjs` — dumps Karen + Adam fiduciary data
  shapes; surfaced the `relationship: "Husband"` (not "Spouse") that
  initially blocked the auto-fill.
- `sanitize-malformed-tags.cjs` — one-off Firestore cleanup for the
  `<pclass="...">` no-space malformed-tag bug (3 templates fixed).
- `fix-pipe-syntax.cjs` — one-off cleanup for the `{{path | helper}}`
  Liquid-pipe bug introduced by AI templatization (1 template fixed).

### Bug fixes — backend (`functions/src/template-engine.ts` + others)
- **Malformed `<pclass=` tags from AI templatization** (`5a6377d`):
  defensive sanitizer in `parseHtml` (DOCX export) + preventive sanitizer
  in `applyTemplateFormattingStyles` so future content can't ship with
  the bug. Three stored templates were fixed in Firestore. Pre-fix DOCX
  was rendering 7 paragraphs of a 91-paragraph will because the parser
  bailed on the first malformed tag.
- **Trailing empty children leaking into renders** (`c54d72b`):
  `buildTemplateData` filters child entries with no `name`. `hasChildren`
  derives from filtered list. Fixed `Addison, Alina, Adam Jr. and .`.
- **`templateBaseline` missing on most generation paths** (`c54d72b`): now
  saved on every return path of `generateFromTemplate` so the editor's
  Compare mode is always available, not just on AI-enhanced hybrid runs.
- **Alternate fiduciary addresses silently empty** (`c54d72b`):
  `markMissingFiduciaries` now flags missing addresses on
  alternate/successor/alternateAgent slots when the slot has a name set.
  `Roger Kondos, of , to serve` now surfaces as `[MISSING: alternate
  executor address]`.
- **Spouse-as-fiduciary address auto-fill** (`c54d72b` + `1bc0666`):
  `autoFillSpouseFiduciaryAddresses` copies testator's `personalInfo`
  household address into any fiduciary slot whose `relationship` is in
  `{Spouse, Husband, Wife, Partner, Domestic Partner}`. Initial release
  only matched literal `'Spouse'`; expanded after Karen's POA agent was
  found stored as `relationship: "Husband"`. Surname-share inference was
  briefly added then reverted as reckless (parents/adult children may
  share a surname without a household).
- **Article header em-dashes** (`a472802`): `stripArticleHeaderDashes`
  strips em/en/hyphen dashes after `ARTICLE [ROMAN]`.
- **Names not uppercase / not bold throughout document** (`a472802` +
  `bff42ab`): `uppercaseKnownNames` collects every person-name from the
  context (client, spouse, children, all fiduciary tiers, firm attorney,
  witnesses) and uppercases each occurrence in the body. Walks HTML in
  tag/text segments tracking `<strong>` depth — bare-text names get a
  fresh `<strong>` wrap, names already inside emphasis get just the
  uppercase. 11/11 KAREN, 8/8 ADAM occurrences bold + uppercase on
  Karen's regenerated will.
- **Empty `<strong></strong>` shells from missing fiduciary data**
  (`bff42ab`): `stripEmptyInlineTags` runs before the text cleanup so
  surrounding `, ,` patterns are visible to the regex passes.
- **Empty fiduciary tier paragraphs** (`bff42ab`): `cleanEmptyListSlots`
  text-segment regexes catch consecutive commas, "and ." trailing
  fragments, "appoint my ," / "appoint my and my [empty]" / "(my )"
  patterns. `I appoint my , [empty], to serve as Executor` collapses to
  `I appoint to serve as Executor`.
- **Missing "and" before last name in lists** (`a03b9ff`): `insertOxfordAnd`
  rewrites 3+ comma-separated `<strong>` lists with Oxford comma + "and",
  and 2-name pairs with just "and" (no Oxford comma). Trailing "and "
  fragments at segment end stripped by cleanup.
- **Adam's will/POA gender title hardcoded** (`1bc0666`):
  `normalizeSpouseTitles` rewrites `my husband / wife / spouse / partner`
  (any case) to the testator-correct title from `ctx.computed.spouseTitle`.
  Catches IL-template hardcodings the AI templatization missed.
- **Article III subheader `If my husband Survives.` lowercase**
  (`0a70566`): same pass tracks `<strong>/<em>/<b>` depth; inside
  emphasis, full title-cases `If My Husband Survives.`. Generic
  mid-sentence `my husband` outside emphasis stays lowercase.
- **Articles IX/X lose centering** (`1bc0666`):
  `normalizeArticleHeaderClasses` detects `<p class=tr-art2>` paragraphs
  whose text starts with `ARTICLE [ROMAN]` and rewrites to `tr-art1`
  (centered). IL template misclassed Article X as tr-art2 (justified).
- **Spouse-swap missing fields → "Gender is required" + blank addresses**
  (`1bc0666`): when generating spouse's docs from primary's vault via
  `spouseRole='spouse'`, the swap copies `spouseInfo` (which lacks
  address+gender) into the testator slot. New backfill: missing
  address/city/state/zip/county/lastName copied from original primary;
  missing gender inverted (heteronormative default; left undefined for
  domestic-partnership where it can't be inferred).
- **Spouse-swap title/pronoun reflip** (`1bc0666`): `computed.spouseTitle
  / clientTitle / clientPronouns / spousePronouns` re-derived from new
  testator's gender so Adam's will doesn't say "my husband" referring to
  Karen.
- **Spouse-fiduciary remap on swap** (`0a70566`): when a fiduciary tier's
  relationship is in the household set, swap retargets the slot to the
  now-spouse — name replaced with original primary's full name,
  relationship inverted, address fields cleared so auto-fill repopulates
  with the new household. Without this, Adam's AD via spouse-swap
  appointed Adam as his own healthcare representative.
- **Stored AD template Liquid-pipe syntax** (`4d74d45`): function logs
  surfaced `Handlebars Parse error: ...alternate.name | childTitle`. AI
  templatization had emitted Vue/Liquid pipe syntax. `fix-pipe-syntax.cjs`
  scanned all 16 templates, fixed the 1 affected by dropping the pipe
  segment (childTitle is a field, not a helper). Upload prompt rule #15
  added to forbid pipes for future re-uploads.

### UX — frontend
- **Same as my address button** (`c54d72b`): on every `AddressField` that
  isn't the client's own personalInfo step, when the client has an address
  to copy. One click fills street/city/state/zip/county.
- **Spouse + children get address fields with the new button**
  (`c54d72b`): added `type: 'address'` composite to spouse step + children
  repeater (with new address-case in `RepeaterField.InnerField`).
- **Editor toolbar Regenerate button** (`3d15ff2`): one-click re-run of
  unified generator on the current doc. Snapshots edits as a version,
  infers spouseRole from the doc id's `_spouse` suffix.
- **Vault: Generate Individual Document surfaced as a top-level button**
  (`846af38` + `46baf63`): was buried in an "Additional Document"
  dropdown that users missed. The required `<SingleDocumentGenerator>`
  dialog mount in the populated-vault branch was added (it had only been
  rendered on the empty-vault branch — explaining "buttons dead").
- **Spouse-role selector on single-doc generation** (`14226f4` +
  `1418265`): married couples need separate wills/POAs. Dialog now shows
  Karen/Adam-spouse toggle when client is married AND docType supports
  per-spouse variants.

---

## Completed (2026-04-27 evening, session 1 — Phase 0–4 pipeline hardening)

Five-pass audit (Claude → Codex → cross-cutting synthesis → three verification probes)
produced a 17-item plan saved at
`C:\Users\adame\.claude\plans\propose-the-game-plan-polished-raven.md`.
All five phases shipped tonight. Tests: 589 passed (was 578).

### Phase 0 — Pre-reset gates (`e937599`)
Block-level fixes that had to land before re-uploading any template:
- **0.1 Handlebars array syntax**: process-template-file.ts:368 + :690 now teach
  the AI to emit `{{children.[0].name}}` (valid) instead of `{{children[0].name}}`
  (silently empty); loop-detection regex matches both forms for backwards-compat.
- **0.2 Style-map audit**: TEMPLATE_CLASS_INLINE_STYLES is now exported and adds
  `font-family:'Times New Roman'` to every class so DOCX export sees it without
  a body parent. tr-base min-height drift fixed (1em → 1.5em).
- **0.3 DOCX export honors inlined styles**: new inlineStyleToTrConfig() parses
  font-size/weight/decoration/transform/margin/text-indent/line-height from inline
  style attributes; wired into both classed-paragraph (override layer) and no-class
  fallback. Closes the PDF↔DOCX divergence — same source HTML now matches across
  both export pipelines.
- **0.4 True idempotency for applyTemplateFormattingStyles**: parseStyleString /
  serializeStyleMap / mergeClassStyleIntoExisting collapse multi-class duplicates
  on the first pass. New 11-test suite in
  `tests/unit/template-formatting-styles.test.ts` covers idempotency across
  multiple passes and AI mutations.
- **0.5 Composite index**: confirmed unnecessary — single equality on
  knowledgeBase.category is served by Firestore's auto-created single-field
  index. No change shipped.

### Phase 1 — Reach more documents
- **1.1 Per-property docs route through templates**: deed/affidavit/gitRep3 now
  attempt template resolution before falling back to AI. Per-property template
  Handlebars can read `{{property.address}}` etc. via additionalData.
- **1.2 Flex documents support templates**: callers can pass
  `generationMode: 'template'` / `'hybrid'` plus `templateId`/`softwareSource`/
  `formattingPreset` from generate-flex-document.ts. Falls back to AI when no
  flex template exists.
- **1.3 Dispatch logging**: `[unifiedGenerator] dispatch:` lines record
  template-vs-AI path per docType so we can audit template hit-rate after
  re-upload.
- **1.4 softwareSource is a hard requirement**: getTemplate returns null when
  softwareSource is set but no matching template exists — no silent
  cross-software fallback. Caller surfaces a structured error.

### Phase 2 — Provenance & metadata
- **2.1 Real generation provenance at save**: GeneratedDoc carries
  resolvedMode/resolvedTemplateId/resolvedTemplateSource/resolvedSoftwareSource;
  document-save-helper persists them plus triggerSource. Future fidelity
  reports answer "what produced this doc?" without replaying.
- **2.2 Fiduciary addresses are critical fields**: CRITICAL_LEGAL_FIELDS now
  flags missing executor/trustee/POA/proxy/guardian addresses. Generated docs
  show `[MISSING: executor address]` instead of silent blanks. Coordinate with
  open item #5 (questionnaire capture).

### Phase 3 — Robustness & cost
- **3.1 Bounded concurrency**: batch generation uses a 3-worker queue; replaces
  unbounded `Promise.allSettled` to prevent 20+ simultaneous AI calls on
  Fortress packages with spouse expansion + per-property docs.
- **3.2 KB context truncation in hybrid prompt**: 4K chars/resource and 24K
  total budget; logs when truncation fires.
- **3.3 Timestamp-aware deep clone**: replaces JSON.parse(JSON.stringify(...))
  in batch preload with cloneTimestampAware() that preserves Firestore
  Timestamp and Date instances. Closes silent date drift between single and
  batch generation.

### Phase 4 — Cleanup
- **4.1 Carbone deleted**: 315 lines of orphaned dead code removed; carbone
  package dependency dropped.
- **4.2 high-fidelity mode removed**: pruned from GenerationMode union, request
  types, UI dropdown, and the unimplemented HttpsError throw site.
- **4.3 retemplatize metadata preservation**: retemplatize-templates.ts now
  preserves _sourceCollection / softwareSource / variant / isDefault / isActive
  / docTypes / tags / folder / complexity / learnedVariables / promptVersion /
  createdBy on update. Adds version increment + retemplatizedAt /
  retemplatizedBy / retemplatizeFidelityScore audit fields.

**Verification next**: see plan file's verification section. Upload one fresh
DOCX template, generate against Karen Elias, compare HTML preview / PDF export /
DOCX export for visual parity.

---

## Completed / Follow-up (2026-04-27 session — template fidelity)

**Problem investigated:** generated documents were not reliably replicating the
uploaded Knowledge Base / document-template formatting. The generator could find
and use templates, but formatting could flatten because uploaded DOCX templates
were converted to classed HTML (`tr-title`, `tr-body1`, `tr-art1`, etc.) and not
all render paths carried the CSS for those classes.

**Shipped tonight:**
- `36b5fbb` — improved template resolution in `functions/src/template-engine.ts`.
  Generator now falls back from `documentTemplates` to Knowledge Base
  `form_template` resources and the legacy `firms/{firmId}/templates`
  collection before falling back to AI.
- `a3f15f8` — added inline formatting preservation for uploaded-template
  classes. Fresh uploads, existing-template generation, and generated HTML now
  inline the known `tr-*` styles so formatting travels with the content.
- `6686a1b` — aligned `retemplatizeTemplates` with the same inline-formatting
  helper so retemplatized templates behave consistently with fresh uploads and
  generation.

**Cloud deploys completed:** `generateDocuments`, `generateSingleDocument`,
`processTemplateFile`, and `retemplatizeTemplates` in `us-east1`.

**Verification completed:** `npm.cmd run build` passed in `functions`, and
`npm.cmd test -- tests/unit/template-variable-extraction.test.ts` passed
(`46 passed`). `Templates directory not found` appears during build but does not
fail build or deploy.

**Recommended next validation path:** regenerate one document from an existing
uploaded template first. If formatting still looks flat, retemplatize that one
template only using `templateId` and preferably `dryRun: true` first. Existing
already-generated drafts will not update in place; regenerate them. Only remove
templates that are duplicates, wrong doc type, or visibly bad conversions after
single-template testing. See open item **#2D** for the Rizzo Living Trust
re-upload that this validation path most directly applies to.

---

## 🔲 #1 — Upload remaining software templates

Firestore now contains only 9 real InteractiveLegal templates covering:
- `will` (2), `poa` (2), `livingWill` (2), `pourOverWill` (2), `trust` (1)

These doc types have no template yet (AI generation fallback applies):
- `deed`, `affidavitOfConsideration`, `gitRep3`, `estatePlanSummary`, `questionnaireSummary`

When InteractiveLegal (or another software source) provides templates for these types, upload them through the Knowledge Base admin UI with the correct `softwareSource` set.

---

## 🔲 #2 — Data & settings fixes from template-fidelity investigation

Original four sub-items (A gender, B state, C firm fields, D Rizzo). A/B/C closed
2026-04-24; only D remains.

- ✅ **A — gender:** set on 22 real clients. 3 junk/test accounts
  (`Xidm…`, `CRMelendez`, `AdminAdmin UserUser`) left unset intentionally.
- ✅ **B — state:** batch-set `personalInfo.state = "NJ"` on 18 clients that
  were missing it.
- ✅ **C — firm fields:** verified populated on `firms/elias-counsel`
  (`attorneyName`, `witness1Name`/`Address`, `witness2Name`/`Address`).
- 🔲 **D — Rizzo Living Trust re-upload.** Retemplatization produced poor
  output (0 fiduciary paths, 80.5% structural fidelity, 81 HTML tags lost).
  Re-upload the source DOCX via KB admin UI and/or improve the templatize
  prompt for trust documents. Tracked in user's re-upload queue.

---

## ✅ #3 — Weekly digest infrastructure (closed 2026-04-24)

- Cloud Scheduler + Pub/Sub APIs verified enabled.
- Scheduler job `firebase-schedule-sendWeeklyDigest-us-east1` is ENABLED
  (`0 8 * * 1` America/New_York). First fire: Mon 2026-04-27 at 8am ET.
- Seeded `firms/elias-counsel.weeklyDigestRecipients` with
  `['adam@adameliaslaw.com', 'lori@adameliaslaw.com']`.

Firms with an empty or missing `weeklyDigestRecipients` array are silently
skipped — that's the opt-out mechanism.

---

## ✅ #5 — Questionnaire: fiduciary address capture (closed 2026-04-27)

Added a `type: 'address'` block (Google Places autocomplete + city / state /
zip / county breakdown via the existing `AddressField` composite) to each of
the five fiduciary steps in `src/types/questionnaire.ts`:
- `fiduciaries_executor`: primary + alternate
- `fiduciaries_trustee`: primary + alternate
- `fiduciaries_poa`: agent + alternateAgent
- `fiduciaries_healthcare`: agent + alternateAgent
- `children_guardian`: guardianPrimary + guardianAlternate (top-level paths)

Backend alignment in `functions/src/template-engine.ts`:
- `CRITICAL_LEGAL_FIELDS` paths now match the actual data shape — fixed
  `healthcareProxy.primary` → `healthcareProxy.agent`, added
  `powerOfAttorney.alternateAgent` and `healthcareProxy.alternateAgent`.
  Removed the guardian entry (lives at top-level `guardianPrimary`, not
  under `fiduciaries.guardian`).
- `markMissingFiduciaries()` updated: a "primary" slot is `level === 'primary'
  || level === 'agent'` (POA / HC use `.agent` as the primary tier name).
- `buildTemplateData()` now accepts a `{ markMissing: false }` opt-out used
  by `validateTemplateData()` so the validator reports raw missing fields
  rather than the post-marking placeholders.

Verification: 589 tests pass. End-to-end generation for Karen Elias surfaced
the new missing-marker logs (`fiduciaries.executor.primary.address`,
`fiduciaries.trustee.primary.address`, `fiduciaries.powerOfAttorney.agent.address`,
`fiduciaries.healthcareProxy.agent.address`) confirming the new paths reach
`markMissingFiduciaries`. Deployed: generateDocuments, generateSingleDocument,
generateFlexDocument, generateEstateDocument, processTemplateFile,
retemplatizeTemplates + hosting.

---

## ✅ LawPay / Charge-dialog fixes (closed 2026-04-24)

Full chain of fixes shipped while debugging Diana Doran's failed
2026-04-16 $750 charge and Karen Elias's $1 test charge.

- ✅ **Server-side** (`processDirectCharge`): pulls `personalInfo.{zip,
  address, city, state}` from the client doc and includes them in the
  `POST /v1/charges` body. Fails loud with a clear error if zip is
  missing on the client record.
- ✅ **CSP**: added `https://*.8am.com` to `script-src` and `frame-src`
  in `firebase.json`. AffiniPay rebranded to 8am.com and the new iframe
  domains were being silently blocked.
- ✅ **Dialog scroll containment**: added `max-h-[90vh] overflow-y-auto`
  to `DialogContent` so the dialog owns its scrollbar — Hosted-Field
  iframes can no longer scroll the page away from the Charge/Cancel
  buttons.
- ✅ **Hosted Fields readiness**: AffiniPay SDK wasn't flipping the
  aggregate `state.isReady` flag; the "Loading secure payment form…"
  spinner would hang forever. Readiness now falls back to per-field
  mount state (any field present with no error → ready).
- ✅ **Billing ZIP input**: AffiniPay requires `postal_code` at
  *tokenization* time, not just on the charge request. Added a Billing
  ZIP input below CVV in the Charge dialog, pre-filled from
  `personalInfo.zip`, passed as `postal_code` in the `getPaymentToken`
  formData. AVS now passes.

Verified end-to-end with a $1 charge on Karen Elias.

---

## ✅ #4 — Google Service-Account Key Rotation (closed 2026-04-24)

- Original flagged key `c059f6a5…` on `estate-plan-generator@appspot…` was
  already deleted by the time we checked.
- Audited both service accounts and deleted 4 stale user-managed keys on
  `firebase-adminsdk-fbsvc@…` (`6d07c0b6…`, `a185883e…`, `4cfe1976…`) and
  1 on `appspot` (`dc05f6c6…`). The in-use key `bdb5f41…` (local
  `service-account.json`) was left in place.
- Remaining user-managed key on `firebase-adminsdk-fbsvc@…`: `bdb5f41…`
  (working key). Remaining auto-rotating Google-managed keys untouched.

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
