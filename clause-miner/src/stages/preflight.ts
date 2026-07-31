/**
 * Stage P — Preflight (§11 P0.1). Read-only, no LLM calls, no spend.
 *
 * Answers the two questions that block the pilot, empirically rather than by
 * inspecting a sharing dialog:
 *
 *  1. **Can this service account actually read the corpus?** Not "is there a
 *     grant in the UI" — can it list the root folder AND pull bytes out of a
 *     real file. Those are different permissions in practice, and Stage 1
 *     needs the second one, so a check that only lists would pass while the
 *     conversion pass fails on its first Range request.
 *  2. **What are the curated-seed folder IDs?** Found by name via the Drive
 *     query API, with each match's parent folders reported so two folders
 *     sharing a name can be told apart — a corpus this old has duplicates,
 *     and pointing the seed exclusion at the wrong "Trust Agreements" would
 *     hand Gate 4 a canary that was never held out.
 *
 * Every failure names the identity it authenticated as, because the usual
 * cause is a grant made to a different service account than the one the Job
 * runs as, and "permission denied" without an identity is unactionable.
 */

import { runLedgerPath } from '../paths.js';
import type { Env } from '../env.js';
import type { DocStore, DriveClient, FolderMatch } from '../clients/interfaces.js';

/** The curated-seed folders §11 P1 expects, unless overridden. */
export const DEFAULT_SEED_FOLDER_NAMES = ['AAA WILL PIECES', 'Trust Agreements'];

export interface PreflightReport {
  identity: string | null;
  rootFolderId: string;
  /** Folder metadata, or null when this identity cannot see it at all. */
  rootFolder: { id: string; name: string } | null;
  rootReadable: boolean;
  rootError: string | null;
  rootChildFolders: number;
  rootChildFiles: number;
  /** Proof the drive.readonly grant covers CONTENT, not just metadata. */
  downloadProbe: { attempted: boolean; ok: boolean; fileName: string | null; error: string | null };
  seedFolders: Record<string, FolderMatch[]>;
  /**
   * One-time observation, NOT a gate: how much the earlier wills pipeline
   * actually produced. It reads the same Drive folder through the same
   * identity, and that identity could not reach Drive until 2026-07-31 — so
   * whether any work product exists is worth knowing. Never affects `ready`;
   * the clause miner shares no state with that pipeline.
   */
  priorPipeline: { willsDocuments: number | null; pipelineState: number | null };
  /** True when everything the pilot needs is confirmed. */
  ready: boolean;
  findings: string[];
  nextSteps: string[];
}

export interface PreflightDeps {
  drive: DriveClient;
  store: DocStore;
}

function describeIdentity(identity: string | null): string {
  return identity ?? 'UNKNOWN (could not read the credential identity)';
}

/**
 * Turn the raw probe results into findings and next steps. Pure, so the
 * wording of an operator-facing report is testable.
 */
export function interpretPreflight(
  report: Omit<PreflightReport, 'ready' | 'findings' | 'nextSteps'>,
  expectedNames: readonly string[],
): Pick<PreflightReport, 'ready' | 'findings' | 'nextSteps'> {
  const findings: string[] = [];
  const nextSteps: string[] = [];
  let ready = true;

  findings.push(`Authenticated as: ${describeIdentity(report.identity)}`);

  // Visibility is checked BEFORE contents, because an unshared folder lists
  // as empty rather than erroring — see DriveClient.getFolder.
  if (report.rootFolder === null) {
    ready = false;
    findings.push(
      `❌ The folder ${report.rootFolderId} is NOT VISIBLE to this account — it is not shared with it, or the id is wrong`,
    );
    nextSteps.push(
      `Share the Drive folder ${report.rootFolderId} with ${describeIdentity(report.identity)} ` +
        `as Viewer (untick "Notify people" — it is a robot account). If it IS already shared, the ` +
        `configured id is wrong: open the folder in Drive and send the part of the URL after /folders/.`,
    );
  } else {
    findings.push(`✅ Folder is visible, and it is named "${report.rootFolder.name}"`);
  }

  if (!report.rootReadable) {
    ready = false;
    findings.push(`❌ Cannot read the corpus root folder ${report.rootFolderId}: ${report.rootError ?? 'unknown error'}`);
    nextSteps.push(
      `Share the Drive folder ${report.rootFolderId} ("Wills and Trusts") with ` +
        `${describeIdentity(report.identity)} as Viewer. This is the same grant ` +
        `functions/src/wills-backfill.ts relies on, so if the wills pipeline still runs, ` +
        `check whether that pipeline authenticates as a DIFFERENT account than this one.`,
    );
  } else {
    // Only claim readable when the folder is actually VISIBLE. A listing that
    // "succeeded" by returning nothing for an invisible folder is not a
    // success, and a report printing ❌ NOT VISIBLE beside ✅ readable makes
    // the reader arbitrate between its own two claims. The empty-listing
    // diagnosis below still runs either way — that is the explanation.
    if (report.rootFolder !== null) {
      findings.push(
        `✅ Root folder readable — ${report.rootChildFolders} subfolders, ${report.rootChildFiles} files at the top level`,
      );
    }
    if (report.rootChildFolders === 0 && report.rootChildFiles === 0) {
      // Empty is never a pass. With the visibility check above, the two causes
      // are now distinguishable rather than conflated.
      ready = false;
      if (report.rootFolder === null) {
        findings.push(
          '⚠️ Listed 0 items — expected, since the folder is not visible. Drive returns an empty list rather than an error for a folder you cannot see.',
        );
      } else {
        findings.push(
          `⚠️ "${report.rootFolder.name}" is visible but contains NOTHING this account can see — its CONTENTS are not shared, or it is genuinely empty`,
        );
        nextSteps.push(
          `Confirm the share on ${report.rootFolderId} applies to the folder's contents, and that ` +
            `CLAUSE_MINER_ROOT_FOLDER_ID points at "My Drive → Everybody → Wills and Trusts".`,
        );
      }
    }
  }

  if (report.downloadProbe.attempted) {
    if (report.downloadProbe.ok) {
      findings.push(
        `✅ Content download works (probed "${report.downloadProbe.fileName ?? '?'}") — the grant covers file bytes, not just listings`,
      );
    } else {
      ready = false;
      findings.push(
        `❌ Listing works but DOWNLOAD fails on "${report.downloadProbe.fileName ?? '?'}": ${report.downloadProbe.error ?? 'unknown error'}`,
      );
      nextSteps.push(
        'The grant permits metadata but not content. Check for a Drive DLP / download-restriction ' +
          'policy on the folder, and that the role is Viewer rather than a metadata-only role.',
      );
    }
  }

  for (const name of expectedNames) {
    const matches = report.seedFolders[name] ?? [];
    if (matches.length === 0) {
      ready = false;
      findings.push(`❌ No folder named "${name}" is visible to this account`);
      nextSteps.push(
        `Locate "${name}" in Drive and send its folder id (the part of the URL after /folders/), ` +
          `or confirm the exact spelling — the search is an exact-name match.`,
      );
    } else if (matches.length === 1) {
      findings.push(`✅ "${name}" → ${matches[0].id}  (inside: ${matches[0].parentNames.join(', ') || 'My Drive'})`);
    } else {
      // Not a failure — but a human must choose, because picking the wrong
      // one silently mis-scopes the seed and the canary.
      ready = false;
      findings.push(
        `⚠️ ${matches.length} folders named "${name}" — a human must pick:\n` +
          matches
            .map((m) => `     • ${m.id}  (inside: ${m.parentNames.join(', ') || 'My Drive'})`)
            .join('\n'),
      );
      nextSteps.push(`Choose which "${name}" folder is the curated one and confirm its id.`);
    }
  }

  // Reported, never gating.
  const wd = report.priorPipeline.willsDocuments;
  const ps = report.priorPipeline.pipelineState;
  if (wd === null && ps === null) {
    findings.push('ℹ️ Prior wills pipeline: counts unavailable (could not read those collections)');
  } else {
    findings.push(
      `ℹ️ Prior wills pipeline: wills_documents=${wd ?? '?'}, pipeline_state=${ps ?? '?'}` +
        (wd === 0
          ? ' — EMPTY, so that pipeline produced no work product. Independent of clause mining.'
          : ''),
    );
  }

  if (ready) {
    nextSteps.push(
      'All clear. Set CLAUSE_MINER_SEED_FOLDER_IDS (both ids) and ' +
        'CLAUSE_MINER_CANARY_FOLDER_IDS (the Trust Agreements id) on the Job, then run ' +
        'STAGE=manifest with SAMPLE_LIMIT=60 for the calibration sample.',
    );
  }
  return { ready, findings, nextSteps };
}

export async function runPreflight(deps: PreflightDeps, env: Env): Promise<PreflightReport> {
  const identity = await deps.drive.identity();
  const rootFolder = await deps.drive.getFolder(env.rootFolderId);

  // Best-effort: a missing collection reads as 0, an unreadable one as null,
  // so "could not check" never masquerades as "nothing there" (rule 10).
  const countOrNull = async (path: string): Promise<number | null> => {
    try {
      return await deps.store.count(path);
    } catch {
      return null;
    }
  };
  const priorPipeline = {
    willsDocuments: await countOrNull('wills_documents'),
    pipelineState: await countOrNull('pipeline_state'),
  };

  let rootReadable = false;
  let rootError: string | null = null;
  let rootChildFolders = 0;
  let rootChildFiles = 0;
  const downloadProbe: PreflightReport['downloadProbe'] = {
    attempted: false,
    ok: false,
    fileName: null,
    error: null,
  };

  try {
    const children = await deps.drive.listChildren(env.rootFolderId);
    rootReadable = true;
    for (const child of children) {
      if (child.mimeType === 'application/vnd.google-apps.folder') rootChildFolders++;
      else rootChildFiles++;
    }

    // Probe the operation Stage 1 actually performs: an 8-byte Range read.
    // Prefer a top-level file; otherwise descend one folder to find one.
    let probe = children.find((c) => c.mimeType !== 'application/vnd.google-apps.folder');
    if (probe === undefined) {
      for (const folder of children.filter(
        (c) => c.mimeType === 'application/vnd.google-apps.folder',
      )) {
        try {
          const grandchildren = await deps.drive.listChildren(folder.id);
          probe = grandchildren.find((c) => c.mimeType !== 'application/vnd.google-apps.folder');
        } catch {
          continue;
        }
        if (probe !== undefined) break;
      }
    }
    if (probe !== undefined) {
      downloadProbe.attempted = true;
      downloadProbe.fileName = probe.name;
      try {
        await deps.drive.downloadRange(probe.id, 8);
        downloadProbe.ok = true;
      } catch (err: unknown) {
        downloadProbe.error = String(err);
      }
    }
  } catch (err: unknown) {
    rootError = String(err);
  }

  const names =
    env.seedFolderNames.length > 0 ? env.seedFolderNames : DEFAULT_SEED_FOLDER_NAMES;
  const seedFolders: Record<string, FolderMatch[]> = {};
  for (const name of names) {
    try {
      seedFolders[name] = await deps.drive.findFolders(name);
    } catch (err: unknown) {
      seedFolders[name] = [];
      rootError = rootError ?? `folder search failed: ${String(err)}`;
    }
  }

  const base = {
    identity,
    rootFolderId: env.rootFolderId,
    rootFolder,
    rootReadable,
    rootError,
    rootChildFolders,
    rootChildFiles,
    downloadProbe,
    seedFolders,
    priorPipeline,
  };
  const report: PreflightReport = { ...base, ...interpretPreflight(base, names) };

  // Best-effort ledger write: a preflight that cannot write its report is
  // still a useful preflight, and its findings are on stdout regardless.
  try {
    await deps.store.set(runLedgerPath(env.firmId, env.runId), {
      stage: 'preflight',
      status: report.ready ? 'completed' : 'blocked',
      preflight: { ...report },
      updatedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    report.findings.push(`⚠️ Could not write the run ledger: ${String(err)}`);
  }
  return report;
}

/** Human-readable rendering for the Job log / Actions output. */
export function formatPreflight(report: PreflightReport): string {
  const lines = [
    '',
    '════════════════════════════════════════════════════════════',
    ` CLAUSE-MINER PREFLIGHT — ${report.ready ? 'READY' : 'BLOCKED'}`,
    '════════════════════════════════════════════════════════════',
    '',
    ...report.findings.map((f) => `  ${f}`),
    '',
    '  NEXT:',
    ...report.nextSteps.map((s, i) => `   ${i + 1}. ${s}`),
    '',
    '════════════════════════════════════════════════════════════',
    '',
  ];
  return lines.join('\n');
}
