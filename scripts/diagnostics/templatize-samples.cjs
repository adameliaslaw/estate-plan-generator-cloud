const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

/**
 * templatize-samples.cjs
 * 
 * Utility to convert literal Word samples (from InteractiveLegal etc)
 * into .docx templates for docxtemplater.
 * 
 * Usage: node scripts/diagnostics/templatize-samples.cjs
 */

function templatize(sourceFilePath, destFileName, mappings) {
  const sourcePath = path.resolve(sourceFilePath);
  // Target: functions/templates/
  const destPath = path.join(process.cwd(), 'functions', 'templates', destFileName);

  if (!fs.existsSync(sourcePath)) {
    console.log(`Source not found: ${sourceFilePath}`);
    return;
  }

  const content = fs.readFileSync(sourcePath, 'binary');
  const zip = new PizZip(content);
  
  // Get document.xml
  let xml = zip.file('word/document.xml').asText();

  // Apply mappings (case-insensitive where appropriate)
  for (const [literal, placeholder] of Object.entries(mappings)) {
    // Escape for regex and handle variations if needed
    const escaped = literal.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escaped, 'g');
    xml = xml.replace(regex, placeholder);
    
    // Also try all caps
    const capsLiteral = literal.toUpperCase();
    if (capsLiteral !== literal) {
      const capsRegex = new RegExp(capsLiteral.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
      xml = xml.replace(capsRegex, placeholder);
    }
  }

  zip.file('word/document.xml', xml);

  const buffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  
  if (!fs.existsSync(path.dirname(destPath))) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
  }
  
  fs.writeFileSync(destPath, buffer);
  console.log(`Successfully templatized ${sourceFilePath} -> ${destFileName}`);
}

// Map the samples to the active templates
const samplesDir = 'samples/interactivelegal';

// Standard Married Set (Jessica Byrnes)
const byrnesMappings = {
  'Jessica Byrnes': '{client_name}',
  'SEAN BYRNES': '{executor}',
  'Sean Byrnes': '{executor}',
  'ANTHONY ESERNIO': '{successor_executor}',
  'Anthony Esernio': '{successor_executor}',
  '16 Saddle Court, Monroe Township, New Jersey': '{client_address}',
};

templatize(path.join(samplesDir, 'Jessica Byrnes - LW&T 11.3.25.docx'), 'NJ_Will_Married.docx', byrnesMappings);
templatize(path.join(samplesDir, 'Jessica Byrnes- POA 11.3.25.docx'), 'NJ_POA_Married.docx', byrnesMappings);
templatize(path.join(samplesDir, 'Jessica Byrnes- HC 11.3.25.docx'), 'NJ_HC_Married.docx', byrnesMappings);

// Trust Sample (Rizzo)
templatize(
  path.join(samplesDir, 'Rizzo Living Trust.docx'),
  'Married_Trust.docx',
  {
    'VITO RIZZO': '{client_name}',
    'Vito Rizzo': '{client_name}',
    'VITA MARIA RIZZO': '{spouse_name}',
    'Vita Maria Rizzo': '{spouse_name}',
    '33 Carriage Drive, Princeton, New Jersey': '{client_address}',
  }
);

// Pourover Will (Rizzo)
templatize(
  path.join(samplesDir, 'Vito Rizzo- Pourover Will 11.19.25.docx'),
  'NJ_Pourover_Will.docx',
  {
    'VITO RIZZO': '{client_name}',
    'Vito Rizzo': '{client_name}',
    'VITA MARIA RIZZO': '{executor}',
    'Vita Maria Rizzo': '{executor}',
  }
);

// Single Will
templatize(
  path.join(samplesDir, 'Jessica Byrnes - LW&T 11.3.25.docx'),
  'NJ_Will_Single.docx',
  {
    ...byrnesMappings,
    'Married': 'Single',
  }
);
