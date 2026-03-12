---
description: Run a quick code health audit at the start of every new session before handling the user's first request
---

# Session Start — Code Health Audit

Run this workflow **once per day** — on the first conversation of the day only. If you've already run it today (check git log timestamps or prior conversation context), skip it and proceed directly to the user's request.

// turbo-all

## Steps

1. Run `npx tsc --noEmit 2>&1 | Select-String "error" | Select-Object -First 20` from `c:\estate-plan-generator` to check for TypeScript compilation errors.

2. Run `npx eslint src/ --quiet --max-warnings 0 2>&1 | Select-String "error" | Select-Object -First 20` from `c:\estate-plan-generator` to check for ESLint errors (not warnings).

3. Run `npx vite build 2>&1 | Select-Object -Last 5` from `c:\estate-plan-generator` to verify the production build succeeds.

4. Run `git status --short` from `c:\estate-plan-generator` to check for uncommitted changes left over from a prior session.

5. Review the results:
   - If **any TypeScript or build errors** exist, report them to the user immediately with a summary before proceeding.
   - If **uncommitted changes** exist, flag them and ask whether to commit or discard.
   - If **ESLint errors** exist, note them but don't block — mention them after handling the user's request.
   - If everything passes, proceed silently to the user's request without interrupting.

> **Important**: This audit should be quick (~30 seconds). Do NOT refactor or fix issues automatically — only report findings. The user decides what to address.
