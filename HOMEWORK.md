# Estate Plan Generator — Homework

Items requiring human action or decisions before the next agent session can proceed.

---

## 🔲 #1 — Deploy to Firebase

All 9 commits from the April 2026 audit session are pushed to `main` but not yet deployed to production.

Run from the project root with Firebase CLI authenticated to the `estate-plan-generator` project:

```bash
firebase deploy --only hosting
firebase deploy --only functions
```

Or deploy everything at once:

```bash
firebase deploy
```

**What this deploys:**
- Security fixes: `.gitignore` scrub, `injectSecrets.cjs` credential removal
- `high-fidelity` mode guard (HttpsError instead of silent degradation)
- Template mode raw-HTML fallback fix
- Null/undefined critical field detection (`[MISSING: label]` markers)
- `_contextFailed` flag propagation + UI warning badge
- Preloaded context cascade fix (fail-fast on batch preload failure)
- Property index fallback warning + metadata flag
- Typed AI response interfaces (no more `as any` in `ai-client.ts`)
- Full `any` cleanup across 14 functions files

---

## 🔲 #2 — Template coverage decision

Five document types have **no Handlebars templates** — neither in Firestore nor as bundled `.hbs` files:
- Trust (Revocable Living Trust)
- Pour-Over Will
- Deed
- Affidavit of Consideration
- GIT-REP3

When an attorney selects `template` or `hybrid` mode for any of these types, the engine silently falls back to full AI generation. This is functional but undisclosed.

**Choose one:**

**(a) Upload templates** — Use the Knowledge Base admin UI to upload `.hbs` template files for these 5 doc types. The engine will then use them for `template` and `hybrid` modes as intended.

**(b) Add UI disclosure** — In the generation mode selector (`GenerateDocumentsButton.tsx`), warn the user that these doc types have no template and will use AI generation regardless of mode selected. Keeps existing behavior but makes it transparent.

**(c) Defer** — Document the fallback behavior in a comment and leave it for a future session. No user-facing change.

---

## ✅ Credential rotation (still pending user action in GCP/Google consoles)

These were handled in code (credentials removed from tracked files) but the credentials themselves must be revoked:

- **GCP service-account key** `c059f6a569611c0aa9f74fa93fe1d45707f36d21` for `estate-plan-generator@appspot.gserviceaccount.com` — delete in GCP Console → IAM & Admin → Service Accounts → Keys, then create a new key and store it securely (not in git)
- **Google OAuth credentials** — the `GOOGLE_CLIENT_ID` (`749324460027-7f9s3sk22ckmp2r6u2v5u1o51nduck1v.apps.googleusercontent.com`) and `GOOGLE_CLIENT_SECRET` (`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`) that were in `injectSecrets.cjs` — rotate both in Google Cloud Console → APIs & Services → Credentials, then run:
  ```bash
  firebase functions:secrets:set GOOGLE_CLIENT_ID
  firebase functions:secrets:set GOOGLE_CLIENT_SECRET
  ```

---

## Completed (April 2026 audit session)

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
