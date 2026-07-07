# Regression Test Suite — Post-Audit Fix Verification

**Purpose.** Prove that every fix shipped in response to the codebase audit still works, and catch it the moment one regresses. This is the living record: **every future fix appends its own test case here, in the same PR that ships the fix** (see *The discipline*). If a case isn't here, the fix isn't done.

**Scope.** The 2026-07-06 Round 5 full re-audit (PRs #86–#120) plus the still-load-bearing criticals from rounds 1–4 (B19 three-function fix, `createFirmUser` lockdown, `sanitizeObject` cap, OCR strip, honest-success, paralegal capabilities, LawPay reconciliation). **80 cases total.**

**Approach (decided 2026-07-07).** Hybrid, automation-first: every mechanical/backend fix becomes an automated test (T1) that runs in CI on every push and never rots; hand-written click-paths (T2/T3) are reserved for the genuinely visual/interactive fixes. Manual + multi-tenant tests run **emulator-first** with a seeded second firm; a short **prod smoke list** covers the handful of things only the live deployment can prove.

**Reality check (2026-07-07).** Of 80 fixes, **only 7 have a real passing automated test today.** ~24 more are unit-lockable but the test isn't written yet (`⬜ automate`). ~31 are manual-UI, 4 are multi-tenant, ~10 are race/async/pipeline needing code-review or integration, and 2 are blocked. So this manual is mostly a **build list** (write the missing tests) as much as a run list.

---

## The discipline (how this stays alive)

1. **One fix = one case**, appended to the right tier **in the same PR** as the fix. Definition-of-done now includes "regression case appended."
2. **Write the expected result as the failure** — describe the exact thing that broke, so a green result means something.
3. **Prefer T1.** If a machine can observe it, write the test and file it T1. Only drop to a manual tier when it genuinely can't.
4. **Never silently delete a case.** Supersededd/removed → mark `RETIRED` with a reason.
5. **Date every manual run.** A case not run since its fix shipped is `⬜ unverified`, not `✅`.

## Tiers

| Tier | Meaning | How it runs | Who |
|------|---------|-------------|-----|
| **T1 — Automated** | Machine-observable; locked (or lockable) by a vitest test | `npm run test` in CI | Automatic once written |
| **T2 — Manual UI** | Observable in the browser, one login | Click-path vs the emulator UI | Adam / Claude-in-Chrome |
| **T3 — Multi-tenant / privileged** | Needs a 2nd firm, a role, or a token | Click-path/script vs emulator w/ seeded identities | Adam / Claude |
| **T4 — Race / async / pipeline** | Concurrency, fire-and-forget, no-coverage pipelines | Concurrency/integration test or code-review sign-off | Case-by-case |
| **Prod smoke** | Only the live deployment can prove it | Deliberate, post-deploy | Adam |

## Status legend

`🤖 automated` (real passing test, always current) · `⬜ automate` (T1, test not yet written) · `⬜ unverified` (manual case, not yet run) · `🚫 blocked` (can't run yet; reason noted) · `✅ verified` (manual case passed since the fix) · `RETIRED`

---

## Environment setup

### Emulator (T1 rules tests, T2, T3)

```bash
npm ci --prefix functions            # the suite imports functions/src — required first
firebase emulators:start             # Auth, Firestore, Functions, Storage
VITE_USE_EMULATORS=true npm run dev   # UI pointed at the emulator (separate shell)
```

**Seed data** (helper to be written at `tests/helpers/seed-regression.ts` with the first T3 case):

- **Firm A** = `firmA-test` (stands in for elias-counsel): one `admin`, `attorney`, `paralegal`, `client`; one seeded `Client` with generated documents + at least one prior version, one note, one calendar event, and (for specific cases) a 2-property real-estate client, a Drive-synced doc (`googleDriveSyncedAt` set), and a content-less/audio-only note.
- **Firm B** = `firmB-test` (the other tenant): one `admin`, one `Client`. For wills cases, set `pipeline_state/control.firmId = Firm A`.
- Cross-tenant tests assert Firm B cannot read/act on Firm A's data.

### Prod smoke list (live deployment only)

Short, deliberate, post-deploy — never bulk regression:

1. **`reviewDocument`** (R5-006) — run a real document review at a firm whose drafting model is Anthropic; confirm a verdict, no "Anthropic API key is missing" throw.
2. **`checkDocumentCompliance`** (R5-007) — run a compliance check; confirm a verdict, no "AI compliance check failed."
3. **AI-review 30k window** (R5-008/009) — review a >15k-char will; confirm the verdict references end-of-document content (execution/witness block), proving it saw past char 5,000.
4. **`sendWeeklyDigest`** (R5-015) — confirm the next scheduled run (or a manual trigger) sends, no "SendGrid not configured."
5. **Chat memory extraction** (R5-050) — send a qualifying chat turn (clientId set, ≥4 messages); confirm key-fact/note documents actually get written afterward.
6. **Real Gemini output** (R5-046) — for a Gemini firm, confirm generated prose is complete (multi-part concatenated, not truncated to part 0).

---

## Running order

1. **T1 first** — `npm ci --prefix functions` then `npm run test`. The `🤖` cases must stay green. Then work the `⬜ automate` backlog (write the missing tests).
2. **T2** — emulator + seeded Firm A, walk each click-path, record pass/fail + date.
3. **T3** — emulator + Firm A *and* Firm B, run the boundary checks.
4. **T4** — code-review sign-off or write the integration/concurrency test.
5. **Prod smoke** — after a deploy, run the 6-item list.
6. **Blocked** — skip; revisit when the blocker clears.

---

# Test cases

## T1 — Automated

### 🤖 Locked (real passing tests — must stay green)

#### `R5-004` · #94 · doc-content-integrity name-missing check · 🤖 automated
- **File:** `functions/src/doc-content-integrity-checker.ts`
- **What broke:** name/marital checks read a nonexistent path (`ctx.personalInfo.fullName`) instead of `ctx.computed.clientFullName`, so "client name missing" could never fire and a nameless doc shipped as `draft` not `needs_review`.
- **Step:** `npm run test -- doc-content-integrity-checker`
- **Expected (pre-fix failure):** a document HTML omitting the client's name passed the client-data section (`passed=true`).
- **Test:** `tests/unit/doc-content-integrity-checker.test.ts`

#### `R5-044` · #118 · Oxford comma between bold spans · 🤖 automated
- **File:** `functions/src/template-engine.ts`
- **What broke:** `insertOxfordAnd` inserted a spurious comma between legitimately space-separated `<strong>` spans; narrowed to truly-adjacent spans (the real missing-comma name-list bug).
- **Step:** `npm run test -- template-oxford-comma`
- **Expected (pre-fix failure):** two space-separated bold spans got a wrong comma between them.
- **Test:** `tests/unit/template-oxford-comma.test.ts` (4 tests)

#### `R5-045` · #120 · serializer per-property state bleed · 🤖 automated
- **File:** `functions/src/client-data-serializer.ts`
- **What broke:** real-estate serialization hardcoded `', NJ'`, ignoring `RealEstate.state`, so out-of-state property was presented to every generator as NJ.
- **Step:** `npm run test -- client-data-serializer`
- **Expected (pre-fix failure):** a property with `state:'FL'` serialized as "…, NJ".
- **Test:** `tests/unit/client-data-serializer.test.ts` (2 R5-045 tests)

#### `R5-042` · #110 · questionnaire-generator stored-XSS · 🤖 automated
- **File:** `functions/src/generators/questionnaire-generator.ts`
- **What broke:** the Questionnaire Summary interpolated client-controlled fields into vaulted HTML with no escaping — a client's `<script>` executes in the attorney's browser.
- **Step:** `npm run test -- questionnaire-generator-escape`
- **Expected (pre-fix failure):** generated HTML contained raw `<script>` from client fields.
- **Test:** `tests/unit/questionnaire-generator-escape.test.ts`

#### `R5-056` · #117 · email custom-template stored-XSS · 🤖 automated
- **File:** `functions/src/email-notifications.ts`
- **What broke:** `processCustomTemplate` interpolated caller-supplied variables into email HTML unescaped, bypassing the T9 escape fix for any firm with a custom template.
- **Step:** `npm run test -- email-escape-html`
- **Expected (pre-fix failure):** a `<script>` clientName landed raw in `bodyHtml`.
- **Test:** `tests/unit/email-escape-html.test.ts` (processCustomTemplate block)

#### `AF` · #47 · canonical client-data block not re-truncated at 5k · 🤖 automated
- **File:** `functions/src/ai-client.ts`
- **What broke:** `sanitizeObject` re-truncated the pre-serialized `_serializedClientData` at the 5,000-char cap, silently dropping legal input from every AI document. Cap lifted to 100k for those fields.
- **Step:** `npm run test -- ai-client-sanitize`
- **Expected (pre-fix failure):** a >5k `_serializedClientData` came back truncated with an ellipsis.
- **Test:** `tests/unit/ai-client-sanitize.test.ts`

#### `BT` · #50 · OCR stripEmpty before merge · 🤖 automated
- **File:** `functions/src/process-ocr.ts`
- **What broke:** a partial OCR scan wrote null/empty fields via `set(...,{merge:true})`, nulling existing client data. `stripEmpty()` now drops blanks before merge; skips the write when nothing was extracted.
- **Step:** `npm run test -- process-ocr-strip`
- **Expected (pre-fix failure):** a blank-returning scan overwrote populated client data.
- **Test:** `tests/unit/process-ocr-strip.test.ts`

### ⬜ To automate (unit-lockable; write the test, then it joins CI)

#### `R5-002` · #94 · packageType not forwarded to first-run generation · 🤖 automated
- **File:** `functions/src/generate-documents.ts`, `unified-generator.ts`
- **What broke:** the batch re-derived `packageType` from the stored client doc (defaulting `foundation`) instead of the requested value, so the first run generated every doc at the wrong tier (a fortress trust as foundation).
- **Step:** `npm run test -- unified-generator`
- **Expected (pre-fix failure):** `params.packageType='fortress'` on a `foundation` client doc used foundation downstream.
- **Test:** `tests/unit/unified-generator.test.ts` (R5-002 block) — mocks the generator; asserts it receives `params.packageType` over the stored value, and falls back to the stored value when params omits it.

#### `R5-003` · #94 · spouse-swap title/pronouns wrong for same-sex couples · 🤖 automated
- **File:** `functions/src/unified-generator.ts`
- **What broke:** spouse title/pronouns derived by inverting the new testator's gender, so a same-sex couple got "my husband … he/him" in prose while the fiduciary block said "Wife" — a self-contradictory instrument.
- **Step:** `npm run test -- unified-generator`
- **Expected (pre-fix failure):** Karen+Anna (both female) → `spouseTitle='husband'`, male pronouns.
- **Test:** `tests/unit/unified-generator.test.ts` (R5-003 block) — captures the swapped clientContext handed to the template engine; asserts `spouseTitle='wife'`, `spousePronouns.subject='she'` (derived from the primary's real gender).

#### `R5-005` · #94 · fortress trust prompt said "Revocable" · 🤖 automated
- **File:** `functions/src/generators/trust-generator.ts`
- **What broke:** the fortress prompt injected "JOINT Revocable Living Trust," contradicting the Irrevocable/Medicaid-protection label everywhere else — a revocable trust gives zero Medicaid protection.
- **Step:** `npm run test -- trust-generator-fortress`
- **Expected (pre-fix failure):** `packageType='fortress'` produced a "Revocable" prompt (the "JOINT Revocable Living Trust" note).
- **Test:** `tests/unit/trust-generator-fortress.test.ts` (3 tests) — captures the user prompt via a mocked `callAI`; asserts the fortress branch emits "IRREVOCABLE"/"do NOT make it revocable", never the pre-fix note, and foundation injects neither.

#### `R5-013` · #94 · esign webhook accepts mismatched signature_request_id · ⬜ automate
- **File:** `functions/src/esign-service.ts`
- **What broke:** the webhook never compared the payload's `signature_request_id` to the doc's stored id (HMAC covers only event_time+type), so a stale/foreign request could flip the wrong doc's status or pull a signed PDF into another client's vault.
- **Test to write:** the handler rejects an event whose id ≠ stored id before any write. (`tests/unit/esign-hmac.test.ts` covers HMAC only.)
- **Expected (pre-fix failure):** a foreign `signature_request_id` event was applied.

#### `R5-014` · #94 · esign resend reuses prior signed PDF · ⬜ automate
- **File:** `functions/src/esign-service.ts`
- **What broke:** re-sending a signed doc never fetched the new executed PDF — the merge preserved `signedStoragePath` and `storeSignedPdf`'s idempotency guard short-circuited, so the vault kept the superseded v1 signed PDF.
- **Test to write:** `sendForSignature` clears `signedStoragePath`/`signedFileName`/`signedAt` on resend.
- **Expected (pre-fix failure):** resend left `signedStoragePath` set → new PDF never stored.

#### `R5-016` · #94 · process-ocr extraction schema mismatch · ⬜ automate
- **File:** `functions/src/process-ocr.ts`
- **What broke:** the OCR schema wrote wrong-shaped fields (`dateOfBirth`/`ssn4`, nested address map, `children[{fullName…}]`) vs the canonical model, so a merge turned the string address into a map (POA rendered `[object Object]`) and wholesale-replaced the children array. (Distinct from BT above.)
- **Test to write:** extracted objects match canonical `PersonalInfo`/`Child` field names. (`process-ocr-strip.test.ts` covers only `stripEmpty`.)
- **Expected (pre-fix failure):** `personalInfo.address` came out a map; children lacked `name`/`dob`/`relationship`.

#### `R5-017` · #94 · template-learning serverTimestamp inside arrayUnion throws · 🤖 automated
- **File:** `functions/src/template-learning.ts`
- **What broke:** `recordCorrection` put a `serverTimestamp()` sentinel inside `arrayUnion()` (rejected by the SDK) → every `recordTemplateCorrection` threw; correction memory + dictionary update never ran.
- **Step:** `npm run test -- template-learning-timestamp`
- **Expected (pre-fix failure):** `recordCorrection` threw on every call (sentinel inside an array).
- **Test:** `tests/unit/template-learning-timestamp.test.ts` (2 tests) — the firebase-admin mock throws on a serverTimestamp sentinel inside an array (mirroring the SDK); asserts `recordCorrection`/`recordConfirmedVariables` resolve and store concrete Timestamps in array elements.

#### `R5-018` · #94 · wills-pilot reports successful extractions as timeout · 🤖 automated
- **File:** `functions/src/wills-pilot.ts`
- **What broke:** `TERMINAL_STATUSES` omitted `'extracted'` (the real success status), so `pollUntilTerminal` spun to the 8-min timeout every run, labeled every doc `timeout`, and the acceptance gate could never pass.
- **Step:** `npm run test -- wills-pilot`
- **Expected (pre-fix failure):** `isTerminalForRun('extracted')` was false; `extractedOk` never counted.
- **Test:** `tests/unit/wills-pilot.test.ts` (R5-018 block) — asserts `'extracted'` ∈ `TERMINAL_STATUSES`, `isTerminalForRun` returns true for a fresh extracted doc, and buildReport scores it `extraction_success_rate=1` with `terminal_status='extracted'` (not `timeout`). Helpers exported test-only.

#### `R5-034` · #111 · spouse-swap with missing spouseInfo saves PRIMARY duplicate · 🤖 automated
- **File:** `functions/src/unified-generator.ts`
- **What broke:** `spouseRole='spouse'` with no spouse info skipped the swap but still generated + saved a doc under the `_spouse` docId — a duplicate of the PRIMARY's document in the spouse's slot.
- **Step:** `npm run test -- unified-generator`
- **Expected (pre-fix failure):** a primary-content doc persisted under `_spouse`.
- **Test:** `tests/unit/unified-generator.test.ts` (R5-034 block) — asserts a missing-spouse-info run rejects with `failed-precondition` and neither the generator nor the save helper is called.

#### `R5-035` · #111 · spouse-swap gender inversion ignored marital status · 🤖 automated
- **File:** `functions/src/unified-generator.ts`
- **What broke:** the gender backfill inverted the primary's gender for Domestic Partnership couples too, despite a comment claiming it's skipped for them.
- **Step:** `npm run test -- unified-generator`
- **Expected (pre-fix failure):** a Domestic Partnership couple had the primary's gender inverted.
- **Test:** `tests/unit/unified-generator.test.ts` (R5-035 block) — Married → the swapped testator's gender inverts (`female`→`male`); Domestic Partnership → gender left undefined.

#### `R5-039` · #111 · DRAFT watermark only for status='draft' · 🤖 automated
- **File:** `functions/src/export-pdf.ts`, `export-docx.ts`, `export-batch.ts`
- **What broke:** the DRAFT watermark applied only when `status==='draft'`, so `review`/`needs_review`/`incomplete`/`error` docs exported as clean, final-looking legal instruments. Fix: `isDraft = status !== 'final'` at all four sites.
- **Step:** `npm run test -- export-draft-watermark`
- **Expected (pre-fix failure):** a `status='review'` export had no watermark.
- **Test:** `tests/unit/export-draft-watermark.test.ts` (7 tests) — drives the PDF exporter's pure `buildLegalDocumentHtml`; asserts the CSS watermark overlay is present for every non-`'final'` status and absent only for `'final'`. (DOCX/batch share the identical `status !== 'final'` gate.)

#### `R5-057` · #117 · email client-callable open relay · ⬜ automate
- **File:** `functions/src/email-notifications.ts`
- **What broke:** `sendQuestionnaireCompleteNotification` (client-callable) trusted a caller-supplied `attorneyEmail`/`clientName`, letting any authenticated client send firm-branded email from the firm's sender to any address. Fix resolves both server-side from `assignedAttorneyId` (same-firm) and the client's `personalInfo`.
- **Test to write:** request `attorneyEmail`/`clientName` are ignored; recipient resolved from `assignedAttorneyId`.
- **Expected (pre-fix failure):** email sent to the caller-supplied arbitrary address.

#### `R5-043` · #110 · questionnaire street dropped · ⬜ automate
- **File:** `functions/src/generators/questionnaire-generator.ts`
- **What broke:** address read `pi.street`/`si.street`, but the model field is `personalInfo.address` (no `street` field), so the street line was silently omitted from every vaulted questionnaire.
- **Test to write:** output for a client with `personalInfo.address` set contains that address string.
- **Expected (pre-fix failure):** the address line was blank/missing.

#### `R5-032` · #110 · generate-flex honest success · ⬜ automate
- **File:** `functions/src/generate-flex-document.ts`
- **What broke:** returned `success:true` unconditionally even when the vault save failed (`generateDocument` returns `status:'error'` rather than throwing). Now `success = result.status !== 'error'`.
- **Test to write:** callable returns `success:false` when the generator result status is `'error'`.
- **Expected (pre-fix failure):** a failed save still reported `success:true`.

#### `R5-038` · #110 · transcript filed empty · ⬜ automate
- **File:** `functions/src/file-transcript-to-matter.ts`
- **What broke:** the filed Note's transcription was built only from `transcript.segments`; a transcript with `transcriptText` but no segments filed an empty note marked `completed`.
- **Test to write:** (a) segments-empty + text present → note content = transcriptText; (b) no content → throws `failed-precondition`.
- **Expected (pre-fix failure):** a text-only transcript filed an empty, completed note.

#### `R5-031` · #110 · notarized flag conflation · ⬜ automate
- **File:** `functions/src/document-save-helper.ts`, `src/components/documents/UploadDraftDialog.tsx`
- **What broke:** `notarized` (= "has been notarized") was set from the doc-type notarization *requirement*, falsely marking every notarization-required fresh draft/upload as already notarized. Now `false` on both paths.
- **Test to write:** a freshly generated notarization-required doc is saved with `notarized:false`.
- **Expected (pre-fix failure):** a fresh draft was saved with `notarized:true`.

#### `R5-041` · #118 · fiduciary multi-role corruption · ⬜ automate
- **File:** `functions/src/process-template-file.ts`
- **What broke:** fiduciary-path enforcement picked the FIRST matching role and rewrote ALL `{{fiduciaries.*}}` vars in a paragraph to it — corrupting paragraphs that name two roles ("the Executor shall consult the Trustee" → both become executor). Now only rewrites when exactly one role matches.
- **Test to write:** a two-role paragraph keeps both `{{fiduciaries.executor}}` and `{{fiduciaries.trustee}}`.
- **Expected (pre-fix failure):** both vars collapsed to the first-matched role.

#### `R5-065` · #118 · retemplatize strips block helpers · ⬜ automate
- **File:** `functions/src/retemplatize-templates.ts`
- **What broke:** force-mode stripping blanked ALL `{{...}}` including block helpers (`{{#each}}`/`{{#if}}`/`{{else}}`), destroying loop/conditional structure. New `stripLeafVariables` blanks only leaf vars.
- **Test to write:** `stripLeafVariables` preserves block helpers/`{{this}}` while blanking leaf `{{var}}`.
- **Expected (pre-fix failure):** block helpers were blanked, collapsing structure.

#### `R5-046` · #120 · Gemini multi-part / truncation · 🤖 automated
- **File:** `functions/src/ai-client.ts`
- **What broke:** `_callGemini` returned only `parts[0].text` (dropping later text parts from grounding splits) and never checked `finishReason`. Now concatenates all parts and mirrors the MAX_TOKENS check. (Provider dispatch untouched — Never-Break.)
- **Step:** `npm run test -- ai-client-gemini`
- **Expected (pre-fix failure):** a multi-part Gemini answer was silently cut to part 0.
- **Test:** `tests/unit/ai-client-gemini.test.ts` (3 tests) — drives the real `callAI` (dispatch untouched) with a stubbed `fetch`; asserts all parts concatenate, `MAX_TOKENS` throws in JSON mode, and prose mode returns the partial text. (Also on the prod-smoke list for real output.)

#### `R5-051` (backend half) · #115 · bulk-KB partial-OCR honesty · ⬜ automate
- **File:** `functions/src/bulk-knowledge-import.ts`
- **What broke:** a scanned PDF >15MB was byte-chunked and only chunk 0 OCR'd, yet saved `status:'success'` with `ocrPagesCount` = full pageCount — a silent partial import of legal reference content. Now `status:'partial'`, `ocrPagesCount:0`, a warning. (Frontend badge half is R5-051 in T2.)
- **Test to write:** `extractFileText` over a large multi-chunk scanned PDF → `status:'partial'`, `ocrPagesCount:0`, non-empty warning.
- **Expected (pre-fix failure):** partial OCR persisted as `success` with the full pageCount.

#### `R5-062` · #112 · wills-extractor unvalidated truncated extraction · ⬜ automate
- **File:** `functions/src/wills-extractor.ts`
- **What broke:** extraction output was stored with zero validation — `stop_reason` never checked (max_tokens truncation yields partial tool input), required fields/enums unverified, despite a "Step 9: Validate schema" header.
- **Test to write:** mock the AI response with a truncated `stop_reason` / missing field → retry-once then `needs_human_review`.
- **Expected (pre-fix failure):** partial/truncated tool input stored as a valid extraction.

#### `R5-063` · #112 · wills-pilot classification rate inflated · 🤖 automated
- **File:** `functions/src/wills-pilot.ts`
- **What broke:** `classification_success_rate` counted failed docs as successes because error records store `document_type:'Other'` and buildReport treated any non-null type as classified.
- **Step:** `npm run test -- wills-pilot`
- **Expected (pre-fix failure):** `Other` placeholders inflated the rate.
- **Test:** `tests/unit/wills-pilot.test.ts` (R5-063 block) — buildReport over one `extracted` + one `error`/`Other` doc yields `classification_success_rate=0.5`, not `1.0`.

#### `R5-064` · #112 · wills-pilot extraction rate counts skips · 🤖 automated
- **File:** `functions/src/wills-pilot.ts`
- **What broke:** `extraction_success_rate` counted `skipped` docs (legacy .doc, unsupported, deleted) as successes; fix counts only `extracted`/`indexed`.
- **Step:** `npm run test -- wills-pilot`
- **Expected (pre-fix failure):** skipped/unsupported docs counted as extraction successes.
- **Test:** `tests/unit/wills-pilot.test.ts` (R5-064 block) — buildReport over one `extracted` + one `skipped` doc yields `extraction_success_rate=0.5`, not `1.0`.

#### `E/A/AE/B` · #52 · honest generation success + preserved HttpsError codes · ⬜ automate
- **File:** `functions/src/generate-documents.ts`, `generate-single-document.ts`
- **What broke:** batch/single generation reported `success:true` regardless of per-doc `status:'error'` and re-wrapped typed `HttpsError` codes into generic `internal`.
- **Test to write:** success derived from status/counts; original `HttpsError` code preserved (also observable in the UI — see T2 note).
- **Expected (pre-fix failure):** a failed generation returned `success:true` and lost the error code.

---

## T2 — Manual UI (emulator, single firm)

> Pattern for every data-loss case: perform the action → **hard-reload** → assert persistence. Most are drivable by Claude-in-Chrome with Adam watching. Cases needing a forced failure (offline / blocked rule / mocked callable) are flagged.

#### `R5-028` · #91 · questionnaire — undefined-write poisons autosave · ⬜ unverified
- **File:** `src/config/firebase.ts`, `src/contexts/QuestionnaireContext.tsx`
- **What broke:** clearing an optional currency field made `parseCurrency('')` return `undefined`; Firestore was initialized without `ignoreUndefinedProperties`, so every later `setDoc` threw `invalid-argument`, silently breaking all autosaves for the session.
- **Steps:** add a property with an estimated-value field → type a value → clear it → keep answering later steps → hard-reload.
- **Expected (pre-fix failure):** answers entered after clearing the field were lost while the UI showed "Saved."

#### `R5-026` · #91 · questionnaire — non-NJ state clobbered · ⬜ unverified
- **File:** `src/components/questionnaire/fields/AddressField.tsx`
- **What broke:** the State select fired two `update()`s off the same stale closure; the second (`state: current.state || 'NJ'`) reverted the pick, so any non-NJ state snapped back to NJ.
- **Steps:** in an address block pick a non-NJ state (e.g. Pennsylvania) → save/advance → hard-reload.
- **Expected (pre-fix failure):** the state reverted to NJ; out-of-state addresses silently recorded as NJ.

#### `R5-027` · #91 · questionnaire — false "completed" on failed save · ⬜ unverified *(forced failure)*
- **File:** `src/contexts/QuestionnaireContext.tsx`, `QuestionnaireShell.tsx`
- **What broke:** `performSave`/`saveProgress` swallowed a permanent failure and resolved as success; Submit then stamped `status='completed'`, notified the attorney, and toasted success though nothing was written.
- **Steps:** induce a persistent write failure (block the write / offline) → Submit (and Save-and-Close as staff).
- **Expected (pre-fix failure):** it showed completed + notified the attorney despite lost data. Now: aborts with an error, no `completed`, no notification.

#### `R5-022` · #92 · editor — regenerate overwritten by stale autosave · ⬜ unverified
- **File:** `src/components/editor/DocumentEditor.tsx`
- **What broke:** Regenerate set `forceReloadRef` only after the callable resolved, but the regenerated snapshot arrived first and was skipped; the next keystroke autosaved the old HTML over the regenerated doc, no version snapshot.
- **Steps:** open a doc → Regenerate, wait → type one char → hard-reload.
- **Expected (pre-fix failure):** the editor kept the old draft and the first keystroke overwrote the regenerated document.

#### `R5-023` · #92 · editor — per-property regenerate writes wrong doc · ⬜ unverified *(2-property seed)*
- **File:** `src/components/editor/DocumentEditor.tsx`
- **What broke:** regenerating a per-property doc (`deed_1`) sent no `propertyIndex`, so the backend wrote an un-suffixed `deed` built from the first property; the editor never updated.
- **Steps:** open `deed_1` → Regenerate → check vault list + editor.
- **Expected (pre-fix failure):** a new first-property `deed` appeared; `deed_1` untouched; editor stale.

#### `R5-024` · #92 · editor — version restore loses current edits + dup version numbers · ⬜ unverified
- **File:** `src/components/editor/VersionHistory.tsx`, `DocumentEditor.tsx`
- **What broke:** Restore snapshotted the OLD restored content (not the working copy, contradicting the "no work lost" dialog) and numbered off the lagging `currentVersion` → two versions with the same number.
- **Steps:** edit (autosave, no new snapshot) → Version History → Restore v1 → inspect numbers + look for pre-restore edits.
- **Expected (pre-fix failure):** pre-restore edits gone; two versions shared a number.

#### `R5-025` · #92 · editor — single Replace uses stale offsets · ⬜ unverified
- **File:** `src/components/editor/FindReplaceDialog.tsx`
- **What broke:** single Replace used offsets cached at query time; because the panel is non-modal, editing between search and Replace made the cached span corrupt unrelated text (Replace All already recomputed).
- **Steps:** search a once-occurring term → without closing, insert a sentence before it → click Replace (single).
- **Expected (pre-fix failure):** a shifted, wrong span was replaced.

#### `R5-078` · #107 · editor — Replace All with empty replacement no-ops · ⬜ unverified
- **File:** `src/components/editor/FindReplaceDialog.tsx`
- **What broke:** empty replacement threw (ProseMirror rejects `schema.text('')`), so "delete all occurrences" silently did nothing. Fix deletes the range.
- **Steps:** search a term → leave replacement empty → Replace All (and single Replace).
- **Expected (pre-fix failure):** nothing replaced, no feedback.

#### `R5-077` · #107 · editor — comment reply lost on write failure · ⬜ unverified *(forced failure)*
- **File:** `src/components/editor/CommentsPanel.tsx`
- **What broke:** `handleAddReply` swallowed write errors and cleared the input as if posted. Fix re-throws, keeps the text, shows "Failed to post reply."
- **Steps:** open comments → type a reply with the write forced to fail → submit.
- **Expected (pre-fix failure):** input cleared as if posted; reply lost.

#### `R5-075` · #107 · editor — Save button only schedules debounce · ⬜ unverified *(timing)*
- **File:** `src/components/editor/DocumentEditor.tsx`
- **What broke:** manual Save only *scheduled* the 2s debounced autosave; unmount cleared the timer, so Save-then-navigate within 2s discarded the edit. Fix flushes immediately.
- **Steps:** edit → click Save → navigate away within ~2s → reopen.
- **Expected (pre-fix failure):** the edit was discarded despite Save.

#### `R5-072` · #100 · editor — regenerate ignores callable failure · ⬜ unverified *(forced failure)*
- **File:** `src/components/editor/DocumentEditor.tsx`
- **What broke:** `handleRegenerate` ignored the response, so a `success:false`/`status:'error'` result showed no error and force-reloaded as if it worked.
- **Steps:** Regenerate with the backend returning a non-throwing failure.
- **Expected (pre-fix failure):** no error shown; reloaded as if succeeded.

#### `R5-081` · #107 · questionnaire — required composite step doesn't gate Next · ⬜ unverified
- **File:** `src/contexts/QuestionnaireContext.tsx`
- **What broke:** `canProceed` treated empty `{}`/`[]` as satisfied, so required composite steps (Home Address, required repeaters) never gated Next.
- **Steps:** reach a required composite step, leave it empty, click Next.
- **Expected (pre-fix failure):** Next proceeded past an empty required step.

#### `CH` · #51 · questionnaire — primary save outside retry loop · ⬜ unverified *(forced failure)*
- **File:** `src/contexts/QuestionnaireContext.tsx`
- **What broke:** the primary `setDoc` sat outside `performSave`'s retry loop, so a failed autosave rejected silently while the UI showed "Saved." Moved inside + `SET_ERROR`.
- **Steps:** open questionnaire → force a write failure → edit a field.
- **Expected (pre-fix failure):** UI showed "Saved" though the write failed.

#### `R5-019` · #93 · dashboard — tasks/appointments hidden for most clients · ⬜ unverified *(6+ client seed)*
- **File:** `src/pages/admin/DashboardPage.tsx`
- **What broke:** the dashboard passed `filteredClients` (5 most-recent, further narrowed by the search box) as `activeClientIds` to the Tasks/Appointments panels, hiding everyone else and mutating as you type.
- **Steps:** seed a task+appointment on a non-recent client → open dashboard → type in the client search box.
- **Expected (pre-fix failure):** that client's items absent; panels shifted while typing.

#### `R5-021` · #93 · vault — Drive-sync Tooltip crashes the tab · ⬜ unverified *(Drive-synced doc seed)*
- **File:** `src/components/documents/DocumentVault.tsx`
- **What broke:** the Drive-sync Tooltip had no `TooltipProvider` ancestor, so Radix threw and crashed the whole Vault tab for any client with a Drive-synced doc.
- **Steps:** open a client with a `googleDriveSyncedAt` doc → Document Vault tab.
- **Expected (pre-fix failure):** the vault tab crashed to the error boundary.

#### `R5-084` · #99 · dashboard — TasksList crash on null createdAt · ⬜ unverified
- **File:** `src/components/dashboard/TasksList.tsx`
- **What broke:** the sort called `a.createdAt.toDate()` unguarded; a new task's pending `serverTimestamp` is `null` in the latency-compensated snapshot → crash.
- **Steps:** add a new task, watch the panel immediately.
- **Expected (pre-fix failure):** the panel crashed on add.

#### `R5-089` · #99 · dashboard — Notes search crash on audio-only note · ⬜ unverified *(content-less note seed)*
- **File:** `src/components/dashboard/NotesTab.tsx`
- **What broke:** search called `n.content.toLowerCase()` unguarded, but audio-only notes write no `content` → search permanently crashed once one existed.
- **Steps:** with a content-less note present, type in notes search.
- **Expected (pre-fix failure):** search crashed the Notes tab.

#### `R5-091` · #99 · ai-widget — @mention strip deletes the message · ⬜ unverified *(check network payload)*
- **File:** `src/components/ai/GlobalAiWidget.tsx`
- **What broke:** the strip regex `/@[\w\s]+(?=\s|$)/` greedily ate word chars AND spaces to end-of-message, deleting the whole message before send (UI still showed full text).
- **Steps:** @mention a client, type a question after it, send, inspect the payload.
- **Expected (pre-fix failure):** everything from `@` onward deleted; near-empty prompt sent.

#### `R5-082` · #99 · calendar — all-day toggle saves wrong times · ⬜ unverified
- **File:** `src/components/dashboard/CalendarTab.tsx`
- **What broke:** `handleSave` computed times from the stale `event.allDay` instead of `form.allDay`.
- **Steps:** edit a timed event → toggle all-day → save → reopen.
- **Expected (pre-fix failure):** saved times used the pre-toggle value.

#### `R5-090` · #99 · calendar — invalid date saved as "now" with success · ⬜ unverified
- **File:** `src/components/dashboard/CalendarTab.tsx`
- **What broke:** `toTimestamp` fell back to `new Date()` on empty/invalid input, so a bad-date appointment saved at the current moment with a success toast.
- **Steps:** create/edit an appointment with an empty/invalid date → save.
- **Expected (pre-fix failure):** saved at "now" and toasted success. Now: blocked with a validation error.

#### `R5-067` · #100 · transcripts — error state masked as empty queue · ⬜ unverified *(forced failure)*
- **File:** `src/pages/admin/PendingTranscriptsPage.tsx`
- **What broke:** the listener ignored its error state, so a query failure rendered the "Queue is clear" empty-state.
- **Steps:** open Pending Transcripts with the query forced to fail.
- **Expected (pre-fix failure):** an error looked identical to an empty queue.

#### `R5-073` · #100 · docs — batch generate "0 docs" shown as success · ⬜ unverified *(forced all-fail)*
- **File:** `src/components/documents/BatchGenerateDialog.tsx`
- **What broke:** a client whose `generateAll` returned `documentsGenerated:0` (all failed server-side) showed a green success reading "0 docs."
- **Steps:** batch-generate with every server-side generation failing.
- **Expected (pre-fix failure):** a green "0 docs" checkmark implied success.

#### `R5-020` · #98 · clients — orphaning hard-delete removed; Archive is soft-delete · ⬜ unverified
- **File:** `src/pages/admin/ClientListPage.tsx`
- **What broke:** "Delete Client" used `deleteDoc`, removing only the client doc and orphaning its subcollections + Storage (still readable, still matching firm-wide queries) while the dialog claimed all data was removed. Delete removed entirely; Archive is the only path.
- **Steps:** open row/card actions (both views) → confirm no hard Delete exists → Archive a client with docs → check firm-wide doc counts.
- **Expected (pre-fix failure):** Delete existed and left orphaned, readable documents inflating analytics.

#### `R5-029` · #95 · templates — tags-only save wipes variables · ⬜ unverified
- **File:** `functions/src/seed-templates.ts` (via Edit Tags UI)
- **What broke:** `uploadTemplate`'s update branch unconditionally wrote `variables: mergedVariables`, so a tags-only update computed `[]` and wiped an attorney-reviewed template's variables — which then made the batch retemplatizer re-select and overwrite it with AI output.
- **Steps:** open a templatized template → Edit Tags → toggle a tag → save → confirm variables still listed (not 0).
- **Expected (pre-fix failure):** saving tags blanked `variables` to `[]`.

#### `R5-030` · #95 · templates — content edit wipes softwareSource · ⬜ unverified
- **File:** `functions/src/seed-templates.ts` (via TemplatePreviewDialog)
- **What broke:** the update branch wrote `softwareSource ?? ''` unconditionally; `handleSave` omits it, so every content edit blanked the source label and dropped its +80 resolution bonus — a different variant then silently won.
- **Steps:** preview a template with `softwareSource` set → fix a typo → Save → confirm source still set.
- **Expected (pre-fix failure):** the content save reset `softwareSource` to `''`.

#### `R5-092` · #108 · templates — WYSIWYG round-trip corruption · ⬜ unverified
- **File:** `src/components/knowledge/TemplatePreviewDialog.tsx`
- **What broke:** saving from Rendered view persisted `editor.getHTML()`, round-tripping raw Handlebars through TipTap — block helpers between `<table>`/`<tr>` get foster-parented out of position. Block-helper templates now open Source-only.
- **Steps:** open a template with `{{#each}}` inside a table → confirm it opens in Source view, Rendered toggle disabled → save → confirm helpers stay in place.
- **Expected (pre-fix failure):** saving from Rendered relocated the block helpers, corrupting structure.

#### `R5-069` · #108 · name-splits — lost update on concurrent apply · ⬜ unverified
- **File:** `src/pages/admin/NameSplitsReview.tsx`
- **What broke:** `applyToClient` did a whole-map read-modify-write via `updateDoc` (no transaction) and fetched the entire `clients` collection to load one doc; a concurrent edit to a different slot was clobbered. Now `runTransaction` + single-doc `tx.get`.
- **Steps:** in two sessions edit two different split slots on the same client → apply both → confirm neither overwrites the other.
- **Expected (pre-fix failure):** the second write clobbered the first (lost update).

#### `R5-070/R5-036` · #109 · subset regen of per-property docs · ⬜ unverified *(2-property seed)*
- **File:** `functions/src/generate-single-document.ts`, `src/components/documents/GenerateDocumentsButton.tsx`
- **What broke:** subset generation of deed/affidavit/gitRep3 sent no `propertyIndex`, writing an un-suffixed `deed` (property 0) alongside the batch's `deed_0`/`deed_1` — duplicating rather than replacing, covering only the first property. Now routes through per-property expansion.
- **Steps:** client with 2+ properties, batch docs already generated → select only the deed (no specific property) → regenerate → confirm one deed per property replaces `deed_0/1`, not a stray `deed`.
- **Expected (pre-fix failure):** a stray un-suffixed `deed` (property 0) duplicated the per-property docs.

#### `R5-040` · #119 · templatization PII-leak warning · ⬜ unverified
- **File:** `functions/src/process-template-file.ts`, `AddTemplateDialog.tsx`, `BulkTemplateUploadDialog.tsx`
- **What broke:** in multi-pass templatization a failed chunk falls back to the ORIGINAL filled HTML (real prior-client PII), yet the function returned success with a structure-only fidelity score that can't detect it — a silent PII leak into a reusable template. Now accumulates `warnings[]` surfaced as loud amber toasts.
- **Steps:** templatize a multi-chunk doc via Add Template/Bulk Upload with a chunk-failure path → confirm an amber warning toast that the output still contains original names/addresses.
- **Expected (pre-fix failure):** the upload reported clean success while the saved template held the prior client's PII.

#### `R5-051` (frontend half) · #115 · bulk-KB import partial badge · ⬜ unverified
- **File:** `src/components/knowledge/KBBulkImportDialog.tsx`, `src/services/knowledge-base-service.ts`
- **What broke:** the dialog reported a partial OCR import as a clean success (see backend half in T1).
- **Steps:** import a large scanned PDF that byte-chunks → confirm an amber "Partial" badge + warning row + "N partial" summary.
- **Expected (pre-fix failure):** a clean success with no warning.

#### `#101` · #101 · auto AI summary on transcript reaching the queue · ⬜ unverified *(feature)*
- **File:** `functions/src/summarize-pending-transcript.ts`, `PendingTranscriptsPage.tsx`
- **What it does:** an `onDocumentCreated` trigger summarizes a new pending transcript with Claude (per-firm key), writing `summary`/`summaryStatus` additively; a summary failure never blocks filing.
- **Steps:** create a pending transcript → open the Pending Filing queue, expand the row → loading → summary above the raw transcript → force an AI error and confirm the row stays fileable with an unobtrusive notice.
- **Expected (behavior to confirm):** summary appears automatically; failure never blocks filing.

#### `#102-#106` · #102-#106 · create-client entry points · ⬜ unverified *(feature)*
- **File:** `src/components/ui/combobox.tsx`, `NewClientPage.tsx`, payment dialogs, calendar, audio-note modal
- **What it does:** client-name pickers are searchable comboboxes; an unmatched name offers "➕ Create client 'X'" that routes to the full New Client form pre-filled (in-tab via router state; new tab via `?name=` for the audio modal so the recording survives).
- **Steps:** in a payment dialog / transcript file-to-matter / firm-wide calendar, type a partial name (list narrows) → type a non-matching name → select "➕ Create client 'X'" → `/clients/new` opens pre-filled. Audio-note modal: Create client opens a new tab, recording intact.
- **Expected (behavior to confirm):** comboboxes resolve to real client ids only; every create path lands in the full form pre-filled — no stub records.

---

## T3 — Multi-tenant / privileged (emulator, two firms)

#### `R5-066` · #113 · wills pipeline — cross-tenant admin trigger · ⬜ unverified
- **File:** `functions/src/wills-pilot.ts`, `wills-backfill.ts`
- **What broke:** `willsPilotRun`/`willsStartBackfill` gated only on `role=='admin'` with no firm scoping, so any firm's admin could trigger Elias Counsel's Drive ingestion and read pilot reports (client-identifying file names/paths). Fix requires `caller.firmId === pipeline_state/control.firmId`, checked before the kill-switch probe.
- **Steps:** set `pipeline_state/control.firmId = Firm A` → as **Firm B admin** call `willsPilotRun` and `willsStartBackfill` → expect `permission-denied`, and no leak of whether the pipeline is enabled → with `firmId` unset expect `failed-precondition` (fails closed) → as **Firm A admin** expect it to proceed.
- **Expected (pre-fix failure):** Firm B admin could invoke both and read Firm A's pilot report.

#### `R5-010` · #97 · client-claim — attorney-issued token required · ⬜ unverified
- **File:** `functions/src/register-client.ts`, `create-registration-link.ts`
- **What broke:** `registerClientFromLink` claimed any unlinked client record on a bare name+email match (anonymous auth, no verified identity) — an account-takeover of another person's estate profile. Fix: claiming requires an attorney-issued `registrationToken`; without one it can only create a new prospect stub and never looks up by email.
- **Steps:** unlinked Firm A client (email, no `linkedUserId`) + an unrelated anonymous session that knows the email + an attorney-minted token. (1) Claim **without** token → must NOT claim (only creates a stub; existing `linkedUserId` unchanged). (2) Claim **with** a valid token → succeeds.
- **Expected (pre-fix failure):** step 1 handed over the existing estate profile with no token.
- **Note:** candidate to encode in `security-rules.test.ts`/a callable test → promote to T1 if done.

#### `AP/AQ/AZ/BA/BB` · #54 · createFirmUser lockdown + template/KB firm-scope · ⬜ unverified
- **File:** `functions/src/user-management.ts`, `knowledge-base.ts`, `seed-templates.ts`
- **What broke:** `createFirmUser` was callable by any authenticated user and could mint an `admin` with arbitrary capabilities; the template/KB callables used a broken firm-scope predicate that leaked another firm's templates/resources. Now create is admin/attorney-only with allowlists; scope predicate rejects `callerFirmId !== firmId`.
- **Steps:** (1) as a Firm A **attorney**, `createFirmUser` requesting `role:'admin'` → reject. (2) as a client/paralegal, `createFirmUser` at all → reject. (3) as any Firm A user, call `listTemplates`/`getTemplateContent`/`searchKnowledgeResources` targeting **Firm B**'s id → empty/denied, never Firm B data.
- **Expected (pre-fix failure):** an attorney (or any signed-in user) could mint a cross-privilege admin; the predicate returned another firm's data.
- **Note:** `security-rules.test.ts` is a static text-match — it does NOT exercise these callables at runtime. No real coverage yet.

#### `AS` · #55 · paralegal dropped from billing + firm-settings · ⬜ unverified
- **File:** `firestore.rules`, `src/hooks/usePermissions.ts`
- **What broke:** paralegals had `canManageBilling`/`canManageFirmSettings`. Removed at the rules layer and in the hook.
- **Steps:** as a seeded **paralegal**, (1) attempt a write to the firm-settings/billing path → denied by rules; (2) in the UI, confirm the billing/firm-settings controls are hidden.
- **Expected (pre-fix failure):** a paralegal could manage billing and firm settings.

---

## T4 — Race / async / pipeline (code-review sign-off or integration test)

> These can't be verified by clicking. Each needs an automated concurrency/integration test or a documented code-review sign-off. None has coverage today.

#### `R5-033` · #116 · vault-save — non-transactional version-bump race · ⬜ automate (concurrency)
- **File:** `functions/src/document-save-helper.ts`
- **What broke:** `saveDocumentToVault` did a non-transactional read-modify-write; two concurrent saves to the same deterministic docId both read N and wrote N+1 — losing content, dropping a snapshot, duplicating `versionNumber`. Fix wraps read+compute+snapshot+write in one `runTransaction`.
- **Test to write:** fire two `saveDocumentToVault` in parallel vs the emulator → assert contiguous unique version numbers, no lost content.
- **Expected (pre-fix failure):** a snapshot dropped and duplicate `versionNumber`s appended.

#### `R5-052` · #117 · createFirmUser non-idempotent · ⬜ automate (failure injection)
- **File:** `functions/src/user-management.ts`
- **What broke:** any post-create failure orphaned the Auth account (no claims/profile) and every retry hit `already-exists`. Fix: critical path with best-effort `auth.deleteUser` rollback; invite-email failure returns success+warning.
- **Test to write:** mock a post-create failure → assert Auth user rolled back; mock invite-email failure → success+warning, not throw.
- **Expected (pre-fix failure):** orphaned Auth account; every retry failed `already-exists`.

#### `R5-055` · #111 · calendar-sync advances watermark on partial failure · 🚫 blocked
- **File:** `functions/src/calendar-sync.ts`
- **What broke:** a mid-run `events.list` failure still advanced `googleCalendarLastSyncAt`, permanently dropping un-fetched changes. Fix skips the watermark advance on error.
- **How to verify:** integration sync with an injected fetch failure → re-run re-fetches the dropped events (upsert-by-eventId is idempotent).
- **Expected (pre-fix failure):** the watermark advanced past the failed fetch; events permanently dropped.

#### `R5-058` · #112 · wills-processor — corrupt file loses record · 🚫 blocked
- **File:** `functions/src/wills-processor.ts`
- **What broke:** `_extractText` had no try/catch; a corrupt/password-protected file made the Pub/Sub handler reject and the file vanished with no `wills_documents` record. **No pipeline test infra exists.**
- **How to verify:** code-review sign-off, or a manual Drive-drop of a password-protected PDF → confirm a record is still written.
- **Expected (pre-fix failure):** the file produced zero records (silent data loss).

#### `R5-059` · #112 · wills-processor — error record clobbers good record · 🚫 blocked
- **File:** `functions/src/wills-processor.ts`
- **What broke:** `_writeErrorRecord` merged `document_type:'Other'`+error over an already-good record, so a transient failure on a `modified` event corrupted a correctly-classified document.
- **How to verify:** code-review, or emulated Firestore: seed a classified record → fire a failing modified event → assert the prior record is preserved.
- **Expected (pre-fix failure):** the good record was overwritten with the error stub.

#### `R5-060` · #112 · wills-processor — daily-spend undercount · 🚫 blocked
- **File:** `functions/src/wills-processor.ts`
- **What broke:** the spend increment was fire-and-forget before return (droppable on CPU freeze) and the skip-extraction path never charged its classification cost → the cost circuit breaker undercounted.
- **How to verify:** code-review, or a cost-accounting integration test (awaited increment; skip-path adds cost).
- **Expected (pre-fix failure):** spend dropped on return; skip-path added zero cost.

#### `R5-061` · #112 · wills-backfill — stuck 'running' blocks all runs · 🚫 blocked
- **File:** `functions/src/wills-backfill.ts`
- **What broke:** a 540s timeout mid-BFS left `backfill_progress.status='running'` forever and the idempotency guard permanently blocked every future run.
- **How to verify:** code-review, or seed a stale `running` record → confirm a new run restarts.
- **Expected (pre-fix failure):** all future backfill runs were blocked.

#### `R5-050` · #114 · chat — unawaited memory extraction never ran · 🚫 blocked (prod smoke)
- **File:** `functions/src/chat-ai.ts`
- **What broke:** `extractAndSaveKeyFacts`/`extractAndSaveCorrections` were fire-and-forget right before return, so the instance CPU froze and the memory pipeline silently never completed. Now `runMemoryExtraction()` is awaited.
- **How to verify:** prod/integration smoke — send a qualifying chat turn (clientId, ≥4 messages) → confirm key-fact/note docs get written. (Also on the prod-smoke list.)
- **Expected (pre-fix failure):** no memory documents were ever written after a chat turn.

---

## 🚫 Blocked (cannot run yet)

#### `BN` · #53 · LawPay reconciliation via doc-id reference · 🚫 blocked
- **File:** `functions/src/lawpay-integration.ts`
- **What it does:** the LawPay `reference` carries `firmId::clientId::paymentDocId` so `charge.completed` reconciles the correct pending doc. **Blocker:** money/IOLTA path, no LawPay sandbox. Also open: R5-021 — `readOnlyFields` omits `reference`, so a payer can edit/clear the key and break reconciliation.

#### `card-charge` · #89 · AffiniPay Hosted Fields card charge · 🚫 blocked
- **File:** `src/components/payments/ChargePaymentDialog.tsx`
- **What it does:** #89 normalized expiry before tokenization (correct, live) but is NOT the blocker. Per HOMEWORK.md the card flow is **still broken**: typed digits render in the iframe but the SDK reports `af-card-number` empty → `getPaymentToken` tokenizes an empty card → "field validation errors." Needs a live AffiniPay merchant + Adam-driven test loop; the cross-origin iframe can't be typed into from automation. **🔴 START HERE for the card-charge fix session.**

---

## Coverage index (fix → tier → status)

| Fix | PR | Area | Tier | Status |
|-----|----|------|------|--------|
| R5-004 | #94 | doc-content-integrity name path | T1 | 🤖 |
| R5-044 | #118 | Oxford comma bold spans | T1 | 🤖 |
| R5-045 | #120 | serializer per-property state | T1 | 🤖 |
| R5-042 | #110 | questionnaire stored-XSS | T1 | 🤖 |
| R5-056 | #117 | email custom-template XSS | T1 | 🤖 |
| AF | #47 | client-data block not re-truncated | T1 | 🤖 |
| BT | #50 | OCR stripEmpty before merge | T1 | 🤖 |
| R5-002 | #94 | packageType forwarding | T1 | 🤖 |
| R5-003 | #94 | spouse gender same-sex | T1 | 🤖 |
| R5-005 | #94 | fortress irrevocable trust | T1 | 🤖 |
| R5-013 | #94 | esign signature_request_id match | T1 | ⬜ automate |
| R5-014 | #94 | esign resend clears signed PDF | T1 | ⬜ automate |
| R5-016 | #94 | process-ocr schema alignment | T1 | ⬜ automate |
| R5-017 | #94 | template-learning serverTimestamp | T1 | 🤖 |
| R5-018 | #94 | wills-pilot terminal status | T1 | 🤖 |
| R5-034 | #111 | spouse-swap missing-info dup | T1 | 🤖 |
| R5-035 | #111 | spouse-swap gender gate | T1 | 🤖 |
| R5-039 | #111 | export DRAFT watermark gate | T1 | 🤖 |
| R5-057 | #117 | email open-relay server-resolve | T1 | ⬜ automate |
| R5-043 | #110 | questionnaire street dropped | T1 | ⬜ automate |
| R5-032 | #110 | flex honest-success | T1 | ⬜ automate |
| R5-038 | #110 | transcript filed empty | T1 | ⬜ automate |
| R5-031 | #110 | notarized flag conflation | T1 | ⬜ automate |
| R5-041 | #118 | fiduciary multi-role corruption | T1 | ⬜ automate |
| R5-065 | #118 | retemplatize block-helper strip | T1 | ⬜ automate |
| R5-046 | #120 | Gemini multi-part/truncation | T1 | 🤖 |
| R5-051 (backend) | #115 | bulk-KB partial-OCR honesty | T1 | ⬜ automate |
| R5-062 | #112 | wills-extractor validation | T1 | ⬜ automate |
| R5-063 | #112 | wills-pilot classification rate | T1 | 🤖 |
| R5-064 | #112 | wills-pilot extraction rate | T1 | 🤖 |
| E/A/AE/B | #52 | honest generation success | T1 | ⬜ automate |
| R5-028 | #91 | questionnaire undefined-write | T2 | ⬜ |
| R5-026 | #91 | questionnaire non-NJ state | T2 | ⬜ |
| R5-027 | #91 | questionnaire false completed | T2 | ⬜ |
| R5-022 | #92 | editor regenerate overwrite | T2 | ⬜ |
| R5-023 | #92 | editor per-property regen | T2 | ⬜ |
| R5-024 | #92 | editor restore loses edits | T2 | ⬜ |
| R5-025 | #92 | editor stale Replace offsets | T2 | ⬜ |
| R5-078 | #107 | editor empty Replace All | T2 | ⬜ |
| R5-077 | #107 | editor comment reply lost | T2 | ⬜ |
| R5-075 | #107 | editor Save debounce flush | T2 | ⬜ |
| R5-072 | #100 | editor regenerate ignores fail | T2 | ⬜ |
| R5-081 | #107 | questionnaire required gate | T2 | ⬜ |
| CH | #51 | questionnaire save retry loop | T2 | ⬜ |
| R5-019 | #93 | dashboard tasks/appts scope | T2 | ⬜ |
| R5-021 | #93 | vault Tooltip crash | T2 | ⬜ |
| R5-084 | #99 | dashboard TasksList null date | T2 | ⬜ |
| R5-089 | #99 | dashboard Notes search crash | T2 | ⬜ |
| R5-091 | #99 | ai-widget @mention strip | T2 | ⬜ |
| R5-082 | #99 | calendar all-day toggle | T2 | ⬜ |
| R5-090 | #99 | calendar invalid date | T2 | ⬜ |
| R5-067 | #100 | transcripts error masked | T2 | ⬜ |
| R5-073 | #100 | batch "0 docs" success | T2 | ⬜ |
| R5-020 | #98 | orphaning hard-delete removed | T2 | ⬜ |
| R5-029 | #95 | tags-only save wipes variables | T2 | ⬜ |
| R5-030 | #95 | content save wipes softwareSource | T2 | ⬜ |
| R5-092 | #108 | template WYSIWYG corruption | T2 | ⬜ |
| R5-069 | #108 | name-split lost update | T2 | ⬜ |
| R5-070/R5-036 | #109 | subset regen per-property dup | T2 | ⬜ |
| R5-040 | #119 | templatization PII-leak warning | T2 | ⬜ |
| R5-051 (frontend) | #115 | bulk-KB partial badge | T2 | ⬜ |
| #101 | #101 | transcript auto-summary (feature) | T2 | ⬜ |
| #102-#106 | #102-#106 | create-client entry points (feature) | T2 | ⬜ |
| R5-066 | #113 | wills firm-scope cross-tenant | T3 | ⬜ |
| R5-010 | #97 | client-claim token gate | T3 | ⬜ |
| AP/AQ/AZ/BA/BB | #54 | createFirmUser lockdown + scope | T3 | ⬜ |
| AS | #55 | paralegal billing/settings | T3 | ⬜ |
| R5-033 | #116 | vault-save version race | T4 | ⬜ automate |
| R5-052 | #117 | createFirmUser idempotency | T4 | ⬜ automate |
| R5-055 | #111 | calendar-sync watermark | T4 | 🚫 |
| R5-058 | #112 | wills corrupt-file loses record | T4 | 🚫 |
| R5-059 | #112 | wills error clobbers record | T4 | 🚫 |
| R5-060 | #112 | wills daily-spend undercount | T4 | 🚫 |
| R5-061 | #112 | wills-backfill stuck running | T4 | 🚫 |
| R5-050 | #114 | chat unawaited extraction | T4 | 🚫 prod-smoke |
| R5-006 | #87 | reviewDocument secrets | Prod smoke | ⬜ |
| R5-007 | #87 | checkDocumentCompliance secrets | Prod smoke | ⬜ |
| R5-008/009 | #87 | AI-review 30k window | Prod smoke | ⬜ |
| R5-015 | #87 | weekly-digest secrets | Prod smoke | ⬜ |
| BN | #53 | LawPay reconciliation | Blocked | 🚫 |
| card-charge | #89 | AffiniPay hosted fields | Blocked | 🚫 |

**Tally (80 cases):** 🤖 18 locked · ⬜ 13 to-automate (T1) · ⬜ 33 manual (T2/T3) · 8 T4 (race/pipeline) · 4 prod-smoke · 2 blocked.

---

## Changelog

- **2026-07-07** — Populated all 80 cases from the commit log + `HOMEWORK.md` + `docs/AUDIT-findings.md` via 5 extraction subagents; each grounded in the actual diff and checked against `tests/unit/`. 7 fixes have real passing tests today; the rest are the build/run list. Approach: hybrid automation-first, emulator-first + prod smoke.
