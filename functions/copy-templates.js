const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, 'templates');
const dest = path.join(__dirname, 'lib', 'templates');

if (fs.existsSync(src)) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const files = fs.readdirSync(src);
  for (const file of files) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
    console.log(`Copied ${file} to lib/templates`);
  }
} else {
  console.warn('Templates directory not found');
}
