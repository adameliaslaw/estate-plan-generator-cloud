const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');

async function inspect(filePath) {
  try {
    const fullPath = path.resolve(filePath);
    if (!fs.existsSync(fullPath)) {
      console.log(`File not found: ${filePath}`);
      return;
    }
    const result = await mammoth.extractRawText({ path: fullPath });
    console.log(`--- TEXT FROM: ${filePath} ---`);
    console.log(result.value.substring(0, 1000)); // Show first 1000 chars
    console.log('--- END ---');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
  }
}

async function run() {
  console.log('Verifying active templates in functions/templates...');
  await inspect('functions/templates/NJ_Will_Married.docx');
  await inspect('functions/templates/NJ_POA_Married.docx');
  await inspect('functions/templates/NJ_HC_Married.docx');
}

run();
