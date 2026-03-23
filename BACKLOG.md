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
