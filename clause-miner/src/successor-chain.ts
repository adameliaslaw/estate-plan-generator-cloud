/**
 * §4.2 successor-fiduciary chains: "if X fails to serve, then Y; if Y fails,
 * then Z" collapses in sigText to {{SUCCESSOR_CHAIN}} + {{CHAIN_DEPTH}}
 * (mirroring the children-list collapse), so chain-depth variants join one
 * family as tracked variants instead of fragmenting.
 *
 * Two passes: (1) each chain LINK is replaced by a sentinel marker;
 * (2) runs of markers separated by short, period-free filler ("shall serve; ")
 * collapse to ONE {{SUCCESSOR_CHAIN}} token with the run length preserved as
 * the chain depth.
 *
 * Runs on normText (placeholders already substituted) as the chainCollapse
 * hook of core/sigtext.toSigText. Pure module.
 */

/** One chain link: "if {{X}} fails/ceases/is unable ... {{Y}}" */
const CHAIN_LINK_RE = new RegExp(
  String.raw`if\s+\{\{[A-Z][A-Z_0-9]*\}\}(?:['’]s)?[^.;]{0,80}?` +
    String.raw`(?:fail(?:s|ed)?(?:\s+or\s+cease(?:s|d)?)?|cease(?:s|d)?|is\s+unable|becomes?\s+unable|` +
    String.raw`is\s+unwilling|does\s+not|cannot|shall\s+not)\s+(?:to\s+)?(?:serve|act|qualify|continue)` +
    String.raw`[^.;]{0,120}?\{\{[A-Z][A-Z_0-9]*\}\}`,
  'gi',
);

/** Sentinel that cannot occur in document text (NUL-framed). */
const MARKER = '\u0000CHAINLINK\u0000';
const MARKER_SOURCE = '\\u0000CHAINLINK\\u0000';
/** Marker runs joined by ≤ 80 chars of period/brace-free filler. */
const RUN_RE = new RegExp(`${MARKER_SOURCE}(?:[^.{}]{0,80}?${MARKER_SOURCE})*`, 'g');

export interface ChainCollapseResult {
  text: string;
  /** Chain depths observed (number of links per collapsed run). */
  depths: number[];
}

/** Collapse successor chains; depth preserved as a parameter (§4.2). */
export function collapseSuccessorChains(text: string): ChainCollapseResult {
  const marked = text.replace(CHAIN_LINK_RE, MARKER);
  if (!marked.includes(MARKER)) return { text, depths: [] };
  const depths: number[] = [];
  const collapsed = marked.replace(RUN_RE, (run) => {
    depths.push(run.split(MARKER).length - 1);
    return '{{SUCCESSOR_CHAIN}} {{CHAIN_DEPTH}}';
  });
  return { text: collapsed, depths };
}

/** Hook form for core/sigtext.toSigText({ chainCollapse }). */
export function chainCollapseHook(text: string): string {
  return collapseSuccessorChains(text).text;
}
