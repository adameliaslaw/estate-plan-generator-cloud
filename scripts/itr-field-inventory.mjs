/**
 * Inventory the AcroForm fields in one of the State's blank forms.
 *
 * The field NAMES in NJ's PDFs are auto-generated and meaningless — "undefined_13",
 * "0_2t4gsdxv0_22aa2aau65t", and at least one with the State's own typo ("Deceaaaas1dent"). The
 * only reliable way to know which box is which line of the return is its POSITION on the page and
 * the printed text beside it. This script produces that mapping so the constants in
 * `functions/src/inheritance-tax/forms/*-pdf.ts` can be generated rather than transcribed.
 *
 *   node scripts/itr-field-inventory.mjs                    # summary per page (IT-R)
 *   node scripts/itr-field-inventory.mjs --page 13          # every widget on one page, by row
 *   node scripts/itr-field-inventory.mjs --json out.json    # full inventory
 *   node scripts/itr-field-inventory.mjs --form itext       # a companion form instead
 *   node scripts/itr-field-inventory.mjs --file path.pdf    # any blank, by path
 *
 * Only the blanks with a filler are committed. To inventory one that is not yet mapped — the
 * L-9(A), or either IT-Estate return — download it from the URL recorded in
 * docs/IT-R-FORMS-BUILD-PLAN.md §3 and pass it with --file.
 *
 * Reads a blank committed under functions/assets/, so it works offline and against the exact form
 * the filler targets. If NJ reissues a form, re-run this before touching any mapping — and expect
 * the corresponding fill test to fail loudly first.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '../functions/assets');

const args = process.argv.slice(2);
const pageArg = args.includes('--page') ? Number(args[args.indexOf('--page') + 1]) : null;
const jsonArg = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const formArg = args.includes('--form') ? args[args.indexOf('--form') + 1] : null;
const fileArg = args.includes('--file') ? args[args.indexOf('--file') + 1] : null;

// Named blanks, so the common cases need no path. Each is the State's own published file,
// downloaded from nj.gov — see docs/IT-R-FORMS-BUILD-PLAN.md §3 for where each one lives.
const BLANKS = {
  'it-r': 'itr-blank.pdf',
  itext: 'itext.pdf',
  l9: 'itl9.pdf',
};

const BLANK = fileArg
  ? resolve(fileArg)
  : resolve(assets, BLANKS[formArg ?? 'it-r'] ?? BLANKS['it-r']);

if (formArg && !BLANKS[formArg]) {
  console.error(`Unknown --form ${JSON.stringify(formArg)}. Known: ${Object.keys(BLANKS).join(', ')}`);
  process.exit(1);
}

const pdf = await getDocument({ data: new Uint8Array(readFileSync(BLANK)) }).promise;

/** Every widget, with the printed text nearest to it. */
const fields = [];
for (let p = 1; p <= pdf.numPages; p++) {
  const page = await pdf.getPage(p);
  const [annotations, text] = await Promise.all([page.getAnnotations(), page.getTextContent()]);

  const items = text.items
    .filter((i) => i.str && i.str.trim())
    .map((i) => ({ str: i.str.trim(), x: i.transform[4], y: i.transform[5] }));

  for (const a of annotations) {
    if (a.subtype !== 'Widget') continue;
    const [x1, y1, x2, y2] = a.rect;
    const midY = (y1 + y2) / 2;

    // Label to the left on the same line; otherwise whatever sits directly above (the schedule
    // pages put column headers there).
    const sameLine = items
      .filter((i) => Math.abs(i.y - midY) < 8 && i.x < x1)
      .sort((l, r) => r.x - l.x);
    const above = items
      .filter((i) => i.y > y2 && i.y - y2 < 26 && i.x < x2 + 12 && i.x > x1 - 90)
      .sort((l, r) => l.y - r.y);

    fields.push({
      page: p,
      name: a.fieldName,
      type: a.fieldType, // Tx text · Btn checkbox/radio · Ch dropdown
      rect: [x1, y1, x2, y2].map(Math.round),
      leftLabel: sameLine.slice(0, 4).map((i) => i.str).reverse().join(' ').slice(0, 90),
      aboveLabel: above.slice(0, 2).map((i) => i.str).join(' ').slice(0, 60),
    });
  }
}

if (jsonArg) {
  writeFileSync(jsonArg, JSON.stringify(fields, null, 1));
  console.log(`${fields.length} widgets → ${jsonArg}`);
} else if (pageArg) {
  const rows = new Map();
  for (const f of fields.filter((f) => f.page === pageArg)) {
    if (!rows.has(f.rect[1])) rows.set(f.rect[1], []);
    rows.get(f.rect[1]).push(f);
  }
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    const row = rows.get(y).sort((l, r) => l.rect[0] - r.rect[0]);
    console.log(`y${y}: ` + row.map((f) => `${f.name}@${f.rect[0]}[${f.type}]`).join(' | '));
    const label = row.map((f) => f.leftLabel).find(Boolean);
    if (label) console.log(`      ${label}`);
  }
} else {
  const byPage = new Map();
  for (const f of fields) byPage.set(f.page, (byPage.get(f.page) ?? 0) + 1);
  console.log(`${fields.length} widgets across ${pdf.numPages} pages`);
  for (const [page, count] of [...byPage].sort((a, b) => a[0] - b[0])) {
    console.log(`  page ${String(page).padStart(2)}: ${String(count).padStart(3)} widgets`);
  }
  const dupes = new Map();
  for (const f of fields) dupes.set(f.name, (dupes.get(f.name) ?? 0) + 1);
  const shared = [...dupes].filter(([, n]) => n > 1);
  console.log(`\n${shared.length} names carry more than one widget (radio pairs, and the`);
  console.log('decedent header repeated across all 12 schedule pages — writing it once fills them all).');
}
