#!/usr/bin/env node
/**
 * spawn-agent.cjs
 *
 * Spawn a headless Claude Code session in an isolated git worktree,
 * pre-loaded with the relevant SOP and MEMORY.md.
 *
 * Usage:
 *   node scripts/spawn-agent.cjs <task-type> "<task description>"
 *
 *   <task-type> must match a workflow in .agents/workflows/<task-type>.md
 *               (run with no args to list available types).
 *
 * Examples:
 *   node scripts/spawn-agent.cjs bug-fix "LawPay charge dialog scroll regression"
 *   node scripts/spawn-agent.cjs deploy "ship hosting"
 *   node scripts/spawn-agent.cjs homework-close "close #5 fiduciary addresses"
 *
 * Env:
 *   CLAUDE_BIN     path to claude CLI (default: "claude")
 *   AGENT_MODEL    model for the spawned session (default: "claude-opus-4-7")
 *   DRY_RUN=1      print what would happen, don't spawn or create worktree
 */

const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKFLOWS_DIR = path.join(REPO_ROOT, '.agents', 'workflows');
const MEMORY_PATH = path.join(REPO_ROOT, 'MEMORY.md');
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.AGENT_MODEL || 'claude-opus-4-7';
const DRY_RUN = process.env.DRY_RUN === '1';

function listWorkflows() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return [];
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

function die(msg, code = 1) {
  process.stderr.write(`spawn-agent: ${msg}\n`);
  process.exit(code);
}

const [, , taskType, ...rest] = process.argv;
const taskDescription = rest.join(' ').trim();

const available = listWorkflows();

if (!taskType) {
  process.stdout.write(
    `Usage: node scripts/spawn-agent.cjs <task-type> "<task description>"\n\n` +
      `Available task types:\n` +
      (available.length ? available.map((t) => `  - ${t}`).join('\n') : '  (none — populate .agents/workflows/)') +
      '\n'
  );
  process.exit(0);
}

if (!available.includes(taskType)) {
  die(`unknown task type "${taskType}". Available: ${available.join(', ') || '(none)'}`);
}
if (!taskDescription) {
  die('task description is required (second argument).');
}

const sopPath = path.join(WORKFLOWS_DIR, `${taskType}.md`);
const sop = fs.readFileSync(sopPath, 'utf8');
const memory = fs.existsSync(MEMORY_PATH) ? fs.readFileSync(MEMORY_PATH, 'utf8') : '(MEMORY.md not found)';

const slug = taskDescription
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '')
  .slice(0, 40) || 'task';
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13); // YYYYMMDDTHHMM
const branchName = `agent/${taskType}/${stamp}-${slug}`;
const worktreeDir = path.resolve(REPO_ROOT, '..', `${path.basename(REPO_ROOT)}.worktrees`, `${stamp}-${taskType}-${slug}`);

const prompt =
  `You are running headless in an isolated worktree to handle a "${taskType}" task.\n\n` +
  `# Task\n${taskDescription}\n\n` +
  `# Standard Operating Procedure (.agents/workflows/${taskType}.md)\n${sop}\n\n` +
  `# MEMORY.md (project decisions, patterns, ruled-out paths)\n${memory}\n\n` +
  `# Rules\n` +
  `- Follow CLAUDE.md behavioral rules.\n` +
  `- Stay on branch ${branchName}. Do not push to main.\n` +
  `- Stop and surface tradeoffs if the task is ambiguous; do not guess.\n` +
  `- Verify success criteria from the SOP before reporting done.\n`;

function run(cmd) {
  if (DRY_RUN) {
    process.stdout.write(`[dry-run] ${cmd}\n`);
    return '';
  }
  return execSync(cmd, { cwd: REPO_ROOT, stdio: 'inherit' });
}

process.stdout.write(`spawn-agent: task=${taskType} branch=${branchName}\nworktree=${worktreeDir}\n`);

fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
run(`git worktree add -b ${branchName} ${JSON.stringify(worktreeDir)} HEAD`);

if (DRY_RUN) {
  process.stdout.write('\n--- prompt ---\n' + prompt + '\n--- end prompt ---\n');
  process.exit(0);
}

const args = ['-p', prompt, '--model', MODEL];
const child = spawn(CLAUDE_BIN, args, {
  cwd: worktreeDir,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.stdout.write(
    `\nspawn-agent: claude exited with code ${code}\n` +
      `Worktree retained at: ${worktreeDir}\n` +
      `When finished:\n` +
      `  cd ${worktreeDir} && git push -u origin ${branchName}\n` +
      `  git worktree remove ${worktreeDir}\n`
  );
  process.exit(code || 0);
});
