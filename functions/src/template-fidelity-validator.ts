/**
 * functions/src/template-fidelity-validator.ts
 *
 * Structural fidelity validator for template-based document generation.
 *
 * PROBLEM: When AI templatizes a raw document (replacing client data with
 * Handlebars variables), it sometimes alters the HTML structure — adding,
 * removing, or reordering tags. This breaks formatting fidelity.
 *
 * SOLUTION: Compare the HTML tag structure of the original document against
 * the modified (templatized or rendered) version. Compute a fidelity score
 * and identify specific structural changes for AI retry prompts.
 *
 * Used by:
 *  - retemplatize-templates.ts (post-templatization validation)
 *  - process-template-file.ts (upload-time validation)
 *  - template-engine.ts (post-substitution validation)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FidelityResult {
  /** Overall structural similarity score (0.0 to 1.0) */
  score: number;
  /** Whether the structure passes the fidelity threshold */
  passes: boolean;
  /** Tags present in original but missing in modified */
  removedTags: TagDiff[];
  /** Tags present in modified but not in original */
  addedTags: TagDiff[];
  /** Tags whose attributes changed (e.g., class added/removed) */
  changedTags: TagChange[];
  /** Human-readable summary for AI retry prompts */
  summary: string;
  /** Total tag count in original */
  originalTagCount: number;
  /** Total tag count in modified */
  modifiedTagCount: number;
}

export interface TagDiff {
  /** Tag name (e.g., 'p', 'div', 'strong') */
  tag: string;
  /** How many instances were added/removed */
  count: number;
}

export interface TagChange {
  /** Tag name */
  tag: string;
  /** Description of what changed */
  change: string;
}

/** Minimum fidelity score to pass validation */
const FIDELITY_THRESHOLD = 0.85;

// ---------------------------------------------------------------------------
// Tag sequence extraction — strips text content, keeps only HTML structure
// ---------------------------------------------------------------------------

interface TagInfo {
  tag: string;
  classes: string[];
  isClosing: boolean;
  isSelfClosing: boolean;
}

/**
 * Extract an ordered sequence of HTML tags from content.
 * Ignores text content, comments, and `<style>` / `<script>` blocks.
 */
function extractTagSequence(html: string): TagInfo[] {
  // Strip <style> and <script> blocks entirely
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const tags: TagInfo[] = [];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*)?)\s*\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(cleaned)) !== null) {
    const fullMatch = match[0];
    const tagName = match[1].toLowerCase();
    const attrs = match[2] ?? '';

    // Skip processing instructions and doctype
    if (tagName === '!doctype') continue;

    const isClosing = fullMatch.startsWith('</');
    const isSelfClosing = fullMatch.endsWith('/>') ||
      ['br', 'hr', 'img', 'input', 'link', 'meta'].includes(tagName);

    // Extract CSS classes from attributes
    const classMatch = attrs.match(/class\s*=\s*["']([^"']*)["']/i);
    const classes = classMatch
      ? classMatch[1].split(/\s+/).filter(Boolean).sort()
      : [];

    tags.push({ tag: tagName, classes, isClosing, isSelfClosing });
  }

  return tags;
}

/**
 * Build a tag frequency map from a tag sequence.
 * Returns a map of tag name → count (opening tags only).
 */
function buildTagFrequencyMap(tags: TagInfo[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tags) {
    if (t.isClosing) continue; // Only count opening tags
    freq.set(t.tag, (freq.get(t.tag) ?? 0) + 1);
  }
  return freq;
}

/**
 * Build a class frequency map: tracks which CSS classes appear and how often.
 */
function buildClassFrequencyMap(tags: TagInfo[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tags) {
    if (t.isClosing) continue;
    for (const cls of t.classes) {
      freq.set(cls, (freq.get(cls) ?? 0) + 1);
    }
  }
  return freq;
}

// ---------------------------------------------------------------------------
// Core comparison
// ---------------------------------------------------------------------------

/**
 * Compare the HTML structure of an original document against a modified version.
 *
 * This is NOT a text diff — it ignores text content entirely and only looks at
 * the tag structure (element names, ordering, CSS classes). This makes it ideal
 * for validating that templatization didn't alter document formatting.
 *
 * @param original  The original HTML (template or raw uploaded document)
 * @param modified  The modified HTML (templatized, rendered, or AI-generated)
 * @param threshold Optional custom fidelity threshold (default: 0.85)
 * @returns FidelityResult with score, pass/fail, and structural diffs
 */
export function compareHtmlStructure(
  original: string,
  modified: string,
  threshold = FIDELITY_THRESHOLD,
): FidelityResult {
  const origTags = extractTagSequence(original);
  const modTags = extractTagSequence(modified);

  const origFreq = buildTagFrequencyMap(origTags);
  const modFreq = buildTagFrequencyMap(modTags);

  const origClasses = buildClassFrequencyMap(origTags);
  const modClasses = buildClassFrequencyMap(modTags);

  // Count opening tags only
  const origOpenCount = origTags.filter(t => !t.isClosing).length;
  const modOpenCount = modTags.filter(t => !t.isClosing).length;

  // --- Compute tag frequency similarity ---
  const allTags = new Set([...origFreq.keys(), ...modFreq.keys()]);
  let matchingTagCount = 0;
  let totalTagCount = 0;

  const removedTags: TagDiff[] = [];
  const addedTags: TagDiff[] = [];

  for (const tag of allTags) {
    const origCount = origFreq.get(tag) ?? 0;
    const modCount = modFreq.get(tag) ?? 0;
    const minCount = Math.min(origCount, modCount);
    const maxCount = Math.max(origCount, modCount);

    matchingTagCount += minCount;
    totalTagCount += maxCount;

    if (origCount > modCount) {
      removedTags.push({ tag, count: origCount - modCount });
    } else if (modCount > origCount) {
      addedTags.push({ tag, count: modCount - origCount });
    }
  }

  // --- Compute class similarity (important for tr-* formatting) ---
  const allClasses = new Set([...origClasses.keys(), ...modClasses.keys()]);
  let matchingClassCount = 0;
  let totalClassCount = 0;

  const changedTags: TagChange[] = [];

  for (const cls of allClasses) {
    const origCount = origClasses.get(cls) ?? 0;
    const modCount = modClasses.get(cls) ?? 0;
    matchingClassCount += Math.min(origCount, modCount);
    totalClassCount += Math.max(origCount, modCount);

    if (origCount > 0 && modCount === 0) {
      changedTags.push({ tag: cls, change: `CSS class "${cls}" removed (was used ${origCount}x)` });
    } else if (origCount === 0 && modCount > 0) {
      changedTags.push({ tag: cls, change: `CSS class "${cls}" added (${modCount}x)` });
    }
  }

  // --- Compute sequence similarity (order matters) ---
  // Use a simple LCS-based approach on the tag name sequence
  const origSeq = origTags.filter(t => !t.isClosing).map(t => t.tag);
  const modSeq = modTags.filter(t => !t.isClosing).map(t => t.tag);
  const lcsLength = computeLCSLength(origSeq, modSeq);
  const seqSimilarity = origSeq.length > 0
    ? lcsLength / Math.max(origSeq.length, modSeq.length)
    : (modSeq.length === 0 ? 1.0 : 0.0);

  // --- Composite score: 50% frequency match, 30% sequence match, 20% class match ---
  const freqSimilarity = totalTagCount > 0 ? matchingTagCount / totalTagCount : 1.0;
  const classSimilarity = totalClassCount > 0 ? matchingClassCount / totalClassCount : 1.0;

  const score = Math.round(
    (freqSimilarity * 0.5 + seqSimilarity * 0.3 + classSimilarity * 0.2) * 1000,
  ) / 1000;

  // --- Build human-readable summary ---
  const summaryParts: string[] = [];
  if (removedTags.length > 0) {
    summaryParts.push(
      `REMOVED tags: ${removedTags.map(t => `${t.count}x <${t.tag}>`).join(', ')}`,
    );
  }
  if (addedTags.length > 0) {
    summaryParts.push(
      `ADDED tags: ${addedTags.map(t => `${t.count}x <${t.tag}>`).join(', ')}`,
    );
  }
  if (changedTags.length > 0) {
    summaryParts.push(
      `CLASS changes: ${changedTags.map(c => c.change).join('; ')}`,
    );
  }
  if (summaryParts.length === 0) {
    summaryParts.push('Structure matches perfectly.');
  }

  return {
    score,
    passes: score >= threshold,
    removedTags: removedTags.sort((a, b) => b.count - a.count),
    addedTags: addedTags.sort((a, b) => b.count - a.count),
    changedTags,
    summary: summaryParts.join('\n'),
    originalTagCount: origOpenCount,
    modifiedTagCount: modOpenCount,
  };
}

// ---------------------------------------------------------------------------
// LCS (Longest Common Subsequence) — O(n*m) dynamic programming
// Capped at 2000 elements to avoid memory issues with very large templates.
// ---------------------------------------------------------------------------

function computeLCSLength(a: string[], b: string[]): number {
  // Cap to prevent O(n*m) blowup on huge documents
  const MAX = 2000;
  const aSlice = a.length > MAX ? a.slice(0, MAX) : a;
  const bSlice = b.length > MAX ? b.slice(0, MAX) : b;

  const m = aSlice.length;
  const n = bSlice.length;

  // Use two rows instead of full matrix to save memory
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (aSlice[i - 1] === bSlice[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }

  return prev[n];
}

// ---------------------------------------------------------------------------
// Retry prompt builder — generates AI feedback from fidelity results
// ---------------------------------------------------------------------------

/**
 * Build a retry instruction for the AI based on structural fidelity failures.
 * Used when templatization or variable substitution corrupts the HTML structure.
 */
export function buildFidelityRetryInstruction(result: FidelityResult): string {
  const lines: string[] = [
    'CRITICAL — Your output changed the HTML structure of the document. You MUST preserve ALL HTML tags exactly as they appear in the original.',
    '',
    `Structural fidelity score: ${(result.score * 100).toFixed(1)}% (minimum required: 85%)`,
    '',
  ];

  if (result.removedTags.length > 0) {
    lines.push('You REMOVED these tags that MUST be kept:');
    for (const t of result.removedTags) {
      lines.push(`  - <${t.tag}> (${t.count} instances removed)`);
    }
    lines.push('');
  }

  if (result.addedTags.length > 0) {
    lines.push('You ADDED these tags that should NOT be there:');
    for (const t of result.addedTags) {
      lines.push(`  - <${t.tag}> (${t.count} instances added)`);
    }
    lines.push('');
  }

  if (result.changedTags.length > 0) {
    lines.push('CSS class changes detected:');
    for (const c of result.changedTags) {
      lines.push(`  - ${c.change}`);
    }
    lines.push('');
  }

  lines.push('RULES:');
  lines.push('- Do NOT add, remove, or reorder any HTML tags.');
  lines.push('- Do NOT change any CSS classes or inline styles.');
  lines.push('- ONLY replace the text content (client names, addresses, dates) with {{variables}}.');
  lines.push('- Return the COMPLETE HTML with zero structural changes.');

  return lines.join('\n');
}
