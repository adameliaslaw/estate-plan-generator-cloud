/**
 * §4.2 enumerated-list sections (the powers-article fix): a section whose
 * body is ≥ 70% list items keeps the SECTION as the clause unit/switch, but
 * identity is computed on the ITEM SET — each item normalized and hashed;
 * families match on Jaccard over item-hash sets ≥ 0.7 (config.itemSet), so
 * two power lists differing by one inserted item (the digital-assets power)
 * still align. Per-item presence is recorded as itemization variants.
 *
 * Pure module.
 */

/** List-item markers: (a), (1), a., 1., i., roman parens, bullets, dashes. */
const ITEM_MARKER_RE =
  /^\s*(?:\(\s*(?:[a-z]|[ivxl]+|\d{1,2})\s*\)|(?:[a-z]|[ivxl]+|\d{1,2})[.)]\s|[-–•▪]\s)/i;

export function isListItem(paragraph: string): boolean {
  return ITEM_MARKER_RE.test(paragraph);
}

/** Strip the marker so item identity is computed on the item TEXT. */
export function stripItemMarker(paragraph: string): string {
  return paragraph.replace(ITEM_MARKER_RE, '').trim();
}

/** §4.2: body ≥ 70% list items ⇒ enumerated-list section. */
export const ENUMERATION_RATIO = 0.7;

export interface EnumerationResult {
  isEnumerated: boolean;
  /** Item texts (marker stripped), in order — empty when not enumerated. */
  items: string[];
}

/**
 * Detect an enumerated-list section from its body paragraphs (the heading
 * paragraph excluded by the caller).
 */
export function detectEnumeration(bodyParagraphs: readonly string[]): EnumerationResult {
  const nonEmpty = bodyParagraphs.map((p) => p.trim()).filter((p) => p.length > 0);
  if (nonEmpty.length < 3) return { isEnumerated: false, items: [] };
  const items = nonEmpty.filter((p) => isListItem(p));
  if (items.length / nonEmpty.length >= ENUMERATION_RATIO) {
    return { isEnumerated: true, items: items.map(stripItemMarker) };
  }
  return { isEnumerated: false, items: [] };
}
