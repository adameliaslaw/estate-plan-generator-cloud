# Estate Plan Generator — Homework

Items requiring human action or decisions before the next agent session can proceed.

---

## 📍 SESSION — 2026-07-09 PM #8 (R6-003–006 FIXED — Round 6 fully drained, all 6 findings closed same-day)

**TL;DR — Knocked out the four Round-6 ⚪s in one batch PR (#154, frontend-only, auto-merged). R6-003: template Enhance now recomputes `isLogicTemplate` (AI-injected `{{#each}}`/`{{#if}}` no longer corrupted by the WYSIWYG round-trip on save — flips to Source view like the load path). R6-004: template preview gained a "— No client —" clear row (the Combobox swap had removed the native select's empty option). R6-005: Copy Invite Link now writes the clipboard via `ClipboardItem` with a promise payload started synchronously inside the click (Firefox/Safari reject a post-await `writeText`); a copy-only failure surfaces the minted URL for manual copy instead of the false "Failed to create invite link". R6-006: the invite-link page waits for `auth.authStateReady()` and, if a signed-in non-anonymous user opens the link, shows guidance instead of silently replacing their session + re-pointing `linkedUserId` to a throwaway anon uid. Green: tsc -b, build, FULL lint 0 errors, 731/731 unit. Round 6 is now 6/6 fixed (2 🟡 #152/#153 + 4 ⚪ #154), all same-day as the audit.**

**✅ Shipped:** `TemplatePreviewDialog.tsx`, `TemplatePreviewPanel.tsx`, `ClientListPage.tsx`, `QuestionnaireRegisterPage.tsx`; REGRESSION-TESTS 4 new T2 cases (tally 88 rows) + changelog; AUDIT-findings R6-003–006 → fixed.

**▶ NEXT:** the T2 browser pass (38 cases, needs Adam/live app); CI #64 codebase-split (needs sign-off); or card-charge (needs Adam live).

---

## 📍 SESSION — 2026-07-09 PM #7 (R6-002 FIXED — KB all-partial import no longer invisible; both Round-6 🟡s closed)

**TL;DR — Fixed the second Round-6 🟡: KB bulk import gated its only list-refresh + toast on `result.processed > 0`, but the backend's `processed` excludes `partial` files whose resources ARE persisted — so an all-partially-OCR'd batch (>15MB scans) saved everything server-side while showing nothing, inviting duplicate re-uploads. Fix: `partial > 0` → warning toast + list refresh via a new `onRefresh` prop that does NOT close the dialog (the per-file "split this PDF" warnings — the R5-051 surface — stay readable); when full successes exist, `onSaved` refreshes as before (no double fetch). Green: tsc -b, build, FULL lint 0 errors, 731/731 unit. Frontend-only → PR #153, auto-merged. R6-001's #152 hosting deploy confirmed green — both 🟡s live. Round 6 remainder: 4 ⚪s (R6-003–006).**

**✅ Shipped:** `KBBulkImportDialog.tsx` (partial branch + `onRefresh` prop), `KnowledgeBasePage.tsx` (pass `fetchResources`), REGRESSION-TESTS R6-002 T2 case + tally 84 + changelog, AUDIT-findings R6-002 → fixed.

**▶ NEXT:** R6-003–006 ⚪s (small); or the T2 browser pass (34 cases, needs Adam/live app); or CI #64 codebase-split (needs sign-off).

---

## 📍 SESSION — 2026-07-09 PM #6 (R6-001 FIXED — editor stuck force-reload after regenerate)

**TL;DR — Fixed the more complex of the two Round-6 🟡s: `DocumentEditor`'s regen success path never cleared `forceReloadRef`, so when the regenerated snapshot landed before the callable resolved (the exact race the R5-022 fix targets), the flag stayed stuck and the NEXT autosave snapshot force-reloaded the editor — cursor jump + keystrokes typed during the save round-trip reverted and marked saved. Fix: `regenBaseVersionRef` version watermark — the backend regen save transactionally bumps `currentVersion` while the pre-regen editorContent flush doesn't, so the load effect clears the flag on consuming a snapshot with a higher version even mid-regen. Baseline is the session-high (`Math.max(document.currentVersion, currentVersionRef)`) so a just-clicked manual Save's in-flight snapshot can't clear it prematurely (would've been an R5-022 redux). Failure paths also reset the watermark. Green: tsc -b, build, FULL lint 0 errors, 731/731 unit. Frontend-only, not Never-Break → PR #152, auto-merged.**

**Traced safe:** flush snapshot mid-regen keeps forcing (R5-022 intact) · regenerated snapshot mid-regen clears (the fix) · post-`finally` clear unchanged · non-regen flows identical (baseline null) · known residual: a FAILED manual save immediately followed by regen degrades to pre-fix behavior (stuck flag, self-clears on next non-regen consume) — narrow, not worse than before.

**✅ Shipped:** `DocumentEditor.tsx` (watermark ref + gate), REGRESSION-TESTS R6-001 T2 case + tally 83 rows + changelog, AUDIT-findings R6-001 → fixed.

**▶ NEXT:** R6-002 (KB bulk-import all-partial refresh gate — the remaining 🟡, small); then R6-003–006 ⚪s or the T2 browser pass.

---

## 📍 SESSION — 2026-07-09 PM #5 (context-burn fixed + audit Round 6 — frontend delta, 6 findings, 0 critical)

**TL;DR — (1) Diagnosed the fast context-burn: HOMEWORK.md had grown to 283K chars (~75K tokens) and was re-read whole every session. Archived 7/07-and-older sessions to `HOMEWORK-ARCHIVE.md` (#150, docs-only) → 21K chars, ~70K tokens reclaimed per session. Secondary tax Adam can fix: ~11 account-level claude.ai connectors (Gmail, Trellis, Firecrawl, …) cost ~8–12K tokens/session — disable unused ones in claude.ai → Settings → Connectors. (2) Ran audit Round 6 per Adam's pick: 5 adversarially-verified subagents over the 37 `src/` files changed since Round-5 baseline `c29d310` (+3 never-audited new files). Result: 6 confirmed (0 🔴 / 0 🟠 / 2 🟡 / 4 ⚪) — R6-001–006 in `docs/AUDIT-findings.md`. The R5-fix wave held up; payments + questionnaire slices fully clean. Audit-only, no fixes applied.**

**The 2 🟡 (both incomplete-fix regressions):** R6-001 `DocumentEditor` regen success path never clears `forceReloadRef` → stuck flag force-reloads the editor on the next autosave snapshot (cursor jump, round-trip keystrokes lost). R6-002 KB bulk import: an all-partial OCR batch persists resources but `processed===0` → no toast/`onSaved()` → invisible until manual reload, duplicate re-upload risk.

**Stale-note corrections:** T1 `⬜ automate` backlog is fully drained (0 remain — the "4 unwritten" note in PM #2 was stale); audit round 4 was NOT pending (rounds 4+5 both done — memory corrected; this session = Round 6).

**▶ NEXT:** fix R6-001/R6-002 (small, contained); or the T2 browser pass (32 cases, needs Adam/live app); or CI #64 codebase-split (needs sign-off).

---

## 📍 SESSION — 2026-07-09 PM #4 (R5-048/049 chat generation-intent FIXED — context-aware confirm, Adam signed off)

**TL;DR — Fixed the two chat over-eager-generation findings. Adam chose context-aware confirm. R5-048: split user-intent into EXPLICIT (generate now) vs AFFIRMATIVE (bare "yes" generates only if the assistant's prior turn offered), added a negation guard (won't match "no-contest" mid-sentence), and made the message's doc type win over the dropdown. R5-049: removed the reply-SHAPE Strategy 2/3 so a long formatted explanation is never saved as a document / never replaces the attorney's answer — deliberate generation flows only through the explicit JSON action or the explicit user request. Pure `detectUserGenerationIntent`/`detectGenerationIntent`/`docTypeFromMessage` exported + unit-tested (`chat-generation-intent.test.ts`, 11). Green: functions tsc, root tsc, full lint 0 errors, 731/731 unit. Functions change (not Never-Break) → PR #149, auto-merged.**

**Known conservative edge (flagged):** "no, draft the trust instead" is suppressed by the leading-`no` negation guard even though it's a real request — safe direction (extra turn, never a surprise save); acceptable per the conservative lean.

---

## 📍 SESSION — 2026-07-09 PM #3 (R5-047 chat-history truncation FIXED — append-only, Adam signed off)

**TL;DR — Fixed the deferred R5-047 data-integrity finding: the AI chat's `saveConversation` overwrote stored history with the caller's ~20-message prompt window every turn, permanently truncating any longer conversation. Now append-only (stable per-message id + transactional dedupe-append); the 5 chat-ai call sites pass only the new turn. No client contract change needed — the server already knows the new turn. Verified green (functions tsc, root tsc, full lint 0 errors, 720/720 unit, 45/45 emulator incl. 4 new; negative-control-verified). Functions change (not Never-Break) → auto-merged.**

**Design decision (Adam picked append-only over server-delta / client-sends-all):** message ids are server-owned (randomUUID on save); the window is still built for the prompt + memory extraction but is NOT what gets persisted — only `allMessages.slice(resolvedHistory.length)` (the new turn) is appended. Title now set once at creation (the window-derived title drifted past 20 msgs). **Tradeoff flagged:** a very long conversation's doc grows toward the 1MiB Firestore limit — acceptable vs. silent truncation, far off for real chats; if it ever bites, move messages to a subcollection.

**✅ Shipped:** `ai-memory.ts` (append-only saveConversation + `id` on ConversationMessage), `chat-ai.ts` (5 call sites), `conversation-append.test.ts` (4), AUDIT-findings R5-047→FIXED, REGRESSION-TESTS case + changelog.

---

## 📍 SESSION — 2026-07-09 PM #2 (T4 blocked rows drained — R5-055/058/059/060/061 automated, all negative-control-verified)

**TL;DR — While the deploy converged, automated the five 🚫-blocked T4 rows with injected-failure emulator tests (7 tests, 3 files; emulator suite 41/41, unit 720/720, FULL lint 0 errors, tsc clean). Every test was negative-control-verified: run against the pre-fix code (pre-#111/#112 checkouts), exactly the regression assertions fail. T4 now has one open row (R5-050 — prod smoke). Also added CLAUDE.md rule 8 (never idle while waiting). Tally 37/81 🤖.**

**✅ Shipped:**
- **R5-058/059/060** `wills-processor-failure-paths.test.ts` (4): real Pub/Sub handler vs the emulator — corrupt `.docx` (real mammoth throw) → visible error record instead of a vanished file; injected Drive outage on a `modified` event → prior classified Will record PRESERVED (and with no prior record, an error record IS written); a real generated `.docx` classified (mocked classifier) as Correspondence takes the skip path and `daily_spend_usd > 0` after the handler resolves. Only Drive fetch + classifier mocked; mammoth/docx/Firestore real.
- **R5-061** `wills-backfill-stale-running.test.ts` (2): fresh `running` progress still rejects `already-exists`; a 20-min-stale one restarts (proven by reaching an injected googleapis failure and by `backfill_progress` reset to the new caller, closed `error`). googleapis fully mocked so ambient dev ADC can never reach real Drive.
- **R5-055** `calendar-sync-watermark.test.ts` (2): real `syncGoogleCalendar` with stubbed global fetch — injected 500 on `events.list` leaves `googleCalendarLastSyncAt` untouched; clean run advances it. Future `tokenExpiry` skips the OAuth refresh path.
- **Test-authoring notes:** v2 pubsub/scheduler triggers mock like https (both `lib/esm/...mjs` + `lib/...js` paths → return raw handler); `defineSecret` mocks via `firebase-functions/lib(/esm)/params`; pdf-parse still needs the `vi.hoisted` DOMMatrix polyfill; a REAL valid .docx fixture is one `Packer.toBuffer` away via functions' own `docx` lib.

**▶ NEXT:** T2 browser click-path pass (~29 cases) is the only bulk tier left; R5-050 + the 4 secrets-smoke cases need prod; T1 has 4 unwritten unit cases. Or start draining `docs/AUDIT-findings.md` frontend round 4.

---

## 📍 SESSION — 2026-07-09 PM (Adam signed off all 3 — #121 merged, emulator tests in CI, AS automated)

**TL;DR — Adam signed off the three pending items in one go. (1) PR #121 (R5-037 firm-scoped admin rules) merged after closing its emulator gap with live rules-engine tests — negative control proved the tests fail against the pre-fix rules. (2) `npm run test:emulator` wired into `firebase-functions-deploy.yml` (setup-java JDK 21 + emulator-jar cache) — 33 emulator tests now gate every functions/rules deploy. (3) AS automated via the new `@firebase/rules-unit-testing` devDependency. T3 tier fully automated; tally 32/81 🤖.**

**✅ Shipped:**
- **#121 merged** (`78353c7`): the R5-037 rules diff (43 firm-scoped `isAdmin()` → `isFirmAdmin`) plus `tests/emulator/firestore-rules-firm-admin.test.ts` (8 live rules tests: cross-firm admin denied on reads/writes/collection-group queries, own-firm admin intact, in-firm staff collection-group reads intact, paralegal AS block). `@firebase/rules-unit-testing@^5.0.1` added to root devDependencies. Verified: emulator 33/33, unit 720/720, tsc, eslint; behavioral checklist in the 7/06 PM #17 entry all ✓. Merge triggered hosting + functions deploys (rules auto-deploy in the functions workflow — the old "rules deploy is manual" note is stale).
- **CI wiring:** emulator tests run after the unit suite and BEFORE any deploy step in `firebase-functions-deploy.yml`; `firebase-tools` global install moved up to serve both. Trigger paths unchanged (tests-only pushes still don't deploy).
- **AS** rules half automated (same test file); UI half (hidden controls) remains T2.

**🔴 FOUND + FIXED: both deploy workflows had been failing at Lint since 2026-07-07.** The T1/T4 test batches (#129–#140) shipped 34 `no-explicit-any` lint errors across 9 `tests/unit/` files — those sessions linted only their own new files, never `npm run lint` (eslint .). Every hosting AND functions deploy since failed at the Lint gate: prod hosting was stale since #119, and **#121's rules never deployed** on merge. GitHub issues #142 (hosting) and #64 (functions, stale June issue) were open but unnoticed. Fixed all 34 (types-only, no test-behavior change; 720/720 + lint 0 errors), then workflow_dispatch'd both deploys. **Session rule going forward: run FULL `npm run lint` before merging any PR, not just eslint on the files you touched.**

**▶ NEXT:**
1. **Watch the first CI run of the new emulator step** (next functions push; this workflow-file change itself triggers one). If the emulator download or Java step misbehaves, the failure lands as a GitHub issue assigned to Adam.
2. **T4 blocked rows** (R5-055 calendar-sync watermark, R5-058/059/060/061 wills) — several become reachable with injected-failure emulator tests; or the **T2 browser** click-path pass (~29 cases).
3. **Install a JDK 21+ locally** (still no system Java — sessions keep re-downloading a portable JRE).

---

## 📍 SESSION — 2026-07-09 (T3 multi-tenant batch — R5-066 + R5-010 + AP/AQ/AZ/BA/BB green on the emulator harness)

**TL;DR — Automated 3 of the 4 T3 multi-tenant cases with the emulator harness: 22 new integration tests across 3 files, emulator suite 25/25 green, default suite still 720/720, tsc + eslint clean. Tests + docs only — no deploy. Tally 27→30 🤖.**

**✅ Shipped:**
- **R5-066** `tests/emulator/wills-cross-tenant-gate.test.ts` (8, both callables): Firm B admin → `permission-denied` with kill switch on OR off (no enabled-state leak); `control.firmId` unset → `failed-precondition` (fail closed); owner-firm admin passes the firm gate and hits the kill-switch check (proves passage without Drive); non-admin denied.
- **R5-010** `tests/emulator/register-client-claim-token.test.ts` (3): tokenless registration with the victim's exact name+email creates a NEW prospect stub (victim's `linkedUserId` untouched); invalid token → `not-found`; valid attorney-minted token claims + links the session.
- **AP/AQ/AZ/BA/BB** `tests/emulator/callable-firm-scope.test.ts` (11): `createFirmUser` — attorney can't mint admin, paralegal/client can't create at all, cross-firm admin denied; `listTemplates`/`getTemplateContent`/`searchKnowledgeResources` — Firm A admin targeting seeded Firm B data denied, NO-firm-claim caller denied (both admitted by the old predicate), same-firm positive control reads its own data. Gotcha: templates live at `firms/{id}/documentTemplates` (not `templates`).
- **Docs:** REGRESSION-TESTS.md — 3 rows ⬜→🤖, per-case Test entries, T3 harness note, tally 30, changelog.

**⚙️ Java reminder:** machine still has no system Java — this session used a fresh portable Temurin JRE 21 downloaded to the session scratchpad (Adoptium API zip → `PATH`). Install a JDK 21+ for a permanent local `npm run test:emulator`.

**▶ NEXT:**
1. **CI wiring for `test:emulator` still awaits Adam** (Never-Break workflow change — see 7/07 PM #2 entry). Ditto **PR #121 (R5-037 rules fix)** — still open AWAITING SIGN-OFF.
2. **Last T3 case `AS` (paralegal billing/settings)** is a firestore.rules check — the admin SDK bypasses rules, so it needs the `@firebase/rules-unit-testing` devDependency + a rules-layer test. Small, but it adds a root dep (package.json → hosting-CI trigger), so flag it when opening that PR.
3. **T4 blocked rows** (R5-055 calendar-sync watermark, R5-058/059/060/061 wills) — several become reachable with injected-failure emulator tests; or the **T2 browser** click-path pass (~31 cases).

---

## 🔴 START HERE NEXT SESSION — Card charge (AffiniPay Hosted Fields) is BROKEN, never worked

**TL;DR — The "Charge Payment" card flow has never worked. Confirmed by live browser inspection 2026-07-06: the AffiniPay card-number hosted field displays typed digits but never registers them with the SDK, so `getPaymentToken` always sees an empty card and throws "field validation errors." This is a real integration bug in `src/components/payments/ChargePaymentDialog.tsx`, not user input. Needs a focused fix session — I can't type into the cross-origin iframe from automation, so every fix iteration needs Adam to test live.**

**File:** `src/components/payments/ChargePaymentDialog.tsx` (hosted-fields init at `initializeHostedFields`, effect ~L333, config ~L275).

**Exact confirmed diagnosis (live, on prod estate-plan-generator.web.app):**
- Adam typed a full 16-digit test card (`5466160519943714`, 04/2029, CVV 212, ZIP 08831). The digits appear in the field visually, BUT **every** SDK state event still reports `af-card-number: {"error":"Input field is empty","length":0,"card":"","luhn":false}`. The CVV then reports `"Unknown card type"` (card type undetermined because card reads empty).
- `isReady` is **never** `true` in any state event — the UI sits on "Loading secure payment form…" and/or lets you submit an empty form.
- So the field iframe renders input but never syncs it to the SDK → `getPaymentToken({...})` tokenizes an empty card → `fieldGen_1.5.3.js errorFactory` throws `Error: field validation errors` (seen in `[ChargePaymentDialog] Charge error:` console).

**Ruled OUT (don't re-chase these):**
- Public key is fine: `lawPayPublicKey` present, len 24, prefix `m_x…` (valid AffiniPay merchant public key); `lawPayApiKeySet`/`lawPayMerchantIdSet` true.
- Iframes mount correctly: `#af-card-number` and `#af-card-cvv` each contain one visible iframe (`cdn.affinipay.com/hostedfields/1.5.3/field_1.5.3.htm`), sized 411×38 / 127×38, `pointerEvents:auto`. Focus events fire (`{"type":"focus"}` postMessages from the iframe).
- `configRequest` fires once per field (not looping) — handshake initiates.
- No console errors. CSS is benign (font/color/padding).
- **Amount unit is NOT a bug** — AffiniPay uses cents and the app sends cents (verified against AffiniPay docs; the Round-5 "100× critical" R5-001 was a false positive).
- Expiry format: separately fixed & shipped (#89) — `exp_month` padded to 2 digits, `exp_year` expanded to 4, + per-field error surfacing via `getState()`. Correct and live, but NOT the blocker here. Keep it.

**Ranked fix hypotheses for next session (compare our init to AffiniPay's current guide):**
1. **Selector format.** AffiniPay's hosted-fields sample uses a CSS selector — `{ selector: '#my_card_field_id', input: { type: 'credit_card_number' } }` — while our code passes the **bare id** `'af-card-number'` (no `#`). The iframe still mounts, but a selector mismatch is the prime suspect for "mounts but never registers input." ⚠️ The SDK echoes our bare selector back in state and DID mount the iframe, so flipping to `#af-card-number` might change mounting behavior — test carefully, don't blind-ship.
2. **Re-init churn.** The `open`-effect (~L341-352) does `el.innerHTML = ''` on the containers then re-`initializeHostedFields()` on `[open, paymentType, initializeHostedFields]` changes, while React owns those divs — can detach the iframe the SDK tracks. Move to a single clean init after the container is in the DOM; don't wipe/re-init.
3. **Honor real `isReady`.** Gate the Review/Charge button on the SDK's true `isReady` (the current `anyFieldMounted` workaround at ~L317-323 flips "ready" while the card field is still empty). Disable submit until ready so an empty form can't be sent.
4. Dead `initAttempted` ref (declared, reset, never set/checked) — remove or use it to guard double-init.

**Reference docs (AffiniPay/8am):** hosted-fields guide `developers.8am.com/collect/create-payment-form-hosted-fields`; reference `developers.8am.com/reference/hosted-fields-reference` (exp_month = 2-digit 01-12, exp_year = 4-digit, postal_code required); hosted payment-page params (amount in cents) `developers.8am.com/merchant/hosted-payment-pages.html`.

**Testing constraint (important):** browser automation CANNOT type into the cross-origin AffiniPay iframe (synthetic keystrokes land in the parent doc). So the fix loop is: edit → hosting deploy (~2-3 min, clean CI) → **Adam types the test card live and reports the `[ChargePaymentDialog] Hosted Fields state:` console log** (watch for card-number `length` going to 16 + `luhn:true` + `isReady:true`). Test card: `5466160519943714`, exp `04/2029`, CVV `212`, ZIP `08831`. Do NOT click Charge until the state shows the card captured.

**Note:** the "Paid" $1.00 records in Payments history came from Record Payment / the payment-page link, NOT this hosted-fields dialog — consistent with the dialog never having worked.

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

*Sessions from 2026-07-07 back to 2026-06-16 are archived in [HOMEWORK-ARCHIVE.md](./HOMEWORK-ARCHIVE.md) (moved 2026-07-09 to keep this file small — nothing deleted, full history in git).*
