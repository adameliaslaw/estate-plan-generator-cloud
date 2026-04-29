# SOP: Bug Fix

Most recurring task in this repo (see `git log` — payments, CSP, LawPay, Hosted Fields). Goal: minimal, root-cause fix that ships.

## Success Criteria
- Failure reproduced or confirmed in logs before any code change.
- Smallest diff that addresses the root cause; no drive-by refactors.
- `npm run build` and `npx tsc --noEmit` pass at root **and** in `functions/`.
- Manually verified in browser if UI; via Functions logs if backend.
- Deployed to the affected target only.

## Steps

1. **Reproduce / confirm.** Pull logs first — never guess.
   - Frontend: open the page, watch DevTools console + network.
   - Functions: `firebase functions:log --only <name>` or Cloud Logging.
   - Firestore rules: emulator (`firebase emulators:start --only firestore`).
2. **Identify the exact failure point.** File + line. State the root cause in one sentence before editing.
3. **Surface tradeoffs** if the fix has more than one shape; pick the smallest.
4. **Edit only the offending file(s).** No formatting churn, no unused-import cleanups in unrelated files.
5. **Verify locally:**
   ```bash
   npx tsc --noEmit
   cd functions && npx tsc --noEmit && cd ..
   npm run lint
   npm run build
   npm run test    # if a test exists for this area
   ```
6. **Commit** with a tight conventional-commit message: `fix(<area>): <what>`.
7. **Deploy** the affected target only:
   - UI-only → `firebase deploy --only hosting`
   - Function → `firebase deploy --only functions:<name>`
   - Rules → `firebase deploy --only firestore:rules` (or `storage`)
8. **Verify in prod** (open the page / re-trigger the flow) before reporting done.

## Never
- Loosen `firestore.rules` / `storage.rules` to make a bug "go away".
- Catch-and-swallow errors instead of fixing them.
- Bypass hooks (`--no-verify`).
- Edit attorney-reviewed `.hbs` prose.
