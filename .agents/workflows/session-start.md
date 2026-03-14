---
description: Run a quick code health audit at the start of every new session before handling the user's first request
---

# Session Start Workflow

1. Check TypeScript compilation (frontend):
```
npx tsc --noEmit
```

2. Check TypeScript compilation (functions):
```
cd functions; npx tsc --noEmit; cd ..
```
Note: On Windows PowerShell, use `Push-Location functions; npx tsc --noEmit; Pop-Location` instead.

3. Check if dev server is running. If not, start it:
```
npm run dev
```

4. Review any recent git changes:
```
git log -n 3 --oneline
```
