/**
 * src/lib/sanitize.ts
 *
 * Centralised DOMPurify wrapper for rendering internal HTML content safely.
 *
 * All HTML rendered via dangerouslySetInnerHTML MUST go through sanitizeHtml().
 * Even though our content sources are internal (TipTap editor, mammoth.js
 * DOCX conversion, Cloud Function generators), defence-in-depth means we
 * sanitise every path to prevent stored-XSS if content is ever tampered with
 * at rest in Firestore or Storage.
 *
 * Config notes:
 *   - ALLOWED_TAGS: full set needed for legal docs (tables, headings, lists,
 *     inline formatting, divs/spans for questionnaire layout).
 *   - ALLOWED_ATTR: class + style allowed (no JS event handlers are permitted
 *     by DOMPurify by default; this config keeps that protection).
 *   - FORCE_BODY: wraps output in a <body> fragment so stray top-level text
 *     nodes are handled correctly.
 */

import DOMPurify from 'dompurify';

// DOMPurify.sanitize can return TrustedHTML in Trusted Types environments.
// We always want a plain string for React's __html prop, so we coerce via String().
const PURIFY_CONFIG = {
  // Tags needed for legal document and questionnaire rendering
  ALLOWED_TAGS: [
    // Structure
    'div', 'span', 'section', 'article', 'header', 'footer', 'main', 'nav',
    // Headings
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // Text
    'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
    'sup', 'sub', 'mark', 'small', 'abbr', 'blockquote', 'pre', 'code',
    // Lists
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    // Tables (used heavily in questionnaire summary)
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    // Links & media
    'a', 'img',
    // Misc
    'label', 'time',
  ],
  ALLOWED_ATTR: [
    'class', 'id', 'style',
    // Table attributes
    'colspan', 'rowspan', 'scope', 'align', 'valign', 'width', 'height',
    // Links
    'href', 'target', 'rel',
    // Images
    'src', 'alt', 'title',
    // Accessibility
    'aria-label', 'aria-describedby', 'role',
    // Data attributes (used by TipTap)
    'data-type',
  ],
  FORCE_BODY: true,
  // Prevent DOM clobbering attacks
  SANITIZE_DOM: true,
};

/**
 * Sanitize an HTML string for safe rendering via dangerouslySetInnerHTML.
 * Returns an empty string if input is falsy.
 */
export function sanitizeHtml(html: string | undefined | null): string {
  if (!html) return '';
  return String(DOMPurify.sanitize(html, PURIFY_CONFIG));
}
