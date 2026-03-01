/**
 * export-docx.ts
 *
 * Cloud Function: exportDocumentDocx
 *
 * Parses the stored HTML content for a document, converts it to a
 * well-formatted .docx file using the `docx` library, and uploads the
 * result to Cloud Storage.  Returns a signed download URL valid for 1 hour.
 *
 * HTML elements handled:
 *   h1, h2, h3            → Heading1 / Heading2 / Heading3
 *   p                     → Normal paragraph
 *   strong/b              → Bold
 *   em/i                  → Italic
 *   u                     → Underline
 *   ul / li               → Bullet list
 *   ol / li               → Numbered list
 *   table / thead / tbody / tr / th / td → Table
 *   br                    → line break inside paragraph
 *   hr                    → section separator paragraph
 *   blockquote            → indented paragraph
 *   Signature/notary text → preserved with underline tab stops
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import {
  Document as DocxDocument,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Packer,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  LevelFormat,
  convertInchesToTwip,
  TabStopType,
  TabStopPosition,
  UnderlineType,
} from 'docx';
import { sanitizeFileName } from './export-pdf';

// ── Minimal HTML tokeniser / parser ──────────────────────────────────────────
//
// We parse the HTML into a flat list of "nodes" and convert those to docx
// elements.  We do NOT need a full DOM — just enough to handle the subset
// of HTML that the AI document generator produces.

interface HtmlNode {
  type: 'element' | 'text';
  tag?: string;                // lower-cased tag name, e.g. 'p', 'h1'
  attrs?: Record<string, string>;
  children?: HtmlNode[];
  text?: string;
}

/** Tokenise an HTML string into a tree of HtmlNode objects. */
function parseHtml(html: string): HtmlNode[] {
  // Use a simple recursive-descent approach
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')   // strip comments
    .replace(/<\s*(br|hr)\s*\/?>/gi, (m) =>
      m.toLowerCase().startsWith('<br') ? '<br/>' : '<hr/>',
    )
    .trim();

  return parseChildren(cleaned);
}

function parseChildren(html: string): HtmlNode[] {
  const nodes: HtmlNode[] = [];
  let rest = html;

  while (rest.length > 0) {
    // Find the next tag
    const tagStart = rest.indexOf('<');
    if (tagStart === -1) {
      // Pure text node
      const text = decodeHtmlEntities(rest);
      if (text.trim()) nodes.push({ type: 'text', text });
      break;
    }

    if (tagStart > 0) {
      const text = decodeHtmlEntities(rest.substring(0, tagStart));
      if (text.trim()) nodes.push({ type: 'text', text });
      rest = rest.substring(tagStart);
      continue;
    }

    // Self-closing or void tags
    const selfClose = rest.match(/^<(br|hr|img|input|link|meta)(\s[^>]*)?\/?>/i);
    if (selfClose) {
      const tag = selfClose[1].toLowerCase();
      nodes.push({ type: 'element', tag, children: [] });
      rest = rest.substring(selfClose[0].length);
      continue;
    }

    // Closing tag — caller handles
    if (rest.startsWith('</')) {
      break;
    }

    // Opening tag
    const openMatch = rest.match(/^<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^>]*)?)>/);
    if (!openMatch) {
      // Malformed — skip one char
      rest = rest.substring(1);
      continue;
    }

    const tag = openMatch[1].toLowerCase();
    const attrsRaw = openMatch[2] ?? '';
    const attrs = parseAttrs(attrsRaw);
    rest = rest.substring(openMatch[0].length);

    // Find the matching closing tag (handle nesting)
    const { inner, after } = extractInner(rest, tag);
    const children = parseChildren(inner);
    nodes.push({ type: 'element', tag, attrs, children });
    rest = after;
  }

  return nodes;
}

function extractInner(
  html: string,
  tag: string,
): { inner: string; after: string } {
  let depth = 1;
  let i = 0;

  while (i < html.length && depth > 0) {
    const openMatch = html.substring(i).match(new RegExp(`^<${tag}(\\s[^>]*)?>`, 'i'));
    const closeMatch = html.substring(i).match(new RegExp(`^<\\/${tag}>`, 'i'));

    if (closeMatch) {
      depth--;
      if (depth === 0) {
        return { inner: html.substring(0, i), after: html.substring(i + closeMatch[0].length) };
      }
      i += closeMatch[0].length;
    } else if (openMatch) {
      depth++;
      i += openMatch[0].length;
    } else {
      i++;
    }
  }

  // No closing tag found — treat entire remaining string as inner
  return { inner: html, after: '' };
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z\-]+)\s*=\s*["']([^"']*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  return attrs;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
}

// ── Text extraction from an HtmlNode subtree ──────────────────────────────────

function extractText(node: HtmlNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.children ?? []).map(extractText).join('');
}

// ── Inline run builder ────────────────────────────────────────────────────────
//
// Recursively walks an element's children and produces TextRun objects that
// carry the accumulated bold/italic/underline state.

interface InlineStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

function buildTextRuns(nodes: HtmlNode[], style: InlineStyle = {}): TextRun[] {
  const runs: TextRun[] = [];

  for (const node of nodes) {
    if (node.type === 'text') {
      const txt = (node.text ?? '').replace(/\s+/g, ' ');
      if (txt) {
        runs.push(
          new TextRun({
            text: txt,
            bold: style.bold,
            italics: style.italic,
            underline: style.underline ? { type: UnderlineType.SINGLE } : undefined,
            font: 'Times New Roman',
            size: 24, // 12pt (half-points)
          }),
        );
      }
    } else {
      const tag = node.tag ?? '';
      const children = node.children ?? [];

      if (tag === 'br') {
        runs.push(new TextRun({ break: 1 }));
        continue;
      }

      const newStyle: InlineStyle = { ...style };
      if (tag === 'strong' || tag === 'b') newStyle.bold = true;
      if (tag === 'em' || tag === 'i') newStyle.italic = true;
      if (tag === 'u') newStyle.underline = true;

      // Recursively build runs for children
      runs.push(...buildTextRuns(children, newStyle));
    }
  }

  return runs;
}

// ── Block-level element converters ────────────────────────────────────────────

/**
 * Convert a block-level HtmlNode to one or more docx Paragraph / Table objects.
 * Returns an array because some constructs (e.g. list items) expand to multiple
 * paragraphs, and tables return a single Table.
 */
type DocxChild = Paragraph | Table;

function convertNode(
  node: HtmlNode,
  listLevel = 0,
  listType: 'bullet' | 'number' = 'bullet',
): DocxChild[] {
  const tag = node.tag ?? '';
  const children = node.children ?? [];

  // ── Headings ──────────────────────────────────────────────────────────────
  if (tag === 'h1') {
    return [
      new Paragraph({
        text: extractText(node),
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 360, after: 240 },
      }),
    ];
  }

  if (tag === 'h2') {
    return [
      new Paragraph({
        children: buildTextRuns(children, { bold: true }),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 200 },
      }),
    ];
  }

  if (tag === 'h3') {
    return [
      new Paragraph({
        children: buildTextRuns(children, { bold: true }),
        heading: HeadingLevel.HEADING_3,
        spacing: { before: 240, after: 160 },
      }),
    ];
  }

  // ── Paragraph ─────────────────────────────────────────────────────────────
  if (tag === 'p') {
    const runs = buildTextRuns(children);
    return [
      new Paragraph({
        children: runs.length ? runs : [new TextRun({ text: '' })],
        alignment: AlignmentType.JUSTIFIED,
        spacing: { after: 160 },
      }),
    ];
  }

  // ── Blockquote (indented paragraph) ───────────────────────────────────────
  if (tag === 'blockquote') {
    // Build indented paragraphs directly from child nodes rather than
    // constructing Paragraphs and then trying to unwrap their internals
    // (the docx v9 Paragraph class does not expose an .options property).
    const results: DocxChild[] = [];
    for (const child of children) {
      const childTag = child.tag ?? '';
      if (childTag === 'p' || child.type === 'text') {
        // Convert inline content to TextRuns and wrap in an indented paragraph
        const runs =
          child.type === 'text'
            ? buildTextRuns([child])
            : buildTextRuns(child.children ?? []);
        results.push(
          new Paragraph({
            children: runs.length ? runs : [new TextRun({ text: '' })],
            indent: { left: convertInchesToTwip(0.5) },
            spacing: { after: 120 },
          }),
        );
      } else {
        // For non-paragraph elements (e.g. nested lists, tables), convert
        // normally and pass through unchanged.
        results.push(...convertNode(child));
      }
    }
    return results;
  }

  // ── Horizontal rule ───────────────────────────────────────────────────────
  if (tag === 'hr') {
    return [
      new Paragraph({
        children: [],
        border: {
          bottom: {
            color: '999999',
            space: 1,
            style: BorderStyle.SINGLE,
            size: 6,
          },
        },
        spacing: { before: 160, after: 160 },
      }),
    ];
  }

  // ── Unordered list ────────────────────────────────────────────────────────
  if (tag === 'ul') {
    return children
      .filter((c) => c.tag === 'li')
      .flatMap((li) => convertListItem(li, listLevel, 'bullet'));
  }

  // ── Ordered list ──────────────────────────────────────────────────────────
  if (tag === 'ol') {
    return children
      .filter((c) => c.tag === 'li')
      .flatMap((li) => convertListItem(li, listLevel, 'number'));
  }

  // ── Table ─────────────────────────────────────────────────────────────────
  if (tag === 'table') {
    return [convertTable(node)];
  }

  // ── div / section / article / main — treat as transparent containers ──────
  if (['div', 'section', 'article', 'main', 'body'].includes(tag)) {
    return children.flatMap((c) => convertNode(c, listLevel, listType));
  }

  // ── Inline-only element at block level — wrap in paragraph ────────────────
  if (['span', 'strong', 'b', 'em', 'i', 'u', 'a'].includes(tag)) {
    return [
      new Paragraph({
        children: buildTextRuns([node]),
        spacing: { after: 160 },
      }),
    ];
  }

  // ── Text node used as top-level block ─────────────────────────────────────
  if (node.type === 'text') {
    const text = (node.text ?? '').trim();
    if (!text) return [];
    return [
      new Paragraph({
        children: [
          new TextRun({
            text,
            font: 'Times New Roman',
            size: 24,
          }),
        ],
        spacing: { after: 160 },
      }),
    ];
  }

  // ── Fall-through: unknown tags — just render their text content ────────────
  const fallback = extractText(node).trim();
  if (!fallback) return [];
  return [
    new Paragraph({
      children: [new TextRun({ text: fallback, font: 'Times New Roman', size: 24 })],
      spacing: { after: 160 },
    }),
  ];
}

// ── List item converter ───────────────────────────────────────────────────────

function convertListItem(
  li: HtmlNode,
  level: number,
  listType: 'bullet' | 'number',
): DocxChild[] {
  const children = li.children ?? [];
  const result: DocxChild[] = [];

  // Check for nested lists inside the li
  const blockChildren = children.filter(
    (c) => c.tag === 'ul' || c.tag === 'ol',
  );
  const inlineChildren = children.filter(
    (c) => c.tag !== 'ul' && c.tag !== 'ol',
  );

  const runs = buildTextRuns(inlineChildren);

  result.push(
    new Paragraph({
      children: runs.length ? runs : [new TextRun({ text: '', font: 'Times New Roman', size: 24 })],
      numbering:
        listType === 'bullet'
          ? { reference: 'bullet-list', level }
          : { reference: 'number-list', level },
      spacing: { after: 80 },
    }),
  );

  // Recurse into nested lists
  for (const nested of blockChildren) {
    const nestedType: 'bullet' | 'number' =
      nested.tag === 'ol' ? 'number' : 'bullet';
    const nestedItems = (nested.children ?? []).filter((c) => c.tag === 'li');
    for (const nli of nestedItems) {
      result.push(...convertListItem(nli, level + 1, nestedType));
    }
  }

  return result;
}

// ── Table converter ───────────────────────────────────────────────────────────

function convertTable(tableNode: HtmlNode): Table {
  const rows: TableRow[] = [];
  const allChildren = tableNode.children ?? [];

  // Flatten thead/tbody/tfoot into a flat array of tr
  const trNodes: HtmlNode[] = [];
  for (const child of allChildren) {
    if (child.tag === 'tr') {
      trNodes.push(child);
    } else if (['thead', 'tbody', 'tfoot'].includes(child.tag ?? '')) {
      for (const inner of child.children ?? []) {
        if (inner.tag === 'tr') trNodes.push(inner);
      }
    }
  }

  for (const tr of trNodes) {
    const cells: TableCell[] = [];
    for (const cell of tr.children ?? []) {
      if (cell.tag !== 'td' && cell.tag !== 'th') continue;
      const isHeader = cell.tag === 'th';
      const cellContent = extractText(cell).trim();

      cells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: cellContent,
                  bold: isHeader,
                  font: 'Times New Roman',
                  size: 22, // 11pt
                }),
              ],
            }),
          ],
          shading: isHeader
            ? { type: ShadingType.CLEAR, fill: 'E8E8E8', color: 'auto' }
            : undefined,
        }),
      );
    }

    if (cells.length > 0) {
      rows.push(new TableRow({ children: cells }));
    }
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: {
      top: convertInchesToTwip(0.04),
      bottom: convertInchesToTwip(0.04),
      left: convertInchesToTwip(0.08),
      right: convertInchesToTwip(0.08),
    },
  });
}

// ── Draft watermark paragraph ─────────────────────────────────────────────────

function buildDraftWatermarkParagraph(): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text: 'DRAFT — NOT YET EXECUTED — DO NOT RELY ON THIS DOCUMENT',
        bold: true,
        color: 'CC0000',
        font: 'Times New Roman',
        size: 20,
      }),
    ],
    alignment: AlignmentType.CENTER,
    border: {
      top: { color: 'CC0000', style: BorderStyle.SINGLE, size: 6, space: 4 },
      bottom: { color: 'CC0000', style: BorderStyle.SINGLE, size: 6, space: 4 },
    },
    spacing: { before: 0, after: 240 },
  });
}

// ── Main DOCX builder ─────────────────────────────────────────────────────────

export function buildDocxDocument(
  title: string,
  htmlContent: string,
  status: string,
): DocxDocument {
  const isDraft = status === 'draft';
  const nodes = parseHtml(htmlContent);
  const bodyChildren: DocxChild[] = [];

  if (isDraft) {
    bodyChildren.push(buildDraftWatermarkParagraph());
  }

  for (const node of nodes) {
    bodyChildren.push(...convertNode(node));
  }

  // Ensure at least one paragraph
  if (bodyChildren.length === 0 || (isDraft && bodyChildren.length === 1)) {
    bodyChildren.push(
      new Paragraph({
        children: [new TextRun({ text: '', font: 'Times New Roman', size: 24 })],
      }),
    );
  }

  return new DocxDocument({
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: '\u2022',
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: convertInchesToTwip(0.25 + 0.25 * level),
                  hanging: convertInchesToTwip(0.25),
                },
              },
              run: {
                font: 'Symbol',
                size: 24,
              },
            },
          })),
        },
        {
          reference: 'number-list',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: {
                  left: convertInchesToTwip(0.25 + 0.25 * level),
                  hanging: convertInchesToTwip(0.25),
                },
              },
              run: {
                font: 'Times New Roman',
                size: 24,
              },
            },
          })),
        },
      ],
    },

    styles: {
      default: {
        document: {
          run: {
            font: 'Times New Roman',
            size: 24, // 12pt
          },
          paragraph: {
            spacing: { line: 276, lineRule: 'auto' as const },
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          run: {
            bold: true,
            size: 28,
            font: 'Times New Roman',
            allCaps: true,
          },
          paragraph: {
            alignment: AlignmentType.CENTER,
            spacing: { before: 360, after: 240 },
          },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          run: {
            bold: true,
            size: 24,
            font: 'Times New Roman',
            allCaps: true,
          },
          paragraph: {
            spacing: { before: 300, after: 160 },
          },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          run: {
            bold: true,
            size: 24,
            font: 'Times New Roman',
          },
          paragraph: {
            spacing: { before: 240, after: 120 },
          },
        },
      ],
    },

    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(8.5),
              height: convertInchesToTwip(11),
            },
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
            },
          },
        },

        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: title,
                    font: 'Times New Roman',
                    size: 18, // 9pt
                    color: '555555',
                    italics: isDraft,
                  }),
                  ...(isDraft
                    ? [
                        new TextRun({
                          text: ' — DRAFT',
                          bold: true,
                          color: 'CC0000',
                          font: 'Times New Roman',
                          size: 18,
                        }),
                      ]
                    : []),
                ],
                alignment: AlignmentType.CENTER,
                border: {
                  bottom: {
                    color: 'CCCCCC',
                    style: BorderStyle.SINGLE,
                    size: 4,
                    space: 4,
                  },
                },
              }),
            ],
          }),
        },

        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
                    font: 'Times New Roman',
                    size: 18,
                    color: '555555',
                  }),
                ],
                alignment: AlignmentType.CENTER,
                numbering: undefined,
                style: undefined,
                pageBreakBefore: false,
              }),
            ],
          }),
        },

        children: bodyChildren,
      },
    ],
  });
}

// ── Cloud Function ────────────────────────────────────────────────────────────

export const exportDocumentDocx = onCall(
  {
    timeoutSeconds: 60,
    memory: '512MiB',
    region: 'us-east1',
  },
  async (request: any /* CallableRequest */) => {
    // ── 1. Auth check ────────────────────────────────────────────────────────
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required.');
    }

    const { role } = request.auth.token as { role?: string };
    if (!role || !['attorney', 'paralegal', 'admin'].includes(role)) {
      throw new HttpsError(
        'permission-denied',
        'Only attorneys, paralegals, and admins may export documents.',
      );
    }

    // ── 2. Validate input ────────────────────────────────────────────────────
    const { firmId, clientId, documentId } = request.data as {
      firmId?: string;
      clientId?: string;
      documentId?: string;
    };

    if (!firmId || !clientId || !documentId) {
      throw new HttpsError(
        'invalid-argument',
        'firmId, clientId, and documentId are required.',
      );
    }

    // ── 3. Fetch document from Firestore ─────────────────────────────────────
    const db = admin.firestore();
    const docRef = db.doc(
      `firms/${firmId}/clients/${clientId}/documents/${documentId}`,
    );
    const docSnap = await docRef.get();

    if (!docSnap.exists) {
      throw new HttpsError('not-found', 'Document not found.');
    }

    const docData = docSnap.data()!;
    const htmlContent: string =
      docData.htmlContent ?? docData.content ?? '<p>No content available.</p>';
    const displayName: string = docData.displayName ?? 'Document';
    const status: string = docData.status ?? 'draft';

    // ── 4. Build DOCX ────────────────────────────────────────────────────────
    try {
      const docxDoc = buildDocxDocument(displayName, htmlContent, status);
      const buffer = await Packer.toBuffer(docxDoc);

      // ── 5. Upload to Cloud Storage ─────────────────────────────────────────
      const safeName = sanitizeFileName(displayName);
      const timestamp = Date.now();
      const storagePath = `firms/${firmId}/clients/${clientId}/exports/${safeName}_${timestamp}.docx`;

      const bucket = admin.storage().bucket();
      const file = bucket.file(storagePath);

      await file.save(buffer, {
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        metadata: {
          firmId,
          clientId,
          documentId,
          exportedAt: new Date().toISOString(),
          exportFormat: 'docx',
          documentStatus: status,
        },
      });

      // ── 6. Return signed URL (1 hour) ──────────────────────────────────────
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
      });

      return {
        success: true,
        downloadUrl: url,
        fileName: `${safeName}.docx`,
        storagePath,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'DOCX generation failed.';
      console.error('[exportDocumentDocx] Error:', message, err);
      throw new HttpsError('internal', `DOCX export failed: ${message}`);
    }
  },
);
