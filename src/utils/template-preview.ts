/**
 * template-preview.ts
 *
 * Client-side Handlebars renderer for the template-authoring live preview.
 * Mirrors the helpers registered in functions/src/template-engine.ts so the
 * preview reflects what the server will actually produce.
 *
 * Call `renderTemplatePreview(templateHtml, client)` to get rendered HTML.
 * Throws on parse errors — callers should surface the message to the user.
 */

import Handlebars from 'handlebars';
import type { Client } from '@/types';

// ── Helper registration (one-time) ───────────────────────────────────────────

let helpersRegistered = false;

function registerHelpers(): void {
  if (helpersRegistered) return;

  Handlebars.registerHelper('formatDate', (dateVal: unknown) => {
    if (!dateVal) return '_______________';
    let d: Date;
    if (
      dateVal &&
      typeof dateVal === 'object' &&
      'toDate' in dateVal &&
      typeof (dateVal as { toDate?: unknown }).toDate === 'function'
    ) {
      d = (dateVal as { toDate: () => Date }).toDate();
    } else if (typeof dateVal === 'string') {
      d = new Date(dateVal);
    } else {
      d = new Date(dateVal as string | number);
    }
    if (isNaN(d.getTime())) return String(dateVal);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });

  Handlebars.registerHelper(
    'fullName',
    (person: Record<string, unknown> | string | null | undefined) => {
      if (!person) return '_______________';
      if (typeof person === 'string') return person;
      if (person.firstName) {
        return [person.firstName, person.middleName, person.lastName, person.suffix]
          .filter(Boolean)
          .join(' ');
      }
      if (person.name && typeof person.name === 'string') return person.name;
      return '_______________';
    },
  );

  Handlebars.registerHelper('currency', (amount: unknown) => {
    if (amount == null || isNaN(Number(amount))) return '$0.00';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(Number(amount));
  });

  Handlebars.registerHelper('upper', (str: unknown) =>
    typeof str === 'string' ? str.toUpperCase() : '',
  );

  Handlebars.registerHelper('eq', (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper('gt', (a: unknown, b: unknown) => Number(a) > Number(b));
  Handlebars.registerHelper('inc', (val: unknown) => Number(val) + 1);

  Handlebars.registerHelper('roman', (num: unknown) => {
    const n = Number(num);
    if (isNaN(n) || n <= 0) return String(num);
    const vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1];
    const syms = ['M', 'CM', 'D', 'CD', 'C', 'XC', 'L', 'XL', 'X', 'IX', 'V', 'IV', 'I'];
    let result = '';
    let remaining = n;
    for (let i = 0; i < vals.length; i++) {
      while (remaining >= vals[i]) {
        result += syms[i];
        remaining -= vals[i];
      }
    }
    return result;
  });

  Handlebars.registerHelper('ordinal', (num: unknown) => {
    const n = Number(num);
    if (isNaN(n)) return String(num);
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  });

  Handlebars.registerHelper('fillOrBlank', (val: unknown) => {
    if (!val || (typeof val === 'string' && val.trim() === '')) {
      return new Handlebars.SafeString('_______________');
    }
    if (typeof val === 'object' && val !== null) {
      const obj = val as Record<string, unknown>;
      if (obj.firstName) {
        return [obj.firstName, obj.middleName, obj.lastName, obj.suffix]
          .filter(Boolean)
          .join(' ');
      }
      if (obj.name && typeof obj.name === 'string') return obj.name;
    }
    return val as string;
  });

  Handlebars.registerHelper('hasItems', function (
    this: unknown,
    arr: unknown,
    options: Handlebars.HelperOptions,
  ) {
    if (Array.isArray(arr) && arr.length > 0) return options.fn(this);
    return options.inverse(this);
  });

  Handlebars.registerHelper('join', (arr: unknown[], sep: string) => {
    if (!Array.isArray(arr)) return '';
    return arr.join(typeof sep === 'string' ? sep : ', ');
  });

  helpersRegistered = true;
}

// ── Context builder ──────────────────────────────────────────────────────────

/**
 * Build a template context that mirrors the shape `renderTemplate` receives on
 * the server: the raw client doc plus a handful of computed fields, spread at
 * the top level so templates can reference either `{{personalInfo.x}}` or
 * `{{clientFullName}}` directly.
 */
export function buildPreviewContext(client: Client): Record<string, unknown> {
  const pi = client.personalInfo ?? {};
  const si = client.spouseInfo;
  const hasSpouse = !!si?.firstName;

  const clientFullName =
    [pi.firstName, pi.middleName, pi.lastName, pi.suffix].filter(Boolean).join(' ') ||
    '_______________';
  const spouseFullName = hasSpouse
    ? [si!.firstName, si!.middleName, si!.lastName, si!.suffix].filter(Boolean).join(' ')
    : '';

  const children = client.children ?? [];
  const minorChildren = children.filter((c) => {
    if (!c.dob) return false;
    const age = (Date.now() - new Date(c.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    return age < 18;
  });
  const hasMinorChildren = minorChildren.length > 0;

  return {
    // Spread client doc at the top level so {{personalInfo.x}} works
    ...client,
    // Computed fields
    clientFullName,
    spouseFullName,
    hasSpouse,
    hasMinorChildren,
    childCount: children.length,
    minorChildren,
    todayFormatted: new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    todayISO: new Date().toISOString().slice(0, 10),
    packageType: client.packageDetails?.packageType ?? '',
    primaryTrustName: client.trusts?.[0]?.trustName ?? '',
    // Keep the nested client object available too, matching the server
    // ClientContext shape for templates that use {{client.foo}}
    client,
  };
}

// ── Render ────────────────────────────────────────────────────────────────────

export interface PreviewResult {
  html: string;
  error: string | null;
}

/**
 * Render a Handlebars template against a client. Returns `{ html, error }`.
 * Parse/runtime errors are captured rather than thrown so the caller can
 * show the message inline without try/catch scaffolding.
 */
export function renderTemplatePreview(
  template: string,
  client: Client | null,
): PreviewResult {
  if (!template.trim()) return { html: '', error: null };
  if (!client) return { html: '', error: 'Pick a client to preview against.' };
  registerHelpers();
  try {
    const compiled = Handlebars.compile(template, { noEscape: false });
    const ctx = buildPreviewContext(client);
    const html = compiled(ctx);
    return { html, error: null };
  } catch (err) {
    return {
      html: '',
      error: err instanceof Error ? err.message : 'Template render failed.',
    };
  }
}
