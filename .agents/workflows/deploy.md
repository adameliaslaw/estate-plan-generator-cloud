---
description: Commit all changes, push to GitHub, build, and deploy to Firebase
---

# Deploy Workflow

// turbo-all

## Determine Deploy Scope

Before deploying, check which files changed since the last commit:
```
git diff --name-only HEAD
```

Use the output to determine the minimal deploy target:

| What changed | Deploy command |
|---|---|
| Only `src/` (frontend) | `firebase deploy --only hosting` |
| Only `firestore.rules` | `firebase deploy --only firestore:rules` |
| Only `storage.rules` | `firebase deploy --only storage` |
| Only specific function files in `functions/src/` | `firebase deploy --only functions:fnName1,functions:fnName2` |
| `functions/src/index.ts` or shared utils | `firebase deploy --only functions` (all functions) |
| Multiple areas | Combine flags, e.g. `firebase deploy --only hosting,functions:generateFlexDocument` |
| Everything or unclear | `firebase deploy --only "hosting,functions,firestore:rules,storage"` |

**Mapping function files → function names:** Each export name in `functions/src/index.ts` is a function name.
For example, if `generate-flex-document.ts` changed, deploy `functions:generateFlexDocument`.
If a shared utility (e.g. `ai-client.ts`, `template-engine.ts`) changed, deploy all functions that import it, or simply `functions` if many are affected.

## Steps

1. Stage and commit all changes:
```
git add -A; git commit -m "deploy: latest changes"
```

2. Push to GitHub:
```
git push origin main
```

3. Build the frontend (skip if no frontend changes):
```
npx vite build
```

4. Build Cloud Functions (skip if no function changes):
```
cd functions; npm run build; cd ..
```
Note: On Windows PowerShell, use `Push-Location functions; npm run build; Pop-Location` instead.

5. Deploy to Firebase using the scoped command determined above:
```
firebase deploy --only <targets>
```
