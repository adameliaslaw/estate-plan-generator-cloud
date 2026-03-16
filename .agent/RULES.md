# Project Rules

## After Every Code Change

After completing ANY task that modifies code files, run the full deploy pipeline before reporting completion to the user:

1. `git add -A && git commit -m "<descriptive message>"`
2. `git push origin main`
3. `npx vite build 2>&1 | Select-Object -Last 5` — verify build passes
4. `npx firebase deploy --only hosting`
5. If Cloud Functions were changed: `npx firebase deploy --only functions`
6. If Firestore rules were changed: `npx firebase deploy --only firestore:rules`

All commands auto-run. Do NOT report task completion until deploy is confirmed.

## Daily Code Health Check

On the first conversation of each day, run this audit before handling the user's request:

1. `npx tsc --noEmit 2>&1 | Select-String "error" | Select-Object -First 20`
2. `npx eslint src/ --quiet --max-warnings 0 2>&1 | Select-String "error" | Select-Object -First 20`
3. `npx vite build 2>&1 | Select-Object -Last 5`
4. `git status --short`

If errors or uncommitted changes exist, report them. If everything passes, proceed silently. Do not auto-fix — only report findings.

## Code Quality

- Never use `any` type — always use `unknown` with proper type narrowing.
- Remove unused imports before committing.
- All commands should auto-run unless they are destructive (deleting files, dropping data, etc.).

## Task Continuity

Never stop or pause an active task to address a new user message unless it is directly related to the current task.

- If the user sends an unrelated message mid-task, acknowledge it briefly but continue the current work to completion first.
- Only pivot if the message indicates a critical issue with the current task (e.g., "stop, that's breaking things").
- Queue unrelated requests and address them after the current task is fully deployed and verified.

## Debugging

- **Never guess at root causes.** Always go straight to the source of truth first — check logs, read error messages, inspect actual data. Do not hypothesize and deploy speculative fixes. Pull the logs, read them, identify the exact failure point, then fix it.
