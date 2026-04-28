# Estate Plan Generator — Homework

Items requiring human action or decisions before the next agent session can proceed.

---

## 🅿️ Parked decisions (revisit on a trigger, not speculatively)

### Gemini Embedding 2 upgrade — parked 2026-04-28

**Decision: do NOT upgrade `gemini-embedding-001` → `gemini-embedding-2`
right now.** Marginal quality gain for text-only legal-clause retrieval is
small-to-zero; migration cost is real.

What we'd be changing:
- Generative Language API (free-tier `x-goog-api-key`) → Vertex AI
  (service-account + project + region). New auth code path in
  `kb-embeddings.ts:80-95`.
- Free-tier embeddings → Vertex PayGo (~$0.10–0.15 per 1M input tokens).
- Mandatory full `backfillEmbeddings` run + Firestore vector index
  rebuild — old v1 vectors and new v2 vectors are in different vector
  spaces, mixing them returns garbage similarity scores.

What we'd gain (none of which are blocking us now):
- Multimodal — embed PDFs / images / audio without preprocessing. Our KB
  is 100% text; not used.
- 8K-token input vs 2K. Our chunks are ~1.5K tokens; not bottlenecked.
- Custom task instructions (`task:legal clause retrieval` etc) — needs
  code work to leverage, modest expected gain.

Triggers that would flip this decision:
1. Real-world MTEB v2 retrieval scores publish + show ≥10% gain.
2. We pick up a use case that needs multimodal embeddings (scanned
   exemplars, attorney consultation audio for chat-AI grounding,
   photographed deeds).
3. The current `gemini-embedding-001` retrieval starts pulling weak/wrong
   results in production — i.e. the embedding becomes the bottleneck,
   not the chunk/budget tuning we just shipped (`a9e176f`).

If/when one of those fires, migration sketch: (a) wire Vertex AI client
with service-account auth (mirror `ai-client.ts` Vertex pattern); (b)
swap `EMBEDDING_MODEL` constant + endpoint + auth header in
`kb-embeddings.ts`; (c) run full `backfillEmbeddings` against KB
resources AND templates; (d) verify `findNearest` queries still serve.

Until then: the recently-tuned chunk/budget settings (CHUNK_SIZE=6K,
CHUNK_THRESHOLD=12K, PER_RESOURCE_CAP=20K, TOTAL_KB_CAP=100K — see
`a9e176f`) are the actual lever for clause/draft generation quality.

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
