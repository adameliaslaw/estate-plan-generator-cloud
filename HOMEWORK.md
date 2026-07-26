# Estate Plan Generator — Homework

Items requiring human action or decisions before the next agent session can proceed.

---

## 🔴 SESSION — 2026-07-26 (NJ inheritance-tax engine ported in from elias-estate-suite — 4 ITEMS NEED ADAM AT A DESK)

**TL;DR — The NJ Transfer Inheritance Tax engine now lives in this repo.** It originates in
`adameliaslaw/inheritnj`, was ported and gold-case-verified in `adameliaslaw/elias-estate-suite`
(`apps/inherit`), and was the only thing that repo had which this one lacked. That repo is now an
archive; development continues here. Three commits on branch `feat/nj-inheritance-tax-engine`:

1. **Engine** — `functions/src/inheritance-tax/` (engine, rule sets by date of death, strict
   validation, IT-R / IT-Estate / IT-EXT / L-9(A) form builders). Pure TypeScript: no Firebase, no
   Chromium. PDF rendering deliberately NOT ported — this repo already renders PDF via jspdf and
   DOCX via docxtemplater.
2. **Persistence** — `inheritance-tax-store.ts` (Firestore + HMAC audit chain, appended inside a
   transaction) and `inheritance-tax-review.ts` (save → compute → request review →
   approve/finalize → IT-R). NOT a port of the suite's Firestore adapter: that one caches in memory
   and writes behind, requiring `--max-instances=1`, which would mean stale reads and lost writes
   under Cloud Functions.
3. **Legal spec** — `docs/IT-R-SPECIFICATION.md`, the line-by-line decode of the State's IT-R
   instructions. It is *why* the figures can be trusted. Cite it by section before changing
   anything in the engine.

**Verified:** gold cases 25/25 reproducing the State's own worked examples to the cent —
**$558.71 / $191.43 / Class C $8,250**; full suite **774 passed**; `tsc --noEmit` clean in root and
`functions/`.

**Rules that must not be weakened:** the IT-R renders only from an **approved** checkpoint's frozen
snapshot (so an edit can never retroactively change a signed-off form); `approveInheritanceReview`
refuses a self-approval unconditionally, and `finalizeInheritanceReview` is a *separate*
requester-only act audited as `matter_finalized`, never `review_approved`; out-of-scope estate
structures (nonresident decedent, pre-2002 death, deductions exceeding the estate, non-pro-rata
apportionment) are **refused**, never estimated.

### ▶ NEXT (needs Adam at a desk) — do these in order

**1. Apply the three commits.** They are not in this repo yet — the agent session had read-only
access. Either approve the repo-push prompt in a Claude Code session, or apply the delivered bundle
from a terminal:

```bash
git fetch /path/to/nj-inheritance-tax.bundle \
  feat/nj-inheritance-tax-engine:feat/nj-inheritance-tax-engine
git checkout feat/nj-inheritance-tax-engine
npx vitest run && (cd functions && npx tsc --noEmit)   # expect 774 passed, clean
```

**2. Set the audit-chain signing key.**

```bash
firebase functions:secrets:set INHERITANCE_AUDIT_KEY
```

Any high-entropy value. The code **fails closed** without it rather than degrading to a plain
SHA-256 that anyone who can read the log could recompute. **Never rotate it once chains exist** —
a chain only verifies under the key that wrote it.

**3. Merge — then deploy the RULES by hand.**

Merging to `main` is enough for the code: `.github/workflows/firebase-functions-deploy.yml` and
`firebase-hosting-deploy.yml` auto-deploy functions and hosting on every push to `main` (CLAUDE.md
rule 5 — don't deploy those manually).

**Firestore rules are NOT covered by either workflow.** This branch closes
`/firms/{firmId}/inheritanceMatters/**` to the client SDK, and that change only takes effect when
you run:

```bash
firebase deploy --only firestore:rules
```

It matters: the stored record contains the decedent's SSN, the audit chain is append-only and
hash-linked, and a checkpoint's `status` **is** the approval gate — client write access would let a
matter approve itself.

⚠️ Because this touches `firestore.rules`, it is on the **Never-Break List** (CLAUDE.md rule 7):
it needs explicit sign-off before merging, not agent auto-merge.

**4. Rotate the exposed service-account key** *(independent of 1–3, and time-sensitive)*. Per
`AUDIT_HANDOFF.md` §1, a full GCP service-account JSON with private key was committed inside
`.gitignore` and, although `4c01354` removed it from the working tree, **history was never
rewritten** — it is still readable at commit `223bdeb`, and this repo is now public. Google Cloud
Console → IAM → Service Accounts → `estate-plan-generator@appspot.gserviceaccount.com` → Keys →
delete key id `c059f6a569611c0aa9f74fa93fe1d45707f36d21`, create a replacement. Then check that
account's usage logs, and decide whether to `git filter-repo` the history before the repo stays
public.

### It IS wired — here is what exists, and the one thing that still needs a human

**UI:** `src/pages/admin/InheritanceTaxPage.tsx`, routed at `/inheritance-tax`
(`ROUTES.INHERITANCE_TAX`), staff-only via `AppLayout allowedRoles={[...STAFF_ROLES]}`, with a
sidebar entry. It walks the whole flow: decedent + flags → personal representative → beneficiaries
and bequests → deductions → **Save → Compute → Request review → Approve | Finalize → Load IT-R**,
plus the audit trail with a live chain-validity badge. Each button unlocks only when the server
would allow it, and any edit clears the computation and checkpoint — mirroring the rule that a form
renders only from a frozen, reviewed snapshot.

**Service:** `src/services/inheritance-tax-service.ts` — `httpsCallable` wrappers, following
`client-service.ts`.

**Types:** `src/types/inheritance-tax.ts` — the input shape plus the enums. The relationship picker
is **grouped by tax class** (A exempt / C $25k then 11–16% / D 15–16% no exemption / E exempt),
because that field alone determines the class under N.J.S.A. 54:34-2 and a wrong pick produces
confident wrong numbers rather than an error. Bequest types are labelled by IT-R schedule
(A, B, B-1…B-4, C) so they reconcile against the form.

**Deliberately NOT built: any mapping from the estate-planning questionnaire.** A decedent is
almost always a new intake, not a former planning client, so the two data models are kept apart.
`saveInheritanceMatter` accepts an optional `clientId` for the occasional case where a planning
client has died — an association for cross-reference, not data sharing. Do not build a
questionnaire→IT-R importer on the strength of that field.

**What still needs a human:** a browser pass. `tsc -b`, `npm run lint` (0 errors) and
`npm run build` are green, and the 774-test suite passes, but per CLAUDE.md rule 4 type-checks
prove the code, not the feature. Nobody has clicked through this page against a live Firestore.
Walk one matter whose answer you already know, end to end, before it touches a client file — and
expect the server to reject a malformed matter with a schema message rather than failing quietly.

### Where this came from — the source repo is archived

`adameliaslaw/elias-estate-suite` is **an archive as of 2026-07-26** and is no longer developed.
Do not open work there, and do not expect anyone to maintain the engine at its origin — this repo
is now the only live home for it. Its `docs/HOMEWORK.md` has the full account of what that
consolidation did and did not do (it moved one repo of four; this repo was named its centrepiece
and never opened). If the branch was delivered via that repo's `transport/nj-inheritance-tax-engine`
branch, that is why — the session that built this had read-only access here.

The engine's provenance chain is `inheritnj` → `elias-estate-suite/apps/inherit` → here, and the
gold cases came the whole way intact.

### Not carried over from the suite, on purpose
`apps/generator` (one document type — this app has 22), the standalone HTTP servers, CLI, web UIs,
the reviewer-invitation lifecycle, purge tooling, deployment manifests, `@elias/foundation` and
`@elias/canonical`. All of it was infrastructure for running the tax engine as a separate product.

---

## 📍 SESSION — 2026-07-15 (BL/BK/BM security batch + finding T shipped · #64 VALIDATED — 8.9-min functions deploy)

**TL;DR — Backlog session while the card test waits. (1) Security: PR #159 drained the round-2 leftovers — `linkClient` now requires a VERIFIED email to claim an existing client record (unverified password-signup takeover closed — same class as R5-010), checks the firm exists before minting claims, and rate-limits prospect stubs via the shared per-firm throttle; deliberate HttpsError codes rethrown (were flattened to `internal`); `getFirmBranding` only returns `googleMapsApiKey` to firm members (claim match, or linked client record for claimless anon questionnaire sessions). 9 new emulator tests (incl. the harness's first v1-callable mock), all negative-control-verified; suite 54/54. (2) **#64 validation COMPLETE:** #159 was the first `functions/src` merge since #155 — the deploy went green in 8.9 min (14:26→14:35Z), selective (only changed functions), far under the 20–40 min guess. The simplified CI path is proven end-to-end; #64 stays closed. (3) Finding T (PR #160): the OpenAI SDK path had a 5-MIN SOCKET timeout (openai 4.104 node runtime = node-fetch + agentkeepalive default agent; finding's undici-headersTimeout hypothesis was wrong, same 300s kill) — any >5-min OpenAI generation was impossible, retries died identically. `_callOpenAI` now passes a 10-min keepAlive `httpAgent`; dispatch untouched. Unit test + negative control. (4) Stale-ledger sweep: CR/CS/CW (truth-in-status trio) and DK/DP/DQ/DR/DM/H/V were ALREADY FIXED in main — rows corrected; the carry-forward list below is now accurate. Green: functions+root tsc, build, full lint 0 errors, unit 732/732, emulator 54/54.**

**Flagged residuals:** `process-ocr.ts`/`transcribe-audio.ts` still construct bare OpenAI clients (same latent 5-min cap — unobserved, fix if long Whisper jobs ever time out). BM remainder: App Check on `registerClientFromLink` (needs reCAPTCHA provisioning — Adam) + `willsDriveWebhook` channel-token model. DZ remainder: server-side `sum()` aggregation needs composite indexes (Never-Break, needs sign-off).

**▶ NEXT (needs Adam live): the card test** (see the 🔴 section below — PR #156 has been deployed since 7/09). Then: T2 browser pass (38 cases), or `willsDriveWebhook` token model, or App Check provisioning. Also: stale PR #21 (May 31 CLAUDE.md docs, fully superseded) — recommend closing unmerged.

---

## 📍 SESSION — 2026-07-09 PM #9 (JDK 21 installed · #64 root-cause fix shipped · AffiniPay selector fix shipped, AWAITING ADAM'S LIVE CARD TEST)

**TL;DR — Three items in one session. (1) JDK: Temurin 21.0.11 permanently installed via winget (machine PATH) — `npm run test:emulator` ran 45/45 locally; the portable-JRE-per-session dance is retired. (2) CI #64: read the firebase-tools 15.x hash source directly — the deploy hash is ONE sha1 over file CONTENT per codebase (mtimes never hashed; the old mtime plan was dead on arrival). Adam signed off the simplify path: PR #155 dropped the 16-batch serial convergence → rules → one full deploy → straggler pass → fail-loud gate (net −26 lines, timeout 330→120). First validating run: green in 4.2 min (workflow-only change → hash matched → all 80 skipped, proving CI-built source is hash-stable). #64 stays open until the next `functions/src` merge exercises the mass-update path (expect ~20–40 min green). (3) AffiniPay: root cause found in the official docs — `initializeFields` requires CSS selectors (`'#af-card-number'`) and we passed bare ids; iframe mounts but input never registers. PR #156 fixes all 4 selectors + gates Review on real `getState()` field errors + drops the dead `initAttempted` ref. Hypothesis-2 (wipe/re-init churn) deliberately NOT touched — one variable per live test. Green: tsc, build, full lint 0 errors, 731/731.**

**▶ NEXT (needs Adam live): test the card fix on prod** — Charge Payment → type `5466160519943714`, exp `04/2029`, CVV `212`, ZIP `08831` → watch console `[ChargePaymentDialog] Hosted Fields state:` for card `length: 16, luhn: true`. If still length 0, next single-variable iteration = remove the innerHTML-wipe/re-init effect. Then: T2 browser pass (38 cases) or close #64 after the next functions merge.

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

**➡️ UPDATE 2026-07-09 PM #9: fix candidate SHIPPED (PR #156, hypothesis 1 — `#`-prefixed CSS selectors, confirmed against the official AffiniPay guide) + a Review-gate on real field state. AWAITING ADAM'S LIVE CARD TEST (see the PM #9 session entry above for the test script). If it fails, next iteration = hypothesis 2 (remove the innerHTML-wipe/re-init effect) in isolation. The diagnosis below remains the reference.**

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

## ✅ CI functions-deploy root-cause fix (issue #64) — RESOLVED & VALIDATED 2026-07-15

**➡️ FINAL UPDATE 2026-07-15: VALIDATION COMPLETE — section retained one cycle for the record, then delete. PR #159 was the first real `functions/src` merge since #155: the deploy ran green in 8.9 minutes (selective — only the changed functions redeployed), meeting the definition of done ("a functions merge deploys only its changed functions, finishes green in ~10 min"). #64 closed (Adam, 7/09) + validated. The guardrails below remain the standing rules — especially "never cancel a functions-deploy mid-run."**

**➡️ UPDATE 2026-07-09 PM #9: the plan below is SUPERSEDED. The mtime hypothesis was disproven by reading firebase-tools 15.x source (hash = one sha1 of file CONTENT per codebase; mtimes never hashed — the fan-out to all ~80 is intrinsic to a single codebase). Shipped instead: dropped the 16-batch serial convergence → one full deploy + straggler pass + fail-loud gate (Adam signed off; net −26 lines; timeout 330→120). First run green in 4.2 min (workflow-only change → all skipped → CI-built source is hash-stable). Guardrails below still apply — especially "never cancel a functions-deploy mid-run."**

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

2. **Remaining audit items (no open criticals; ledger `docs/AUDIT-findings.md`; carry-forward list rechecked against code 2026-07-15):**
   - **T9 — mostly done (#62).** Zod length caps shipped on all 6 callables; HTML-escaping shipped on all email senders. **Deferred half:** "server-resolve email recipients" (ignore caller-supplied `to:` address, look it up from clientId server-side) — Adam chose to skip it: callable-contract + frontend change for marginal gain post-T6 staff-gating. Revisit only if that residual matters.
   - **App Check** — `registerClientFromLink` is public; rate-limit shipped, App Check still unset (needs reCAPTCHA provisioning by Adam). Plus `willsDriveWebhook` channel-token model (BM remainder).
   - **DZ remainder** — payments `sum()` aggregation needs composite indexes (Never-Break, needs sign-off).
   - ~~Truth-in-status remainder CR/CU/CS/CW~~ and ~~medium cleanups DK/DP/DQ/DR/DM/H/V/AO~~ — **all verified fixed/wontfix in current main 2026-07-15** (stale ledger rows corrected). **T fixed (#160).** BL/BK fixed (#159).
   - Never-Break gate (explicit sign-off) applies to: `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `functions/src/templates/*.hbs`, `src/types/index.ts`, CI workflows.

3. **Standing watch-item (passive):** OAuth durability alert — silence = healthy (see AUTOMATIC ALERTS section below).

---

*Sessions from 2026-07-07 back to 2026-06-16 are archived in [HOMEWORK-ARCHIVE.md](./HOMEWORK-ARCHIVE.md) (moved 2026-07-09 to keep this file small — nothing deleted, full history in git).*
