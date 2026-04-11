# Audit Handoff — Estate Plan Generator

> **Read this first.** This document is a handoff from a Claude Code (desktop CLI) session on 2026-04-11. It exists so that a new Claude Code session — on mobile, web, or another machine — can pick up the audit/fix work with full context. There is **no shared session state** between the CLI and a new session; this file *is* the shared state.

---

## For the agent picking this up

1. Read this entire file before doing anything.
2. The top-priority item is the **P0 security incident** in section 1 — do not skip it.
3. Open questions from the user are in section 5. If the user has already answered them in the new conversation, use those answers; otherwise ask before acting on anything in sections 5.1–5.8.
4. The project has strict rules in `.agent/RULES.md` and `.agent/conventions.md` — read those too.
5. Auto-deploy is expected after code changes (git add → commit → push → build → `firebase deploy --only hosting`, plus `--only functions` if functions changed). Do not skip deploy unless the user says to batch.
6. Never use `any` in TypeScript — use `unknown` with narrowing. This is a hard rule.
7. When you finish an item, check it off in section 6 (Plan) and commit the update to this file so the next session can see progress.

---

## 1. P0 — Exposed GCP service account private key

**`.gitignore` lines 77–89** contain a complete GCP service-account JSON with the private key in plaintext, for `estate-plan-generator@appspot.gserviceaccount.com` (private_key_id `c059f6a569611c0aa9f74fa93fe1d45707f36d21`). `.gitignore` is tracked and has been pushed to the remote `adameliaslaw/estate-plan-generator-cloud`.

**Treat this key as compromised.**

User actions required (only the user can do these):
- Google Cloud Console → IAM → Service Accounts → `estate-plan-generator@appspot.gserviceaccount.com` → Keys → delete key id `c059f6a569611c0aa9f74fa93fe1d45707f36d21`, create a new one.
- Decide repo visibility. If the repo is public on GitHub, audit usage logs for the key and assume it has been scraped.
- Decide whether to rewrite git history with `git filter-repo` (destructive, requires force-push). If the repo is private and the key is rotated, a history rewrite is optional.

Agent actions (safe to do without asking once user confirms the key is rotated, or immediately as a no-risk text cleanup):
- Remove lines 77–89 from `.gitignore` (the embedded JSON block starting with `{` and ending with `}`). This alone is a non-destructive fix.
- **Do not** force-push or rewrite history without explicit user approval in the new session.

---

## 2. Repository / environment facts

- Working directory: `C:\estate-plan-generator`
- Git remote: `https://github.com/adameliaslaw/estate-plan-generator-cloud.git` (note: DEPLOYMENT.md wrongly calls it `estate-plan-generator` — fix that too).
- Branch: `main` (direct push, no PRs per conventions).
- Platform: Windows 11 + bash.
- Stack: React 19 + Vite + Tailwind + shadcn/ui frontend, Firebase Hosting, Firebase Cloud Functions v2 (`us-east1`), Firestore, Cloud Storage.
- Doc generation uses multi-provider AI (Anthropic Claude, OpenAI GPT-4.1, Google Gemini/Vertex) via `functions/src/ai-client.ts` with automatic fallback.
- TypeScript: root and `functions/` both pass `tsc --noEmit` with zero errors as of the audit.
- Tests: vitest under `tests/`. DEPLOYMENT.md claims 500 tests; real count has not been verified.

---

## 3. Audit findings (punch list)

Severities: **P0** = security, **P1** = correctness/stability, **P2** = code health, **P3** = housekeeping.

### P0 — Security
1. **Service-account private key in `.gitignore`** (see section 1). The only P0.
2. **`dangerouslySetInnerHTML` audit** — commit `c3c5d5a` added DOMPurify "to all call-sites." Verify by grepping `src/` for `dangerouslySetInnerHTML` and confirming each is wrapped in `DOMPurify.sanitize(...)`. If any are missed, fix them.
3. **`injectSecrets.cjs`** at repo root — not yet read. Confirm it does not write secrets into any tracked file.

### P1 — Correctness / stability
4. **`high-fidelity` generation mode end-to-end audit.** Commit `f54293f` added `'high-fidelity'` to `GenerationMode` and made it the default in `GenerateDocumentsButton.tsx`. Commit `3df4643` fixed a prior bug where a high-fidelity OR-clause was bypassing AI generators unconditionally for wills/POAs/directives. Trace the mode through:
   - `src/components/documents/GenerateDocumentsButton.tsx`
   - `src/services/document-service.ts` (request shape)
   - `functions/src/generate-documents.ts` (batch entry)
   - `functions/src/unified-generator.ts` (dispatch)
   - `functions/src/template-engine.ts` (rendering paths)
   Confirm the branch is honored consistently and that "high-fidelity" has a clear, non-overlapping semantic vs `template` and `hybrid`. **Open question 5.6 below** — ask the user what high-fidelity is supposed to *do* differently before changing its behavior.
5. **Raw template HTML cap.** `template-engine.ts` historically capped raw template HTML at 15,000 chars in `generateFromTemplateReference()`. BACKLOG.md says this was reduced. Verify the current value; target is ≤ 8,000.
6. **`VARIABLE_TO_QUESTIONNAIRE_MAP` extraction.** BACKLOG claims it was extracted to `template-variables.ts`. Confirm the file exists and that `template-engine.ts` is actually lighter (target ~750 lines).
7. **Silent fallback for doc types without HBS templates.** Trust, Pour-Over Will, Deed, Affidavit, and GIT-REP3 have no default HBS templates, so selecting "Template" or "Hybrid" silently falls back to AI. The UI does not disclose this. Either add templates or surface the fallback in the UI. See open question 5.2.
8. **Preloaded-context fallback path** (`functions/src/generate-documents.ts` around line 216). If the preload fails, each doc independently re-runs `aggregateClientContext()`, which can cascade under load. Consider failing fast or rate-limiting the fallback.
9. **Property-index expansion edge cases.** Deed and Affidavit generators loop over `assets.realEstate`. Confirm empty/undefined arrays do not produce zero-output or crash the batch.
10. **`ai-client.ts` JSON parse safety.** Five `as any` sites on `.json()` responses. Replace with typed response interfaces — AI providers return a stable schema per provider.
11. **Structural validator retry.** BACKLOG says it was added. Confirm that when the validator flags missing sections, the code actually re-prompts the AI instead of merely marking `needs_review`.

### P2 — Code health
12. **~50 `any` / `as any` usages** across `functions/src`. Concentrated files:
    - `ai-client.ts` — 5
    - `knowledge-base.ts` — 7
    - `email-notifications.ts` — ~8
    - `calendar-sync.ts` — 3
    - `audit-trail.ts` — 3
    - Plus assorted Callable/Event handlers. Replace with `CallableRequest<T>` / `FirebaseEvent<T>` generics. Hard rule per `.agent/RULES.md`.
13. **Tracked debug scripts in `functions/`** — these are in git and should be removed (or moved to `scripts/diagnostics/` if the user confirms they are still useful):
    - `check_empty_templates.js`
    - `diff-vars.js`
    - `gen-tpl.js`
    - `get-vars.js`
    - `get-vars-prod.js`
    - `list_services.js`
    - `set_iam_public.js`
14. **Untracked debug artifacts on disk** — `functions/build.log`, `deploy_err.txt`, `deploy_err_utf8.txt`, `eslint_output.txt`, `eslint_output_utf8.txt`, `out.txt`, `output.txt`, `vars.txt`. Already gitignored via `functions/*.txt` + `*.log`, but clutter the working tree. Delete locally.
15. **Duplicate `.agent/` and `.agents/` directories.** `.agent/` has `RULES.md` + `conventions.md` + `workflows/`. `.agents/` has only a partial `workflows/` subset. `.agents/` is orphaned; delete it.
16. **`README.md` is still the Vite boilerplate template.** Replace with project-specific content (project summary, stack, setup reference pointing to `DEPLOYMENT.md`).
17. **`DEPLOYMENT.md` wrong repo name.** Says `adameliaslaw/estate-plan-generator` but the remote is `…-cloud`. Fix.
18. **`DEPLOYMENT.md` stale test count.** Claims 500 tests. Verify with `npx vitest run` and update the table.
19. **Sparse HBS template coverage.** Only `poa-comprehensive.hbs` and `poa-simple.hbs` exist under `functions/src/templates/`. Matches finding 7.
20. **`template-engine.ts` is still ~1,039 lines.** Further decomposition candidates: HBS helpers to `template-helpers.ts`, AI enhancement paths to `template-ai-bridge.ts`. Discuss before refactoring — not a correctness issue.

### P3 — Housekeeping
21. **`functions-backfill/` directory** — unknown purpose. Ask the user (open question 5.5).
22. **`.gitignore` entry format** — after removing the embedded JSON, keep the rest as-is. It is otherwise well-structured.
23. **`gemini.md`** at repo root is a 3-line "ask questions, don't guess" rules file. Consider merging into `.agent/RULES.md` or deleting if redundant.

---

## 4. What is already healthy

Do not rewrite these — they work:

- Unified generator pattern and single `generateDocument()` entry point.
- Template / Hybrid / AI tri-mode pipeline architecture.
- Client data serializer (`client-data-serializer.ts`) as a canonical prompt block.
- Preloaded context for batch generation (eliminates 4× redundant Firestore reads).
- Anthropic → OpenAI content-filter fallback for legal POA language.
- Document structure validator (flags missing signature/notary blocks).
- Document save helper with versioning + dedup.
- TypeScript is clean in both the root and `functions/` trees.

---

## 5. Open questions for the user

If the user has already answered any of these in the new conversation, use those answers. Otherwise, ask before taking action that depends on the answer.

1. **Security — key rotation and history.** Is the GitHub repo public? Do you want me to rewrite git history with `git filter-repo` to purge the leaked key, or just rotate and scrub the current file?
2. **Template coverage.** For Trust, Pour-Over Will, Deed, Affidavit, GIT-REP3 — do you want me to (a) add default HBS templates, (b) disclose the AI fallback in the UI, or (c) defer?
3. **`any` cleanup scope.** Do you want ~50 `any` sites fixed in this pass, or deferred until after correctness fixes land?
4. **Tracked debug scripts.** OK to `git rm` `check_empty_templates.js`, `diff-vars.js`, `gen-tpl.js`, `get-vars.js`, `get-vars-prod.js`, `list_services.js`, `set_iam_public.js`, or are any of these still in use?
5. **`functions-backfill/`.** What is it — active code, one-off migration, or dead?
6. **`high-fidelity` mode semantics.** What should this mode do differently from `template` and `hybrid`? I want to confirm intent before auditing the branch.
7. **Test suite.** Run and fix vitest as part of this pass, or just verify `tsc --noEmit` and `vite build`?
8. **Deploy cadence.** Deploy after every step, or one consolidated deploy at the end of the audit?

---

## 6. Plan of attack

Execute in order. Check off as completed. Commit updates to this file after each step so session-hopping stays coherent.

- [ ] **Step 0 — Confirm questions 5.1–5.8 with the user.**
- [ ] **Step 1 — Scrub `.gitignore`.** Remove lines 77–89 (the embedded JSON). No other edits. Commit message: `security: remove accidentally committed service-account JSON from .gitignore`. Coordinate with user on key rotation (their action) before this goes public, but the scrub itself is safe.
- [ ] **Step 2 — Audit the `dangerouslySetInnerHTML` call-sites.** Grep `src/`, confirm DOMPurify wraps every site. Fix any strays.
- [ ] **Step 3 — Read `injectSecrets.cjs`** and confirm it does not leak secrets.
- [ ] **Step 4 — `high-fidelity` pipeline trace.** Only after the user answers 5.6. Files: `GenerateDocumentsButton.tsx`, `document-service.ts`, `generate-documents.ts`, `unified-generator.ts`, `template-engine.ts`.
- [ ] **Step 5 — Verify raw template HTML cap and `VARIABLE_TO_QUESTIONNAIRE_MAP` extraction** (findings 5, 6).
- [ ] **Step 6 — Fix preloaded-context fallback cascade** (finding 8).
- [ ] **Step 7 — Property-index edge cases** for deeds/affidavits (finding 9).
- [ ] **Step 8 — Typed response interfaces for `ai-client.ts`** (finding 10).
- [ ] **Step 9 — Structural validator retry check** (finding 11).
- [ ] **Step 10 — `any` cleanup** if user approves scope (finding 12).
- [ ] **Step 11 — Delete `.agents/`, tracked debug scripts, local debug artifacts** (findings 13, 14, 15).
- [ ] **Step 12 — Rewrite `README.md`** (finding 16).
- [ ] **Step 13 — Fix `DEPLOYMENT.md` repo name and test count** (findings 17, 18).
- [ ] **Step 14 — Template coverage decision** (finding 7, based on 5.2).
- [ ] **Step 15 — Run `tsc --noEmit`, `vite build`, and `vitest run`** (if 5.7 = yes). Fix fallout.
- [ ] **Step 16 — Deploy** per `.agent/RULES.md`, cadence per 5.8.

---

## 7. How to hand off again

When this session ends (mobile or desktop), before quitting:

1. Tick the boxes in section 6 for what you completed.
2. Add a short `## Session log` entry at the bottom with date, device, and what changed.
3. `git add AUDIT_HANDOFF.md && git commit -m "handoff: audit progress update" && git push origin main`.

The next session — wherever it lives — will `git pull` and read this file first.

---

## 8. Session log

- **2026-04-11 — desktop CLI (Claude Code, Windows).** Initial audit performed. No code changes yet. P0 security incident identified. Waiting on user answers to open questions before starting step 1.
