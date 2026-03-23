# Estate Plan Generator — Feature Backlog

## RAG & AI Enhancements

### Cross-Client Semantic Search of Chat Insights
**Priority:** Medium | **Effort:** 2-3 hours

Embed extracted key facts from chat conversations into the vector store so they're semantically searchable across clients. Currently, key facts are saved per client but only retrievable via direct Firestore query (by client ID), not via similarity search.

**Use cases:**
- "Which clients wanted spray trusts?" → finds all clients where that was discussed
- "Any clients with special needs planning?" → surfaces SNT conversations
- Document generation pulls relevant chat insights as additional context

**Implementation:**
1. After `extractAndSaveKeyFacts`, generate embedding for each fact
2. Store in `firms/{firmId}/chatInsights` collection with `clientId` tag + embedding vector
3. Add `chatInsights` to the `searchKnowledgeBase` query alongside `knowledgeBase`
4. Scope results by `clientId` for single-client context, firm-wide for admin queries

---

### Embed Attorney Corrections into KB
**Priority:** Low | **Effort:** 1-2 hours

When an attorney corrects a legal point in chat (e.g., "NJ changed this statute in 2024"), detect the correction and offer to save it as a KB resource with embedding — so future queries reflect the updated information.

---

## UI / UX

### Fix Backfill Toast "Skipped" Count
**Priority:** Low | **Effort:** 30 min

The "already had embeddings" count in the backfill toast is misleading with `forceAll=true` — it accumulates the "not in this batch" count across all batches. Show unique totals instead.

---

### Vector Search for Template Matching
**Priority:** Medium | **Effort:** 3-4 hours

Currently `getTemplate()` uses a simple Firestore field query (`docType + softwareSource`) to find templates. The user must manually select the "Template Source" from a dropdown. Enhance this with vector search so the system auto-selects the best-matching template based on semantic similarity — leveraging the embeddings already created during template upload.

**Benefits:**
- No need for manual Template Source selection
- Better template matching when doc types have multiple variants
- Seamlessly incorporates new template sources without UI changes

**Implementation:**
1. When templates are uploaded via `BulkTemplateUploadDialog`, embeddings are already generated
2. In `getTemplate()`, add a vector search fallback: if no template matches the exact `softwareSource`, search for semantically similar templates
3. Use the existing `searchKnowledgeBase()` infrastructure to query template embeddings
4. Rank results by similarity score and use the top match
