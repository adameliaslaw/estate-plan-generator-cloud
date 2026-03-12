# Estate Plan Generator — Project Conventions

## Deployment
- **Always auto-deploy** after completing any code change. Do NOT wait for user to say "deploy."
- Pipeline: `git add -A` → `git commit` → `git push origin main` → `npm run build` → `npx firebase deploy --only hosting`
- If Cloud Functions were modified, also run `npx firebase deploy --only functions`
- If Firestore/Storage rules were modified, deploy those too
- All deploy commands should use `SafeToAutoRun: true`

## Git
- Push directly to `main` branch (no PRs)
- Write descriptive commit messages with conventional commit prefixes (`feat:`, `fix:`, `refactor:`, etc.)

## Code Style
- Leave CSS inline style lint warnings as-is (do not refactor unless explicitly asked)
- Use existing project patterns (Firestore hooks, component structure, etc.)

## Testing
- Use `UserUser, AdminAdmin` as the test client for verifying features

## Task Continuity
- User may send unrelated requests mid-task (ADHD context) — **finish the current task first**
- Note the request, address it after current work is complete and deployed
- Only pivot if the message indicates something is actively breaking

## Communication

- The user is a domain expert (estate planning law), not a software engineer
- Explain technical concepts in plain language when asked
- Keep artifact documents concise

## VS Code Visual Settings Reference

Current settings (ADHD-optimized, minimal clutter). Re-enable as desired:

| Setting (search in Ctrl+,) | Current | Re-enable when... |
|---|---|---|
| `breadcrumbs.enabled` | OFF | You want to see the file path above the code |
| `editor.minimap.enabled` | OFF | You want a code preview on the right side |
| `editor.renderWhitespace` | none | You want to see spaces/tabs as dots |
| `editor.glyphMargin` | OFF | You want the debug breakpoint column back |
| `editor.folding` | OFF | You want fold arrows to collapse code blocks |
| `editor.lineNumbers` | off | You want line numbers back |
| `files.autoSave` | afterDelay | Already on — auto-saves every 1 second |
| `editor.formatOnSave` | true | Already on — auto-formats code |

### Keyboard shortcuts

- `Ctrl+K, Ctrl+W` — Close all open tabs
- `Ctrl+K, Z` — Zen Mode (full focus, Esc+Esc to exit)
- `Ctrl+Shift+E` — File Explorer sidebar
- `Ctrl+Shift+F` — Search across project
- `Ctrl+Shift+X` — Extensions
- `Ctrl+,` — Settings

### Extensions installed

- **Error Lens** — shows errors inline next to code
- **GitLens** — shows git history on hover

### Workflows

- `/deploy` — auto commit, push, build, deploy (turbo-all)
- `/sync` — pull latest code when switching machines
