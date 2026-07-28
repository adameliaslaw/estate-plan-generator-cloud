/**
 * Shared machinery for filling the State's blank forms.
 *
 * Extracted from `it-r-pdf.ts` when the companion forms (IT-EXT, L-9 / L-9(A), IT-Estate) each
 * needed the same thing. Every NJ inheritance form splits identity the same way — three SSN
 * boxes, three date boxes, an area code apart from the rest of the phone, an address across
 * five boxes — so the split lives here rather than four times over.
 *
 * The one rule worth preserving above all: **a field name that does not exist in the PDF is a
 * mapping bug, not a runtime condition.** `FieldWriter` collects every failure and throws with
 * the full list, so a form the State has reissued fails loudly in the test suite instead of
 * quietly producing a return with empty boxes.
 */
import { PDFForm, PDFName } from 'pdf-lib';
import type { AddressParts } from '../types';

export class FieldWriter {
  private readonly missing: string[] = [];

  /** `formName` names the form in the failure message — "IT-EXT", "L-9(A)", … */
  constructor(private readonly form: PDFForm, private readonly formName: string) {}

  text(name: string, value: string): void {
    try {
      this.form.getTextField(name).setText(value);
    } catch {
      this.missing.push(`text field ${JSON.stringify(name)}`);
    }
  }

  /** Money boxes are split: dollars in the wide box, cents in the narrow one beside it. */
  money(dollarsField: string, centsField: string, amount: number): void {
    const cents = Math.round(Math.abs(amount) * 100);
    const whole = Math.trunc(cents / 100) * Math.sign(amount || 1);
    this.text(dollarsField, whole.toLocaleString('en-US', { maximumFractionDigits: 0 }));
    this.text(centsField, String(cents % 100).padStart(2, '0'));
  }

  radio(name: string, option: string): void {
    try {
      this.form.getRadioGroup(name).select(option);
    } catch {
      this.missing.push(`radio ${JSON.stringify(name)} option ${JSON.stringify(option)}`);
    }
  }

  /**
   * Select a radio button by WIDGET POSITION rather than by export value.
   *
   * Needed where the State built the group with an `/Opt` array whose entries are not distinct —
   * IT-EXT's Testate/Intestate pair exports `["Yes","Yes"]`, so `select("Yes")` can only ever
   * reach the first widget and there is no value that names the second. Under `/Opt` the
   * appearance state of widget *n* is the string `"n"` (PDF 32000-1 §12.7.4.2.1), and setting the
   * field value to that name turns exactly that widget on and every sibling off — verified by
   * writing each index and reading `/V` and both `/AS` back out of the saved file.
   *
   * Prefer `radio()` wherever the export values ARE distinct; this is the escape hatch, not the
   * default.
   */
  radioByIndex(name: string, index: number): void {
    try {
      const group = this.form.getRadioGroup(name);
      const widgets = group.acroField.getWidgets();
      if (index < 0 || index >= widgets.length) {
        this.missing.push(`radio ${JSON.stringify(name)} widget index ${index} (has ${widgets.length})`);
        return;
      }
      group.acroField.setValue(PDFName.of(String(index)));
    } catch {
      this.missing.push(`radio ${JSON.stringify(name)} widget index ${index}`);
    }
  }

  dropdown(name: string, option: string): void {
    try {
      this.form.getDropdown(name).select(option);
    } catch {
      this.missing.push(`dropdown ${JSON.stringify(name)} option ${JSON.stringify(option)}`);
    }
  }

  check(name: string): void {
    try {
      this.form.getCheckBox(name).check();
    } catch {
      this.missing.push(`checkbox ${JSON.stringify(name)}`);
    }
  }

  /** Throws once, listing everything that failed, so a broken mapping is impossible to miss. */
  assertComplete(): void {
    if (this.missing.length > 0) {
      throw new Error(
        `${this.formName} PDF mapping is out of step with the blank form — ` +
        `${this.missing.length} field(s) not found: ${this.missing.join('; ')}`,
      );
    }
  }
}

/** "2023-09-18" → ["09", "18", "2023"], matching the form's three date boxes. */
export function splitDate(iso: string): [string, string, string] {
  const [year, month, day] = iso.split('-');
  return [month ?? '', day ?? '', year ?? ''];
}

/** "999-00-1234" → ["999", "00", "1234"]. Digits only; the form has three boxes. */
export function splitSSN(ssn: string): [string, string, string] {
  const digits = ssn.replace(/\D/g, '');
  return [digits.slice(0, 3), digits.slice(3, 5), digits.slice(5, 9)];
}

/** "609-555-0000" → ["609", "555-0000"]. The area code has its own box. */
export function splitPhone(phone: string): [string, string] {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return ['', phone];
  return [digits.slice(0, 3), `${digits.slice(3, 6)}-${digits.slice(6, 10)}`];
}

export interface ResolvedAddress {
  street1: string;
  street2: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Resolve an address to the form's separate boxes.
 *
 * Intake captures the parts directly (Google Places returns them pre-split), and when they are
 * present they are used verbatim — no parsing involved. Matters predating that carry only a
 * free-text string; for those, only the unambiguous "street, city, ST 08600" shape is split, and
 * anything else goes into Street 1 whole rather than being guessed at, because a wrong state box
 * on a filed return is worse than an inelegant one.
 */
export function resolveAddress(address: string, parts: AddressParts | undefined): ResolvedAddress {
  if (parts) {
    return {
      street1: parts.street1,
      street2: parts.street2 ?? '',
      city: parts.city,
      state: parts.state,
      zip: parts.zip,
    };
  }
  return splitAddress(address);
}

/** Legacy path: the best that can be made of a single free-text address string. */
function splitAddress(address: string): ResolvedAddress {
  const empty = { street1: address, street2: '', city: '', state: '', zip: '' };
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 3) return empty;

  const tail = parts[parts.length - 1] ?? '';
  const m = /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(tail);
  if (!m) return empty;

  return {
    street1: parts[0] ?? '',
    street2: parts.length > 3 ? parts.slice(1, -2).join(', ') : '',
    city: parts[parts.length - 2] ?? '',
    state: m[1] ?? '',
    zip: m[2] ?? '',
  };
}

/** For single boxes with a printed "$" and ".", where cents go inline rather than in their own box. */
export function formatMoneyInline(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** "City, ST 08600" — the second address line where a form gives the address two lines, not five boxes. */
export function cityStateZip(a: ResolvedAddress): string {
  const tail = [a.state, a.zip].filter(Boolean).join(' ');
  return [a.city, tail].filter(Boolean).join(', ');
}
