const fs = require('fs');
const path = require('path');
const PizZip = require('pizzip');

function inspectXML(filePath) {
  const sourcePath = path.resolve(filePath);
  const content = fs.readFileSync(sourcePath, 'binary');
  const zip = new PizZip(content);
  const xml = zip.file('word/document.xml').asText();
  
  // Find "SEAN BYRNES" in the XML and show some context
  const index = xml.indexOf('SEAN BYRNES');
  if (index !== -1) {
    console.log(`Found "SEAN BYRNES" at index ${index}`);
    console.log(xml.substring(index - 50, index + 100));
  } else {
    console.log('"SEAN BYRNES" not found as a literal string in the XML.');
    // Check for split tags
    const indexS = xml.indexOf('SEAN');
    if (indexS !== -1) {
      console.log(`Found "SEAN" at ${indexS}. Context:`);
      console.log(xml.substring(indexS - 50, indexS + 150));
    }
  }
}

inspectXML('samples/interactivelegal/Jessica Byrnes - LW&T 11.3.25.docx');
