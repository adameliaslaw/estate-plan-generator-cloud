/**
 * Required disclaimer on every output.
 * Must appear verbatim on all generated forms and reports.
 */
export const DISCLAIMER =
  'THIS DOCUMENT WAS PREPARED BY COUNSEL AS A COMPUTATIONAL AID ONLY. ' +
  'IT DOES NOT CONSTITUTE LEGAL ADVICE AND HAS NOT BEEN FILED WITH ANY GOVERNMENTAL AUTHORITY. ' +
  'ALL COMPUTATIONS MUST BE REVIEWED AND APPROVED BY A LICENSED NEW JERSEY ATTORNEY ' +
  'BEFORE ANY RELIANCE IS PLACED UPON THEM. ' +
  'THIS TOOL DOES NOT CREATE AN ATTORNEY-CLIENT RELATIONSHIP.';

/**
 * Phase 0 guardrail (see docs/CONSOLIDATION_PLAN.md). The rendered forms mirror the
 * layout of official NJ forms, so every output must carry an unmistakable notice that
 * it is an attorney workpaper — NOT the official form and NOT to be filed. This text
 * appears verbatim; the HTML banner below wraps it for the rendered documents.
 */
export const WORKPAPER_NOTICE =
  'WORKPAPER — NOT FOR FILING. This is an attorney work product and computational aid, ' +
  'not an official New Jersey tax form. It must not be submitted to the NJ Division of ' +
  'Taxation. File only on the official form after independent attorney verification.';

/**
 * Prominent "not for filing" banner (plus a faint print watermark) injected at the top
 * of every rendered form. Static markup with no interpolated data — safe to embed verbatim.
 */
export const WORKPAPER_BANNER_HTML =
  '<div aria-hidden="true" style="position:fixed;top:42%;left:0;width:100%;text-align:center;' +
  "transform:rotate(-28deg);font-family:Arial,Helvetica,sans-serif;font-size:64pt;font-weight:bold;" +
  'letter-spacing:6pt;color:rgba(176,0,32,0.08);pointer-events:none;z-index:0;">NOT FOR FILING</div>\n' +
  '<div class="workpaper-banner" role="alert" style="position:relative;z-index:1;border:4px solid #b00020;' +
  'background:#fff0f0;color:#b00020;padding:10pt 12pt;margin-bottom:16pt;text-align:center;' +
  'font-weight:bold;font-size:12pt;line-height:1.4;">&#9888; WORKPAPER — NOT FOR FILING<br>' +
  '<span style="font-weight:normal;font-size:9.5pt;color:#000;">This is an attorney work product and ' +
  'computational aid — <strong>not</strong> an official New Jersey tax form. Do <strong>not</strong> submit ' +
  'it to the NJ Division of Taxation. File only on the official form after independent attorney ' +
  'verification.</span></div>';
