# SOP: Deploy

Project: `estate-plan-generator`. Region: `us-east1`. Node 20.

## Success Criteria
- `tsc --noEmit` clean at root and in `functions/`.
- `npm run build` succeeds.
- Only the changed targets deployed.
- Post-deploy smoke check passes.

## Decide What To Deploy

| Files changed | Targets |
|---|---|
| `src/**`, `index.html`, `vite.config.ts` | `hosting` |
| `functions/src/**`, `functions/package.json` | `functions` (or `functions:<name>`) |
| `firestore.rules` | `firestore:rules` |
| `firestore.indexes.json` | `firestore:indexes` (deploy with code that depends on it) |
| `storage.rules` | `storage` |

Do **not** run `firebase deploy` with no flag unless everything legitimately changed.

## Steps

1. **Pre-flight (parallel):**
   ```bash
   npx tsc --noEmit
   ( cd functions && npx tsc --noEmit )
   npm run lint
   npm run build
   ```
   Stop on any error. Do not deploy with type errors.

2. **Commit + push** (feature branch, never directly to `main` from an agent session unless explicitly authorized):
   ```bash
   git add -A
   git commit -m "<conventional message>"
   git push -u origin <branch>
   ```

3. **Deploy only what changed:**
   ```bash
   firebase deploy --only hosting --project estate-plan-generator
   firebase deploy --only functions:<name> --project estate-plan-generator
   firebase deploy --only firestore:rules --project estate-plan-generator
   ```

4. **Smoke check.** Open the affected page or hit the affected function; confirm no regression.

## Never
- Skip the type-check.
- Rename a deployed function in place — clients cache the old name. Add a new export and deprecate.
- Change region or Node runtime as part of an unrelated deploy.
- Commit secrets. New env vars belong in `.env.example`; real values via `injectSecrets.cjs` / Firebase config.
