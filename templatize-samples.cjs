const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

function templatize(sourceFilePath, destFileName, mappings) {
  const sourcePath = path.resolve(sourceFilePath);
  const destPath = path.join(__dirname, 'functions', 'templates', destFileName);

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

// Will
templatize(
  path.join(samplesDir, 'Jessica Byrnes - LW&T 11.3.25.docx'),
  'NJ_Will_Married.docx',
  {
    'Jessica Byrnes': '{client_name}',
    'SEAN BYRNES': '{executor}',
    'Sean Byrnes': '{executor}',
    'ANTHONY ESERNIO': '{successor_executor}',
    'Anthony Esernio': '{successor_executor}',
    '16 Saddle Court, Monroe Township, New Jersey': '{client_address}',
  }
);

// POA
templatize(
  path.join(samplesDir, 'Jessica Byrnes- POA 11.3.25.docx'),
  'NJ_POA_Married.docx',
  {
    'Jessica Byrnes': '{client_name}',
    'SEAN BYRNES': '{executor}',
    'Sean Byrnes': '{executor}',
    'ANTHONY ESERNIO': '{successor_executor}',
    'Anthony Esernio': '{successor_executor}',
  }
);

// HC
templatize(
  path.join(samplesDir, 'Jessica Byrnes- HC 11.3.25.docx'),
  'NJ_HC_Married.docx',
  {
    'Jessica Byrnes': '{client_name}',
    'SEAN BYRNES': '{executor}',
    'Sean Byrnes': '{executor}',
    'ANTHONY ESERNIO': '{successor_executor}',
    'Anthony Esernio': '{successor_executor}',
  }
);

// Single Will
templatize(
  path.join(samplesDir, 'Jessica Byrnes - LW&T 11.3.25.docx'), // Using as base for now
  'NJ_Will_Single.docx',
  {
    'Jessica Byrnes': '{client_name}',
    'Sean Byrnes': '{executor}',
    'Married': 'Single', // Crude adjustment for single template
  }
);
