// Quick debug script for structure validator test
const { validateDocumentStructure } = require('./functions/src/document-structure-validator');

const goodWillHtml = [
  '<h2>ARTICLE I - IDENTIFICATION AND REVOCATION</h2>',
  '<p>I, John M Smith, of Mercer County, New Jersey, hereby revoke all prior wills and codicils.</p>',
  '<h2>ARTICLE II - EXECUTOR</h2>',
  '<p>I appoint my spouse, Jane Smith, as Executor of this Will.</p>',
  '<h2>ARTICLE III - RESIDUARY ESTATE</h2>',
  '<p>I give, devise, residue, and remainder of my estate to my spouse.</p>',
  '<h2>SELF-PROVING AFFIDAVIT</h2>',
  '<p>We, the undersigned, declare under penalty of perjury...</p>',
  '<div class="signature-block">',
  '<p>Signature of Testator: ___________________________</p>',
  '<p>Dated this ___ day of __________, 2026</p>',
  '</div>',
  '<div class="witness-attestation">',
  '<p>We, the undersigned, attest and witness that the foregoing instrument was signed...</p>',
  '<p>Witness 1: ___________ Address: ___________</p>',
  '<p>Witness 2: ___________ Address: ___________</p>',
  '</div>',
  '<p>' + 'Extra content padding for validation. '.repeat(200) + '</p>',
].join('\n');

const r = validateDocumentStructure(goodWillHtml, 'will');
console.log(JSON.stringify(r, null, 2));
