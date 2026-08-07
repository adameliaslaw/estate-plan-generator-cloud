/**
 * templatize-samples.cjs
 *
 * Convert the firm's literal Word samples (samples/interactivelegal, exported
 * from InteractiveLegal/HotDocs) into .docx templates for docxtemplater.
 *
 * Usage:
 *   npm ci --prefix functions          # pizzip lives in functions/, not root
 *   node scripts/diagnostics/templatize-samples.cjs
 *
 * Output: functions/templates/*.docx
 *
 * Three things this has to get right, each of which the naive version got
 * wrong and each of which leaks a real client's name or address into every
 * document generated from the template:
 *
 *   1. Delimiters. functions/src/docx-fidelity.ts configures docxtemplater
 *      with `{{ }}`. A template emitting single-brace `{client_name}` is not
 *      a placeholder at all — it survives the fill and prints literally.
 *      Placeholder names below are the field names from buildDocxTemplateData.
 *
 *   2. Run splitting. Word breaks a paragraph into <w:r>/<w:t> runs at
 *      arbitrary points (rsid, spell-check state, formatting). "Vita Maria
 *      Rizzo" is visible 12 times in Rizzo Living Trust.docx and appears
 *      0 times in the raw document.xml, because it is stored as
 *      <w:t>Vita </w:t>…<w:t>Maria Rizzo</w:t>. A regex over the XML sees
 *      nothing and silently replaces nothing. So we match on each
 *      paragraph's concatenated run text and write the replacement back
 *      across the runs it spanned, preserving the surrounding formatting.
 *
 *   3. Coverage. A sample will names the whole family — successor executors,
 *      trustees, guardians, children — not just the testator and spouse.
 *      Every one of them is a real person. The maps below are exhaustive per
 *      document set, and verifyTemplate() re-reads what we wrote and fails
 *      the run if any mapped literal survived, so a miss cannot pass quietly.
 *
 * The firm's own execution block (witnesses, office address, phone, attorney
 * of record) is deliberately NOT templatized — it is the same on every
 * document this firm issues. See FIRM_IDENTITY.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// pizzip is a functions/ dependency, not a root one. Resolve it from there so
// this runs from a clean checkout instead of dying on "Cannot find module".
let PizZip;
try {
  const functionsRequire = createRequire(
    path.join(REPO_ROOT, 'functions', 'package.json'),
  );
  PizZip = functionsRequire('pizzip');
} catch {
  console.error(
    'FATAL: could not load pizzip from functions/node_modules.\n' +
      '       Run `npm ci --prefix functions` first.\n' +
      '       (This is a setup failure, not a clean scan.)',
  );
  process.exit(2);
}

// ---------------------------------------------------------------------------
// OOXML run-aware replacement
// ---------------------------------------------------------------------------

const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
const TEXT_NODE_RE = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function xmlEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Force xml:space="preserve" so leading/trailing spaces survive the rewrite. */
function withSpacePreserve(openTag) {
  if (/\sxml:space=/.test(openTag)) return openTag;
  return openTag.replace(/^<w:t/, '<w:t xml:space="preserve"');
}

/**
 * Replace `pairs` inside one paragraph's XML, matching across run boundaries.
 * Returns { xml, counts } where counts is literal -> replacements made.
 */
function replaceInParagraph(paragraphXml, pairs) {
  const nodes = [];
  for (const m of paragraphXml.matchAll(TEXT_NODE_RE)) {
    nodes.push({
      openTag: m[1],
      closeTag: m[3],
      text: xmlUnescape(m[2]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  const counts = Object.create(null);
  if (nodes.length === 0) return { xml: paragraphXml, counts };

  // Concatenated visible text, plus where each node starts within it.
  const offsets = [];
  let joined = '';
  for (const node of nodes) {
    offsets.push(joined.length);
    joined += node.text;
  }

  // Collect every match first, then apply right-to-left so earlier offsets
  // stay valid. Longest literal first: "VITA MARIA RIZZO" must win over
  // "MARIA RIZZO", and "RIZZO FAMILY LIVING TRUST" over both.
  const matches = [];
  const taken = new Array(joined.length).fill(false);
  for (const { literal, resolve } of pairs) {
    let from = 0;
    for (;;) {
      const at = joined.indexOf(literal, from);
      if (at === -1) break;
      const end = at + literal.length;
      // Skip anything already claimed by a longer literal.
      let overlaps = false;
      for (let i = at; i < end; i += 1) {
        if (taken[i]) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps) {
        for (let i = at; i < end; i += 1) taken[i] = true;
        // Resolved per occurrence: the same person is the spouse in one
        // sentence and the Executor two articles later.
        matches.push({ at, end, placeholder: resolve(joined, at, end), literal });
      }
      from = at + 1;
    }
  }
  if (matches.length === 0) return { xml: paragraphXml, counts };

  matches.sort((a, b) => b.at - a.at);

  for (const match of matches) {
    // Nodes this match spans.
    let firstIdx = -1;
    let lastIdx = -1;
    for (let i = 0; i < nodes.length; i += 1) {
      const nodeStart = offsets[i];
      const nodeEnd = nodeStart + nodes[i].text.length;
      if (nodeEnd > match.at && firstIdx === -1) firstIdx = i;
      if (nodeStart < match.end) lastIdx = i;
    }
    if (firstIdx === -1 || lastIdx === -1) continue;

    const head = nodes[firstIdx].text.slice(0, match.at - offsets[firstIdx]);
    const tail = nodes[lastIdx].text.slice(match.end - offsets[lastIdx]);

    // Placeholder inherits the formatting of the run the match started in.
    nodes[firstIdx].text = head + match.placeholder;
    for (let i = firstIdx + 1; i < lastIdx; i += 1) nodes[i].text = '';
    if (lastIdx > firstIdx) nodes[lastIdx].text = tail;
    else nodes[firstIdx].text += tail;

    counts[match.literal] = (counts[match.literal] || 0) + 1;

    // Offsets shift for everything after this match; we apply right-to-left,
    // so recompute rather than track deltas.
    let running = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      offsets[i] = running;
      running += nodes[i].text.length;
    }
  }

  // Rebuild the paragraph from the (possibly rewritten) nodes.
  let out = '';
  let cursor = 0;
  for (const node of nodes) {
    out += paragraphXml.slice(cursor, node.start);
    out += withSpacePreserve(node.openTag) + xmlEscape(node.text) + node.closeTag;
    cursor = node.end;
  }
  out += paragraphXml.slice(cursor);
  return { xml: out, counts };
}

/** Apply `pairs` across every paragraph of a document.xml. */
function replaceInDocument(xml, pairs) {
  const totals = Object.create(null);
  const out = xml.replace(PARAGRAPH_RE, (paragraph) => {
    const { xml: rewritten, counts } = replaceInParagraph(paragraph, pairs);
    for (const [literal, n] of Object.entries(counts)) {
      totals[literal] = (totals[literal] || 0) + n;
    }
    return rewritten;
  });
  return { xml: out, totals };
}

// ---------------------------------------------------------------------------
// Reading .docx text (for verification)
// ---------------------------------------------------------------------------

function documentText(xml) {
  const paragraphs = [];
  for (const p of xml.match(PARAGRAPH_RE) || []) {
    let text = '';
    for (const m of p.matchAll(TEXT_NODE_RE)) text += xmlUnescape(m[2]);
    paragraphs.push(text);
  }
  return paragraphs.join('\n');
}

function readDocumentXml(filePath) {
  const zip = new PizZip(fs.readFileSync(filePath, 'binary'));
  return zip.file('word/document.xml').asText();
}

// ---------------------------------------------------------------------------
// Entity maps
//
// Placeholder names that exist in buildDocxTemplateData (functions/src/
// docx-fidelity.ts) fill from client data. Names that do not are marked
// UNBACKED below and render blank with a warning — blank is the correct
// failure mode here; a real person's name is not.
// ---------------------------------------------------------------------------

const BACKED_FIELDS = new Set([
  'clientFullName', 'spouseFullName', 'clientAddress', 'clientCity',
  'clientCounty', 'clientState', 'clientZip', 'clientDob', 'maritalStatus',
  'executorName', 'alternateExecutorName', 'trusteeName',
  'alternateTrusteeName', 'guardianName', 'alternateGuardianName',
  'poaAgentName', 'poaAlternateAgentName', 'healthcareAgentName',
  'childCount', 'childrenNames', 'hasMinorChildren', 'estimatedTotalAssets',
  'firmName', 'attorneyName', 'todayFormatted', 'todayISO',
]);

const CLIENT_ADDRESS = '{{clientAddress}}, {{clientCity}}, {{clientState}}';

/**
 * A person's placeholder is decided by the slot they occupy in the sentence,
 * not by who they are.
 *
 * A spouse commonly serves as the other's Executor, so in a sample the same
 * name lands in both the "I am married to X" recital and the Executor
 * appointment. Mapping the name to one placeholder is wrong either way round:
 * pick {{spouseFullName}} and a client whose executor is not their spouse
 * gets the spouse's name in the Executor slot; pick {{executorName}} and the
 * marriage recital breaks. Both placeholders have to appear, each where its
 * role is being appointed — when the spouse *is* the executor both resolve to
 * the same person and the document reads exactly as it does today.
 *
 * The same applies further down. In this set Anthony Esernio is the successor
 * Funeral Representative, the First Level Successor Executor, a guardian, and
 * the First Level Successor Attorney-in-Fact; Cathleen Esernio is the Second
 * Level Successor Executor, a guardian, the Second Level Successor
 * Attorney-in-Fact, and the First Level Successor Health Care Representative.
 * One placeholder each cannot express that.
 */
const ROLE_PLACEHOLDERS = {
  // index = 0 primary, 1 first successor, 2 second, 3 third
  executor: [
    '{{executorName}}',
    '{{alternateExecutorName}}',
    '{{secondAlternateExecutorName}}',
    '{{thirdAlternateExecutorName}}',
  ],
  trustee: ['{{trusteeName}}', '{{alternateTrusteeName}}'],
  guardian: ['{{guardianName}}', '{{alternateGuardianName}}'],
  poaAgent: [
    '{{poaAgentName}}',
    '{{poaAlternateAgentName}}',
    '{{poaSecondAlternateAgentName}}',
  ],
  healthcareAgent: [
    '{{healthcareAgentName}}',
    '{{healthcareAlternateAgentName}}',
    '{{healthcareSecondAlternateAgentName}}',
  ],
  funeralRepresentative: [
    '{{funeralRepresentativeName}}',
    '{{successorFuneralRepresentativeName}}',
  ],
};

/**
 * Scanned FORWARD from the name, because these instruments always read
 * "NAME, of ADDRESS, to serve as ROLE". Scanning backwards would make every
 * child listed after "to serve as Trustee for my children, ..." a trustee.
 * First cue within the window wins.
 */
const APPOINTMENT_CUES = [
  [/Funeral Representative/, 'funeralRepresentative'],
  [/Attorney-in-Fact/, 'poaAgent'],
  [/Health Care Representative/, 'healthcareAgent'],
  [/\bguardians?\b/i, 'guardian'],
  [/(?:as|serve as)\s+(?:an?\s+)?(?:Co-)?Trustees?\b/, 'trustee'],
  [/(?:to serve as|as)\s+Executor\b/, 'executor'],
];

const CUE_WINDOW = 260;

/**
 * Which rank of the role this is. The ordinal sits either in the paragraph's
 * heading ("Appointment of Second Level Successor Executor.") or between the
 * name and the cue ("to act as my successor Funeral Representative"), so both
 * spans are searched. The heading can be far from the name — the whole
 * preceding text of the paragraph is used rather than a fixed window.
 */
function ordinalOf(before, between) {
  const span = `${before} ${between}`;
  if (/Third Level|Third Successor/i.test(span)) return 3;
  if (/Second Level|Second Successor/i.test(span)) return 2;
  if (/First Level|successor|substitute|alternate/i.test(span)) return 1;
  return 0;
}

/**
 * Two people can be appointed to one slot: "I appoint my parents, A and B, as
 * guardians". They are still two different people, so the second gets its own
 * placeholder rather than repeating the first — otherwise the template says
 * "{{guardianName}} and {{guardianName}}" and prints one name twice.
 * Matches both "A and B" and "A and my sister-in-law, B".
 */
const CO_APPOINTEE_TAIL = /\band\b(?:\s+(?:my|our)\s+[A-Za-z-]+\s*,?)?\s*$/;

/** The same join, read forwards: what may sit between two co-appointees. */
const CO_APPOINTEE_JOIN = /^[\s,]*and\b(?:\s+(?:my|our)\s+[A-Za-z-]+\s*,?)?\s*$/;

/**
 * How far ahead a role cue may bind to this name.
 *
 * A cue stops belonging to a name once another person is named in between —
 * the POA opens "I, PRINCIPAL, residing at …, designate my husband, AGENT, to
 * be my Attorney-in-Fact", and without this the Principal reaches past the
 * agent and claims the agent's cue. Co-appointees are stepped over rather
 * than treated as interruptions, so "my parents, A and B, as guardians" still
 * reaches its cue from A.
 */
function cueWindow(after, peopleGlobalRe) {
  peopleGlobalRe.lastIndex = 0;
  let cursor = 0;
  let m;
  while ((m = peopleGlobalRe.exec(after)) !== null) {
    if (!CO_APPOINTEE_JOIN.test(after.slice(cursor, m.index))) {
      return after.slice(0, m.index);
    }
    cursor = m.index + m[0].length;
    peopleGlobalRe.lastIndex = cursor;
  }
  return after;
}

const asCoPlaceholder = (placeholder) =>
  placeholder.replace(
    /^\{\{(\w)(\w*)\}\}$/,
    (_, first, rest) => `{{co${first.toUpperCase()}${rest}}}`,
  );

/** Resolve one person occurrence to a placeholder. */
function resolvePerson(fallback, people, joined, at, end) {
  const after = cueWindow(joined.slice(end, end + CUE_WINDOW), people.global);
  let best = null;
  for (const [pattern, role] of APPOINTMENT_CUES) {
    const m = pattern.exec(after);
    if (m && (best === null || m.index < best.index)) {
      best = { index: m.index, role };
    }
  }
  // No appointment cue ahead — this is a recital ("I am married to X") or a
  // list of children, where the person's own default is right.
  if (!best) return fallback;

  const before = joined.slice(0, at);
  const ranks = ROLE_PLACEHOLDERS[best.role];
  const rank = ordinalOf(before, after.slice(0, best.index));
  const placeholder = ranks[Math.min(rank, ranks.length - 1)];

  const tail = before.slice(-80);
  if (CO_APPOINTEE_TAIL.test(tail) && people.plain.test(tail)) {
    return asCoPlaceholder(placeholder);
  }
  return placeholder;
}

/**
 * An address belongs to the nearest person named before it — the documents
 * write "NAME, of ADDRESS". This runs as a second pass, after the names are
 * already placeholders, so the owner is simply the closest preceding tag.
 */
function resolveAddressByOwner(joined, at) {
  const before = joined.slice(0, at);
  const tags = [...before.matchAll(/\{\{(\w+)\}\}/g)];
  const owner = tags.length ? tags[tags.length - 1][1] : 'clientFullName';
  if (owner === 'clientFullName' || owner === 'clientAddress') {
    return CLIENT_ADDRESS;
  }
  return `{{${owner.replace(/(?:Full)?Name$/, '')}Address}}`;
}

/** Jessica Byrnes married set: will, power of attorney, health care directive. */
const BYRNES_PEOPLE = {
  'JESSICA BYRNES': '{{clientFullName}}',
  'SEAN BYRNES': '{{spouseFullName}}',
  'ANTHONY ESERNIO': '{{alternateExecutorName}}',
  'CATHLEEN ESERNIO': '{{secondAlternateExecutorName}}',
  'JEANA ESERNIO': '{{thirdAlternateExecutorName}}',
  'JAMES ESERNIO': '{{trusteeName}}',
  'OLIVIA ESERNIO': '{{alternateGuardianName}}',
  'JACK BYRNES': '{{childOneName}}',
  'LYLA BYRNES': '{{childTwoName}}',
  'MADELYN BYRNES': '{{childThreeName}}',
};

const BYRNES_ADDRESSES = [
  '16 Saddle Court, Monroe Township, New Jersey',
  '315 East 72nd Street, Apt. PH, New York, New York',
];

/**
 * Rizzo trust + pour-over set. Vito is the client, Vita Maria the spouse.
 *
 * Deliberately NOT role-resolved. A joint revocable trust makes the grantors
 * their own initial trustees — "We appoint Vito Rizzo and Vita Maria Rizzo to
 * serve as Co-Trustees" — so an Executor/Trustee cue here would collapse two
 * different people onto {{trusteeName}}. Naming them {{clientFullName}} and
 * {{spouseFullName}} in the trustee slots is what the instrument means. The
 * successor-trustee sentences read correctly under the same mapping:
 * "We appoint our daughter, {{childOneName}}, to serve as a Trustee if and
 * when {{clientFullName}} fails to qualify".
 */
const RIZZO = {
  'RIZZO FAMILY LIVING TRUST': '{{trustName}}',
  'VITA MARIA RIZZO': '{{spouseFullName}}',
  'VITO RIZZO': '{{clientFullName}}',
  'SARINA MARIE CASISA': '{{childTwoName}}',
  'LISA ANN RIZZO': '{{childOneName}}',
  'JOSEPH CASISA': '{{childTwoSpouseName}}',
  'LIA CASISA': '{{grandchildOneName}}',
  '603 Waterside Boulevard, Monroe Township, New Jersey': CLIENT_ADDRESS,
  '549 Laurelwood Court, Howell, New Jersey': '{{childOneAddress}}',
  '190 River Road, Edgewater, New Jersey': '{{childTwoAddress}}',
  '125 Texas Avenue, Lower Township, New Jersey': '{{trustPropertyAddress}}',
  'January 9, 2026': '{{todayFormatted}}',
  // The trust preamble names the grantors' municipality on its own, with no
  // street. Scoped to "residing at" so the firm's own Monroe Township office
  // address in the execution block is left alone.
  'residing at Monroe Township, New Jersey':
    'residing at {{clientCity}}, {{clientState}}',
};

/**
 * The attesting witnesses, templatized rather than allowlisted.
 *
 * These two sign at the firm's own address, which is good reason to think
 * they are firm staff — but that is an inference about people, and a template
 * should not be built on one. Substituting them is correct either way: if
 * they are the firm's standing witnesses the placeholders fill from firm
 * settings, and if they are ever not, nothing of theirs is carried into
 * another client's document. It also survives the ordinary case of a witness
 * being out on the day of execution.
 *
 * Note this is what makes the gate cover them at all: the residual CAPS scan
 * cannot see "KAREN M. CLAYTON" (the initial breaks the name pattern), but
 * every mapped literal is checked explicitly after writing.
 */
const WITNESSES = {
  'LORI PENSABENE': '{{witnessOneName}}',
  'KAREN M. CLAYTON': '{{witnessTwoName}}',
};

/**
 * The firm's own details. These are correct to keep literal — every document
 * this firm issues carries the same office and attorney of record.
 * Listed so the residual scan does not flag them as leaked client data.
 */
const FIRM_IDENTITY = [
  'Adam J. Elias',
  'ADAM J. ELIAS',
  'Elias Counsel',
  '168 Prospect Plains Road',
  'Monroe Township, New Jersey 08831',
  '(609) 655-3200',
  '050452014',
];

// ---------------------------------------------------------------------------
// Residual scan — the gate that makes a miss loud
// ---------------------------------------------------------------------------

const LEGAL_CAPS = new Set(
  `THE OF AND OR TO IN A AN I MY IF IS NOT NO SHALL WILL TESTAMENT LAST ARTICLE
   SECTION NEW JERSEY YORK STATE COUNTY MIDDLESEX EXECUTOR EXECUTORS TRUSTEE
   TRUSTEES TRUST POWER ATTORNEY HEALTH CARE DIRECTIVE ADVANCE LIVING WITNESS
   WITNESSES NOTARY PUBLIC SS OBJ STD POA HC DECLARATION APPOINTMENT PROXY
   AGENT PRINCIPAL GUARDIAN GUARDIANS FUNERAL REPRESENTATIVE CODICIL ESTATE
   RESIDUARY MINOR MINORS DISABLED PERSON PERSONS PROVISIONS FIDUCIARY FIDUC
   PROV GENERAL SPECIAL DURABLE REVOCABLE AGREEMENT SETTLOR GRANTOR GRANTORS
   BENEFICIARY SCHEDULE EXHIBIT TAKERS RESORT PAYMENTS BOND WAIVER ACCOUNTINGS
   SELF-PROVING AFFIDAVIT KNOW ALL BY THESE PRESENTS ACKNOWLEDGMENT STATEMENT
   EXECUTIVE SUMMARY TABLE CONTENTS FAMILY INFORMATION JRT COT NJSA USC IRC IRA
   HIPAA INTERACTIVE LEGAL PAGE FOR AS BE ON AT THAT THIS WITH FROM
   HEREBY CERTIFY WITNESSETH WHEREAS NOW THEREFORE`
    .split(/\s+/)
    .filter(Boolean),
);

// Middle initials are allowed between the first and last token, so a witness
// or fiduciary written "KAREN M. CLAYTON" is visible to the scan.
const CAPS_NAME_RE =
  /\b[A-Z][A-Z'\-]+(?:\s+(?:[A-Z]\.|[A-Z][A-Z'\-]+)){0,2}\s+[A-Z][A-Z'\-]+\b/g;
const ADDRESS_RE =
  /\b\d{1,5}\s+[A-Z][A-Za-z.'\- ]{2,40}?(?:Street|St\.|Avenue|Ave\.|Road|Rd\.|Drive|Dr\.|Court|Ct\.|Lane|Ln\.|Place|Pl\.|Boulevard|Blvd\.|Terrace|Way|Circle|Cir\.)/g;

function isFirmIdentity(candidate) {
  return FIRM_IDENTITY.some(
    (f) => candidate.includes(f) || f.includes(candidate),
  );
}

/**
 * Anything name-like or address-like we did not put there on purpose.
 *
 * Scope, stated plainly so a silent pass is not read as more than it is:
 * this catches ALL-CAPS personal names (how these HotDocs samples render
 * every fiduciary) and numbered street addresses. It does NOT catch a
 * title-case name in running prose, or a bare municipality — legal prose is
 * too full of capitalised defined terms for that heuristic to be anything but
 * noise. A clean run means "no CAPS name and no street address survived",
 * not "no personal data of any kind survived".
 */
function residualCandidates(text) {
  const found = new Map();
  for (const raw of text.match(CAPS_NAME_RE) || []) {
    const tokens = raw.split(/\s+/);
    if (tokens.every((t) => LEGAL_CAPS.has(t))) continue;
    if (tokens.filter((t) => !LEGAL_CAPS.has(t)).length < 2) continue;
    if (isFirmIdentity(raw)) continue;
    found.set(raw, (found.get(raw) || 0) + 1);
  }
  for (const raw of text.match(ADDRESS_RE) || []) {
    const addr = raw.trim();
    if (isFirmIdentity(addr)) continue;
    found.set(addr, (found.get(addr) || 0) + 1);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Templatize
// ---------------------------------------------------------------------------

const CASE_VARIANTS = (literal) => [
  literal,
  literal.toUpperCase(),
  literal.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()),
];

/**
 * Expand each literal into the case variants that occur in the samples, and
 * attach the resolver that decides its placeholder. `spec` maps a literal to
 * either a fixed placeholder string or a `(joined, at, end) => string`.
 */
function buildPairs(spec) {
  const pairs = [];
  const seen = new Set();
  for (const [literal, target] of Object.entries(spec)) {
    const resolve =
      typeof target === 'function' ? target : () => target;
    for (const variant of CASE_VARIANTS(literal)) {
      if (seen.has(variant)) continue;
      seen.add(variant);
      pairs.push({ literal: variant, resolve, source: literal });
    }
  }
  // Longest first so "VITA MARIA RIZZO" claims its span before "VITO RIZZO".
  pairs.sort((a, b) => b.literal.length - a.literal.length);
  return pairs;
}

const results = [];

/**
 * `passes` is one or more literal->target specs, applied in order. People are
 * replaced before addresses so that an address pass can identify an address's
 * owner from the placeholder already standing in front of it.
 */
function templatize(sourceFile, destFileName, passes) {
  const specs = Array.isArray(passes) ? passes : [passes];
  const sourcePath = path.resolve(REPO_ROOT, sourceFile);
  const destPath = path.join(REPO_ROOT, 'functions', 'templates', destFileName);

  if (!fs.existsSync(sourcePath)) {
    console.error(`SKIP  ${destFileName}: source not found — ${sourceFile}`);
    results.push({ destFileName, status: 'source-missing' });
    return;
  }

  const zip = new PizZip(fs.readFileSync(sourcePath, 'binary'));
  let xml = zip.file('word/document.xml').asText();
  const pairs = [];
  const totals = Object.create(null);
  for (const spec of specs) {
    const specPairs = buildPairs(spec);
    const pass = replaceInDocument(xml, specPairs);
    xml = pass.xml;
    pairs.push(...specPairs);
    for (const [literal, n] of Object.entries(pass.totals)) {
      totals[literal] = (totals[literal] || 0) + n;
    }
  }
  const mappings = Object.assign({}, ...specs);

  zip.file('word/document.xml', xml);
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(
    destPath,
    zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }),
  );

  // Roll per-variant counts up to the literal they came from.
  const byLiteral = Object.create(null);
  for (const pair of pairs) {
    byLiteral[pair.source] =
      (byLiteral[pair.source] || 0) + (totals[pair.literal] || 0);
  }
  results.push({
    destFileName,
    destPath,
    sourceFile,
    mappings,
    byLiteral,
    status: 'written',
  });
  console.log(`WROTE ${destFileName}  <- ${path.basename(sourceFile)}`);
}

/**
 * Re-read what we wrote. A mapped literal surviving here is a hard failure:
 * it is a real person's name or home address inside a template that will
 * generate documents for other clients.
 */
function verifyTemplate(result) {
  const text = documentText(readDocumentXml(result.destPath));
  const leaked = [];
  for (const literal of Object.keys(result.mappings)) {
    const variants = new Set([
      literal,
      literal.toUpperCase(),
      literal.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()),
    ]);
    let n = 0;
    for (const v of variants) n += text.split(v).length - 1;
    if (n > 0) leaked.push({ literal, count: n });
  }
  const residual = residualCandidates(text);
  const unbacked = new Set();
  for (const tag of text.match(/\{\{(\w+)\}\}/g) || []) {
    const name = tag.slice(2, -2);
    if (!BACKED_FIELDS.has(name)) unbacked.add(name);
  }
  const singleBrace = (text.match(/(?<!\{)\{\w+\}(?!\})/g) || []).length;
  return { leaked, residual, unbacked, singleBrace, text };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const SAMPLES = 'samples/interactivelegal';

// Two passes for the Byrnes set: names resolved by the role they are being
// appointed to, then addresses attributed to the name standing in front of
// them.
// Longest first, so the alternation matches "SEAN BYRNES" rather than
// stopping at a shorter name that is a prefix of it.
const byrnesNameAlternation = Object.keys(BYRNES_PEOPLE)
  .flatMap(CASE_VARIANTS)
  .sort((a, b) => b.length - a.length)
  .map((n) => n.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
  .join('|');
const byrnesPeopleRes = {
  plain: new RegExp(byrnesNameAlternation),
  global: new RegExp(byrnesNameAlternation, 'g'),
};
const byrnesPeople = Object.fromEntries(
  Object.entries(BYRNES_PEOPLE).map(([name, fallback]) => [
    name,
    (joined, at, end) =>
      resolvePerson(fallback, byrnesPeopleRes, joined, at, end),
  ]),
);
const byrnesAddresses = Object.fromEntries(
  BYRNES_ADDRESSES.map((addr) => [addr, resolveAddressByOwner]),
);
// The witness pass runs last, so name and address resolution still see the
// original text and are unaffected by it.
const BYRNES = [byrnesPeople, byrnesAddresses, WITNESSES];
const RIZZO_PASSES = [RIZZO, WITNESSES];

templatize(`${SAMPLES}/Jessica Byrnes - LW&T 11.3.25.docx`, 'NJ_Will_Married.docx', BYRNES);
templatize(`${SAMPLES}/Jessica Byrnes- POA 11.3.25.docx`, 'NJ_POA_Married.docx', BYRNES);
templatize(`${SAMPLES}/Jessica Byrnes- HC 11.3.25.docx`, 'NJ_HC_Married.docx', BYRNES);
templatize(`${SAMPLES}/Rizzo Living Trust.docx`, 'Married_Trust.docx', RIZZO_PASSES);
templatize(`${SAMPLES}/Vito Rizzo- Pourover Will 11.19.25.docx`, 'NJ_Pourover_Will.docx', RIZZO_PASSES);

// NJ_Will_Single.docx is deliberately not generated. The previous version
// produced it from Jessica's married will by string-swapping "Married" ->
// "Single", which leaves every spouse clause ("I give my Residuary Estate to
// my Husband") intact and merely relabels them. That is a wrong document, not
// a single-person will. It needs a single-person sample to templatize from.
console.log(
  'SKIP  NJ_Will_Single.docx: no single-person sample in ' +
    `${SAMPLES}/. Cannot be derived from the married will by word swap.`,
);

// --- verification -----------------------------------------------------------

console.log('\n--- verification ---');
let failures = 0;
const written = results.filter((r) => r.status === 'written');

if (written.length === 0) {
  console.error('FATAL: no templates were written — nothing was verified.');
  process.exit(2);
}

for (const result of written) {
  const { leaked, residual, unbacked, singleBrace } = verifyTemplate(result);
  console.log(`\n${result.destFileName}`);
  const replaced = Object.entries(result.byLiteral).filter(([, n]) => n > 0);
  console.log(
    `  replaced: ${replaced.reduce((a, [, n]) => a + n, 0)} occurrence(s) ` +
      `across ${replaced.length}/${Object.keys(result.mappings).length} mapped literals`,
  );
  for (const [literal, n] of Object.entries(result.byLiteral)) {
    if (n === 0) console.log(`    note: "${literal}" not present in this document`);
  }
  if (singleBrace > 0) {
    console.error(`  FAIL: ${singleBrace} single-brace {placeholder}(s) — docxtemplater uses {{ }}`);
    failures += 1;
  }
  if (leaked.length > 0) {
    failures += 1;
    console.error('  FAIL: mapped literal survived templatization:');
    for (const l of leaked) console.error(`    ${l.count}x  ${l.literal}`);
  } else {
    console.log('  ok: no mapped literal survived');
  }
  if (residual.size > 0) {
    failures += 1;
    console.error('  FAIL: unmapped name/address candidates remain:');
    for (const [candidate, n] of [...residual].sort((a, b) => b[1] - a[1])) {
      console.error(`    ${n}x  ${candidate}`);
    }
  } else {
    console.log('  ok: residual scan found no name/address candidates');
  }
  if (unbacked.size > 0) {
    console.log(
      `  warn: placeholders with no field in buildDocxTemplateData ` +
        `(render blank): ${[...unbacked].join(', ')}`,
    );
  }
}

console.log('');
if (failures > 0) {
  console.error(`FAILED: ${failures} check(s) across ${written.length} template(s).`);
  process.exit(1);
}
console.log(`PASSED: ${written.length} template(s) carry no client literals.`);
