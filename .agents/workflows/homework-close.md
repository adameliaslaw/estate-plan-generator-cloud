# SOP: Close a HOMEWORK Item

Pattern observed in `git log` — `docs(homework): close #N — <summary>`. `HOMEWORK.md` is the running task ledger.

## Success Criteria
- Underlying work is shipped and verified in prod (not just merged).
- `HOMEWORK.md` entry moved to a "Done" state with date, commit SHA, and one-line outcome.
- Follow-ups (if any) added as new numbered items, not buried in the closed one.

## Steps

1. **Open `HOMEWORK.md`** and locate the item by number. Read the full entry — don't assume.
2. **Confirm the work is actually done:**
   - Code merged to the relevant branch.
   - Deployed (see `deploy.md`).
   - Any user-visible behavior verified in prod.
3. **Update `HOMEWORK.md`:**
   - Mark the item closed with date and the deploying commit SHA.
   - One-line outcome: what now works that didn't before.
   - If verification surfaced new issues, file them as new items — do not hide them inside the closed entry.
4. **Commit:**
   ```bash
   git add HOMEWORK.md
   git commit -m "docs(homework): close #<N> — <one-line outcome>"
   git push
   ```
5. No deploy needed for a docs-only commit.

## Never
- Close an item that hasn't been verified in prod.
- Edit prose of older closed entries (history is a ledger).
- Bundle multiple unrelated closures in one commit — one item per commit.
