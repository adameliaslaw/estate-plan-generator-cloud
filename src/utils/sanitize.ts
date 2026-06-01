/**
 * sanitize.ts — Input sanitization and validation utilities.
 *
 * sanitizeInput(text)       — strips HTML tags and dangerous characters (XSS)
 * sanitizeForPrompt(text)   — AI prompt-injection protection
 * validateEmail(email)      — RFC-5322-ish validation
 * validatePhone(phone)      — US phone validation
 * formatCurrency(amount)    — "$1,234.56"
 * formatPhone(phone)        — "(201) 555-1234"
 * formatSSNLast4(value)     — "***-**-1234"
 */

import { AI_PROMPT_MAX_FIELD_LENGTH } from '@/config/constants';

// ---------------------------------------------------------------------------
// HTML / XSS sanitization
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags, script blocks, and dangerous characters from user input.
 * Suitable for displaying user-supplied text in the UI or storing in
 * Firestore where it might later be rendered.
 */
export function sanitizeInput(text: string): string {
  if (!text) return '';

  // Remove script/style tags and their content first.
  let result = text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Strip all remaining HTML tags.
  result = result.replace(/<[^>]+>/g, '');

  // Decode common HTML entities so comparisons are clean.
  result = result
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');

  // Re-encode angle brackets so they can't form tags if re-embedded.
  result = result.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Collapse excessive whitespace.
  result = result.replace(/\s{3,}/g, '  ').trim();

  return result;
}

// ---------------------------------------------------------------------------
// AI prompt-injection protection
// ---------------------------------------------------------------------------

/**
 * Patterns that may indicate a prompt-injection attempt.
 * Sorted by severity; each entry is a regex that will be stripped.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // Role override markers
  /\b(system|user|assistant)\s*:\s*/gi,
  // Direct instructions to change behaviour
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|context)/gi,
  /forget\s+(everything|all|prior|previous)/gi,
  /\byou\s+are\s+now\b/gi,
  /\bact\s+as\b/gi,
  /\bpretend\s+(to\s+be|you\s+are)\b/gi,
  /\bnew\s+(instruction|role|persona|context|prompt)\b/gi,
  /\boverride\s+(your|all)?\s*(instructions?|rules?|constraints?)/gi,
  // Jailbreak keywords
  /\bdan\s+mode\b/gi,
  /\bjailbreak\b/gi,
  /\bdo\s+anything\s+now\b/gi,
  // Delimiters commonly used to inject synthetic messages
  /<<<|>>>/g,
  /---\s*(system|user|assistant)\s*---/gi,
  /\[INST\]/gi,
  /\[\/INST\]/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  // Template literal injection
  /\{\{[^}]*\}\}/g,
  // Null byte / control characters
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g,
];

/**
 * Sanitize a user-supplied string before interpolating it into an AI prompt.
 *
 * - Strips potential injection patterns (see INJECTION_PATTERNS)
 * - Removes system/assistant role markers
 * - Escapes backticks so the text can't break out of a markdown code fence
 * - Truncates to AI_PROMPT_MAX_FIELD_LENGTH
 */
export function sanitizeForPrompt(input: string): string {
  if (!input) return '';

  let result = input;

  // Apply all injection-stripping patterns.
  for (const pattern of INJECTION_PATTERNS) {
    result = result.replace(pattern, ' ');
  }

  // Escape backticks so the value can't break a markdown fence.
  result = result.replace(/`/g, "'");

  // Collapse runs of whitespace introduced by the stripping.
  result = result.replace(/\s{3,}/g, '  ').trim();

  // Hard length cap — do NOT silently truncate in the middle of a word;
  // find the last whitespace before the limit.
  if (result.length > AI_PROMPT_MAX_FIELD_LENGTH) {
    const truncated = result.slice(0, AI_PROMPT_MAX_FIELD_LENGTH);
    const lastSpace = truncated.lastIndexOf(' ');
    result = (lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated) + '…';
  }

  return result;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * RFC-5321-ish email validation.
 * Accepts the vast majority of real-world email addresses.
 */
export function validateEmail(email: string): boolean {
  if (!email) return false;
  // Practical regex — not a full RFC 5322 parser, but catches common errors.
  const re =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;
  return re.test(email.trim());
}

/**
 * Validate a US phone number (accepts many common formats).
 * Valid: (201) 555-1234, 201-555-1234, 2015551234, +12015551234
 */
export function validatePhone(phone: string): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  // US numbers: 10 digits, or 11 digits starting with 1.
  return digits.length === 10 || (digits.length === 11 && digits[0] === '1');
}

// ---------------------------------------------------------------------------
// Name-field sanitization
// ---------------------------------------------------------------------------

/**
 * Strip characters that don't belong in a person's name.
 *
 * Allowed: Unicode letters (any script), combining marks (accents), spaces,
 * apostrophes (straight ' and curly ’), and periods (middle initials like
 * "J."). A hyphen is allowed ONLY when `allowHyphen` is true — used for last
 * names ("Palmieri-Sauter"). Everything else (digits, & @ # / etc.) is removed.
 *
 * Intended for input onChange so junk can't enter name fields. Does NOT trim,
 * so a user can still type a space between name parts as they go.
 */
export function sanitizeName(value: string, opts?: { allowHyphen?: boolean }): string {
  if (!value) return '';
  const hyphen = opts?.allowHyphen ? '-' : '';
  // Negated class: remove anything that is NOT an allowed name character.
  const disallowed = new RegExp(`[^\\p{L}\\p{M}\\s'’.${hyphen}]`, 'gu');
  return value.replace(disallowed, '');
}

/**
 * Apply name sanitization to `value` only when `fieldKey` is (or ends with)
 * a first/middle/last name field — e.g. "firstName" or
 * "fiduciaries.executor.primary.lastName". Last names allow a hyphen;
 * first/middle do not. Non-name fields are returned unchanged.
 */
const NAME_FIELD_RE = /(?:^|\.)(firstName|middleName|lastName)$/;
export function sanitizeNameField(fieldKey: string, value: string): string {
  const m = fieldKey.match(NAME_FIELD_RE);
  if (!m) return value;
  return sanitizeName(value, { allowHyphen: m[1] === 'lastName' });
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

/**
 * Format a number as US currency.
 * formatCurrency(1234.5) → "$1,234.50"
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Format a phone number string to "(NXX) NXX-XXXX".
 * Falls back to the original string if it cannot be normalised.
 */
export function formatPhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');

  if (digits.length === 11 && digits[0] === '1') {
    // Strip leading country code
    const local = digits.slice(1);
    return `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone; // can't normalise — return as-is
}

/**
 * Mask a Social Security Number, showing only the last 4 digits.
 * formatSSNLast4("123-45-6789") → "***-**-6789"
 * formatSSNLast4("123456789")   → "***-**-6789"
 * Also accepts a pre-truncated 4-digit value.
 */
export function formatSSNLast4(value: string): string {
  if (!value) return '';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 4) return `***-**-${digits}`;
  if (digits.length === 9) {
    return `***-**-${digits.slice(5)}`;
  }
  // Unknown format — mask everything except trailing 4 chars.
  const last4 = digits.slice(-4).padStart(4, '0');
  return `***-**-${last4}`;
}
