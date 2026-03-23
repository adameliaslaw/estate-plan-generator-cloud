# Estate Plan Generator — Backlog

> Prioritized by **impact on product quality, reliability, and user value** — irrespective of effort.
>
> Items from the [systems analysis](file:///C:/Users/adame/.gemini/antigravity/brain/eab403ba-32a1-464d-979b-18fabb1de466/system_analysis.md) that have already been completed are not listed here.
>
> **Completed:** Anthropic prompt caching · skip enhanceWithAI when zero missing vars · extract VARIABLE_TO_QUESTIONNAIRE_MAP · lazy-load generators · merge summary + action-steps generators · type-safe generator registry · standardize document titles · structural validator retry · cap raw template HTML

---

## 1 · State-Aware Generation
**Impact:** Multi-state expansion — the single biggest product-value unlock  
**Source:** Systems Analysis — Priority 4

Detect client state (NJ, NY, FL, etc.) from questionnaire data and swap statutory references, witness/notary requirements, and legal boilerplate per jurisdiction. Currently all generators use NJ-centric language.

---

## 2 · Add Default HBS Templates for Trust, Pour-Over Will
**Impact:** Template/Hybrid mode works consistently for all core doc types  
**Source:** Systems Analysis — Priority 2

Trust, Pour-Over Will, Deed, Affidavit, and GIT-REP3 currently have no default HBS templates — selecting "Template" or "Hybrid" mode silently falls back to full AI generation. Adding templates makes the tri-mode pipeline truly consistent.

---

## 3 · ~~Side-by-Side Template Comparison~~ ✅ DONE
**Impact:** Higher attorney confidence in AI output  
**Source:** Systems Analysis — Priority 4

Show template draft vs AI draft side-by-side for attorney review. Lets the attorney see exactly what the AI changed, added, or omitted compared to the template baseline.

**Completed:** Backend persists `templateBaseline` during hybrid generation. Frontend shows fullscreen side-by-side comparison panel with synchronized scrolling. "Compare with Template" button appears only for hybrid-generated documents.

---

## 4 · Vector Search for Template Matching
**Impact:** Auto-selects best template without manual dropdown  
**Source:** Systems Analysis — Priority 2 / Existing backlog

Currently `getTemplate()` uses exact Firestore field query (`docType + softwareSource`). Enhance with vector search so the system auto-selects the best-matching template based on semantic similarity — leveraging embeddings already created during template upload.

---

## 5 · Cross-Client Semantic Search of Chat Insights
**Impact:** Firm-wide intelligence across all client conversations  
**Source:** Existing backlog

Embed extracted key facts from chat conversations into the vector store so they're semantically searchable across clients ("Which clients wanted spray trusts?", "Any clients with special needs planning?").

**Implementation:**
1. After `extractAndSaveKeyFacts`, generate embedding for each fact
2. Store in `firms/{firmId}/chatInsights` collection with `clientId` tag + embedding vector
3. Add `chatInsights` to `searchKnowledgeBase` query alongside `knowledgeBase`
4. Scope results by `clientId` for single-client context, firm-wide for admin queries

---

## 6 · Prompt Version Tracking
**Impact:** Debugging + quality regression detection  
**Source:** Systems Analysis — Priority 4

Log which prompt version (hash or version tag) generated each document. When a generator's system prompt changes, this enables before/after quality comparison and regression tracking.

---

## 7 · Pre-Generation Cost Estimate
**Impact:** Cost transparency for firm admins  
**Source:** Systems Analysis — Priority 4

Show estimated token cost before generating. Use the token economics data (AI mode ~$0.03/doc, hybrid ~$0.04/doc, template = free) to display an estimate in the Generate dialog so firm admins can make informed mode choices.

---

## 8 · ~~Batch-Aware Prompt Sharing~~ ✅ DONE
**Impact:** ~40% fewer API calls for non-legal summary docs  
**Source:** Systems Analysis — Priority 1

Combine 2-3 small non-legal docs (Summary, Action Steps) into a single AI call when generating in batch. Reduces API call count and amortizes system prompt tokens.

**Completed:** Added `BATCH_SUMMARY_SCHEMA`, `generateBatchSummaryDocs()` combined generator, and batch partitioning in `generate-documents.ts`. Falls back to individual generation on failure.

---

## 9 · ~~Consolidate flex-prompts into Generator Registry~~ ✅ DONE
**Impact:** Single routing table instead of two parallel prompt systems  
**Source:** Systems Analysis — Priority 3

`flex-prompts.ts` has its own prompt registry for supplementary doc types (Cover Letter, Engagement Letter, Trust Amendment, etc.), separate from the generator registry in `unified-generator.ts`. Merge into one routing table.

**Completed:** Replaced `FLEX_DOC_TYPES` catch-all with explicit switch cases for all 13 flex types in `loadGenerator()`. Added `isFlexDocType()` type guard.

---

## 10 · ~~Embed Attorney Corrections into KB~~ ✅ DONE
**Impact:** Self-improving knowledge base  
**Source:** Existing backlog

When an attorney corrects a legal point in chat (e.g., "NJ changed this statute in 2024"), detect the correction and offer to save it as a KB resource with embedding.

**Completed:** Added `extractAndSaveCorrections()` to `ai-memory.ts` with regex pre-filter, AI-based correction detection, deduplication, and auto-save as KB resources. Auto-embedded by existing `onKnowledgeResourceWritten` trigger.

---

## 11 · ~~Fix Backfill Toast "Skipped" Count~~ ✅ DONE
**Impact:** UI accuracy  
**Source:** Existing backlog

The "already had embeddings" count in the backfill toast is misleading with `forceAll=true` — it accumulates the "not in this batch" count across all batches. Show unique totals instead.

**Completed:** Backend now returns `total` count via Firestore `count()` query. Frontend removed misleading `totalSkipped` accumulation and shows "X of Y processed" with accurate totals.
