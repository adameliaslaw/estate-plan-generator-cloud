# functions-backfill

Intentionally separate Firebase Functions package for Firestore embedding backfill jobs.

Kept isolated from `functions/` to avoid out-of-memory failures: the main package
(`functions/`) pulls in Vertex AI, mammoth, pdf-parse, and other heavy dependencies
(~200 MB+). Running backfill jobs from that package caused Cloud Function OOM errors.
This package has only the lightweight dependencies required for embedding generation
(Gemini `gemini-embedding-001`, 768 dimensions) — significantly reducing cold-start
memory pressure.

## Functions
- `backfillEmbeddings` — backfills vector embeddings for knowledge base documents
- `backfillTemplateEmbeddings` — backfills vector embeddings for template records
