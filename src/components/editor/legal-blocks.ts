/**
 * legal-blocks.ts
 *
 * Preset HTML blocks for insertion into legal documents.
 * Used by the EditorToolbar to insert standard legal boilerplate
 * (signature lines, witness blocks, notary acknowledgments, etc.).
 *
 * All blocks use inline styles for maximum portability across
 * rendering contexts (screen, print, PDF export).
 */

// ── Signature block ───────────────────────────────────────────────────────────

export const SIGNATURE_BLOCK = `
<div style="margin-top: 48px; page-break-inside: avoid;">
  <table style="width: 100%; border: none; border-collapse: collapse;">
    <tbody>
      <tr>
        <td style="border: none; padding: 0; width: 45%; vertical-align: bottom;">
          <div style="border-bottom: 1px solid #000; min-width: 200px; margin-bottom: 4px;">&nbsp;</div>
          <p style="margin: 0; font-size: 11pt;">[FULL LEGAL NAME]</p>
          <p style="margin: 0; font-size: 11pt;">Date: ___________________</p>
        </td>
        <td style="border: none; padding: 0; width: 10%;">&nbsp;</td>
        <td style="border: none; padding: 0; width: 45%; vertical-align: bottom;">
          <div style="border-bottom: 1px solid #000; min-width: 200px; margin-bottom: 4px;">&nbsp;</div>
          <p style="margin: 0; font-size: 11pt;">[FULL LEGAL NAME]</p>
          <p style="margin: 0; font-size: 11pt;">Date: ___________________</p>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ── Witness block (NJ requires 2 witnesses for a Will) ────────────────────────

export const WITNESS_BLOCK = `
<div style="margin-top: 48px; page-break-inside: avoid;">
  <p style="margin-bottom: 12px;"><strong>SIGNED, SEALED, PUBLISHED AND DECLARED</strong> by the above-named Testator as and for their Last Will and Testament in the presence of us, who, in their presence and in the presence of each other, have subscribed our names as witnesses thereto, believing said Testator to be of sound mind and memory, and under no constraint or undue influence.</p>
  <table style="width: 100%; border: none; border-collapse: collapse; margin-top: 24px;">
    <tbody>
      <tr>
        <td style="border: none; padding: 0; width: 45%; vertical-align: bottom;">
          <div style="border-bottom: 1px solid #000; margin-bottom: 4px;">&nbsp;</div>
          <p style="margin: 0; font-size: 11pt;">Witness Signature</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">Print Name: ________________________</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">Address: ___________________________</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">____________________________________________</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">Date: _____________________</p>
        </td>
        <td style="border: none; padding: 0; width: 10%;">&nbsp;</td>
        <td style="border: none; padding: 0; width: 45%; vertical-align: bottom;">
          <div style="border-bottom: 1px solid #000; margin-bottom: 4px;">&nbsp;</div>
          <p style="margin: 0; font-size: 11pt;">Witness Signature</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">Print Name: ________________________</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">Address: ___________________________</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">____________________________________________</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">Date: _____________________</p>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ── Notary block (NJ standard acknowledgment) ─────────────────────────────────

export const NOTARY_BLOCK = `
<div style="margin-top: 48px; page-break-inside: avoid; border: 1px solid #000; padding: 16px;">
  <p style="margin: 0 0 8px 0;"><strong>STATE OF NEW JERSEY&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</strong></p>
  <p style="margin: 0 0 8px 0;"><strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;) ss.:</strong></p>
  <p style="margin: 0 0 16px 0;"><strong>COUNTY OF __________________)&nbsp;</strong></p>
  <p style="margin: 0 0 12px 0;">On this __________ day of ____________________, 20____, before me, the subscriber, personally appeared <strong>__________________________________________</strong>, who I am satisfied is the person named in and who executed the foregoing instrument, and thereupon acknowledged that said person signed, sealed, and delivered the same as said person&apos;s voluntary act and deed, for the uses and purposes therein expressed.</p>
  <table style="width: 100%; border: none; border-collapse: collapse; margin-top: 24px;">
    <tbody>
      <tr>
        <td style="border: none; padding: 0; width: 50%; vertical-align: bottom;">
          <div style="border-bottom: 1px solid #000; margin-bottom: 4px;">&nbsp;</div>
          <p style="margin: 0; font-size: 11pt;">Notary Public of New Jersey</p>
          <p style="margin: 4px 0 0 0; font-size: 11pt;">My Commission Expires: ______________</p>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`;

// ── Self-proving affidavit (N.J.S.A. 3B:3-4) ─────────────────────────────────

export const SELF_PROVING_AFFIDAVIT = `
<div style="margin-top: 48px; page-break-inside: avoid;">
  <h2 style="text-align: center; font-size: 14pt; font-weight: bold; margin-bottom: 24px;">SELF-PROVING AFFIDAVIT</h2>
  <p style="margin: 0 0 12px 0;">(Pursuant to N.J.S.A. 3B:3-4)</p>
  <p style="margin: 0 0 16px 0;"><strong>STATE OF NEW JERSEY&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</strong></p>
  <p style="margin: 0 0 16px 0;"><strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;) ss.:</strong></p>
  <p style="margin: 0 0 16px 0;"><strong>COUNTY OF __________________)&nbsp;</strong></p>
  <p style="margin: 0 0 12px 0;">We, <strong>__________________________</strong>, <strong>__________________________</strong>, and <strong>__________________________</strong>, the Testator and the witnesses, respectively, whose names are signed to the attached or foregoing instrument, being first duly sworn, do hereby declare to the undersigned authority that the Testator signed and executed the instrument as their Last Will and Testament and that said Testator had signed willingly, or willingly directed another to sign for them, and that said Testator executed it as the Testator&apos;s free and voluntary act for the purposes therein expressed; and that each of the witnesses, in the presence and hearing of the Testator, signed the Will as witness in the presence of and at the request of the Testator, and in the presence of each other, and that to the best of their knowledge the Testator was at the time eighteen (18) or more years of age, of sound mind, and under no constraint or undue influence.</p>
  <table style="width: 100%; border: none; border-collapse: collapse; margin-top: 24px;">
    <tbody>
      <tr>
        <td style="border: none; padding: 0 16px 0 0; width: 33%; vertical-align: bottom;">
          <div style="border-bottom: 1px solid #000; margin-bottom: 4px;">&nbsp;</div>
          <p style="margin: 0; font-size: 11pt;">Testator</p>
        </td>
        <td style="border: none; padding: 0 16px; width: 33%; vertical-align: bottom;">
          <div style="border-bottom: 1px solid #000; margin-bottom: 4px;">&nbsp;</div>
          <p style="margin: 0; font-size: 11pt;">Witness</p>
        </td>
        <td style="border: none; padding: 0 0 0 16px; width: 33%; vertical-align: bottom;">
          <div style="border-bottom: 1px solid #000; margin-bottom: 4px;">&nbsp;</div>
          <p style="margin: 0; font-size: 11pt;">Witness</p>
        </td>
      </tr>
    </tbody>
  </table>
  <div style="border: 1px solid #000; padding: 16px; margin-top: 32px;">
    <p style="margin: 0 0 8px 0;"><strong>STATE OF NEW JERSEY&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)</strong></p>
    <p style="margin: 0 0 8px 0;"><strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;) ss.:</strong></p>
    <p style="margin: 0 0 16px 0;"><strong>COUNTY OF __________________)&nbsp;</strong></p>
    <p style="margin: 0 0 12px 0;">Subscribed, sworn to, and acknowledged before me by <strong>______________________________</strong>, the Testator, and subscribed and sworn to before me by <strong>______________________________</strong> and <strong>______________________________</strong>, witnesses, this __________ day of ____________________, 20____.</p>
    <table style="width: 100%; border: none; border-collapse: collapse; margin-top: 24px;">
      <tbody>
        <tr>
          <td style="border: none; padding: 0; width: 50%; vertical-align: bottom;">
            <div style="border-bottom: 1px solid #000; margin-bottom: 4px;">&nbsp;</div>
            <p style="margin: 0; font-size: 11pt;">Notary Public of New Jersey</p>
            <p style="margin: 4px 0 0 0; font-size: 11pt;">My Commission Expires: ______________</p>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
`;

// ── Page break marker ─────────────────────────────────────────────────────────

export const PAGE_BREAK = `<hr style="border: none; border-top: 2px dashed #ccc; margin: 48px 0;" />`;

// ── Section divider ───────────────────────────────────────────────────────────

export const SECTION_DIVIDER = `
<div style="margin: 32px 0; text-align: center;">
  <p style="border-bottom: 1px solid #000; display: inline-block; padding-bottom: 4px; min-width: 200px;">&nbsp;</p>
</div>
`;

// ── Exhibit cover page ────────────────────────────────────────────────────────

export const EXHIBIT_COVER = `
<div style="margin-top: 96px; text-align: center; page-break-before: always;">
  <h1 style="font-size: 24pt; font-weight: bold; margin-bottom: 24px;">EXHIBIT ___</h1>
  <p style="font-size: 14pt; text-decoration: underline;">[EXHIBIT TITLE]</p>
</div>
`;

// ── Definitions block ─────────────────────────────────────────────────────────

export const DEFINITIONS_BLOCK = `
<div style="margin-top: 24px;">
  <h2 style="font-size: 14pt; font-weight: bold; margin-bottom: 16px;">ARTICLE I — DEFINITIONS</h2>
  <p style="margin-bottom: 12px;">As used in this instrument, the following terms shall have the meanings set forth below:</p>
  <ol style="margin-left: 24px;">
    <li style="margin-bottom: 8px;"><strong>&ldquo;Trustee&rdquo;</strong> shall mean the person or persons designated herein to administer the Trust Estate, and any successor trustee or co-trustee who may hereafter be appointed pursuant to the terms of this Agreement.</li>
    <li style="margin-bottom: 8px;"><strong>&ldquo;Trust Estate&rdquo;</strong> or <strong>&ldquo;Trust Property&rdquo;</strong> shall mean all property transferred to the Trustee pursuant to this Agreement, together with all accumulations thereto and all investments and reinvestments thereof.</li>
    <li style="margin-bottom: 8px;"><strong>&ldquo;Beneficiary&rdquo;</strong> shall mean any person or entity entitled to receive distributions from the Trust Estate pursuant to the terms hereof.</li>
    <li style="margin-bottom: 8px;"><strong>&ldquo;Issue&rdquo;</strong> shall mean descendants of all generations, including adopted descendants, who are living at the time of any distribution.</li>
    <li style="margin-bottom: 8px;"><strong>&ldquo;Per stirpes&rdquo;</strong> shall mean a method of distribution by which the descendants of a deceased beneficiary take that beneficiary&rsquo;s share by right of representation.</li>
  </ol>
</div>
`;
