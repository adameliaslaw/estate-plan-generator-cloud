#!/usr/bin/env node
/**
 * scripts/fix-template-syntax.js
 *
 * Fixes broken Handlebars array syntax in existing Firestore documentTemplates.
 * Uses the Google OAuth refresh token from firebase-tools.json to authenticate
 * with the Firestore REST API.
 *
 * Fixes: {{children[0].name}} → {{children.[0].name}}
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const PROJECT_ID = 'estate-plan-generator';

// Read Firebase CLI credentials
const configPath = path.join(process.env.USERPROFILE || process.env.HOME, '.config', 'configstore', 'firebase-tools.json');
let refreshToken;
try {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  refreshToken = config.tokens?.refresh_token;
  if (!refreshToken) {
    console.error('No refresh_token found in firebase-tools.json');
    process.exit(1);
  }
  console.log('✅ Found Firebase CLI refresh token');
} catch (err) {
  console.error('Could not read firebase-tools.json:', err.message);
  process.exit(1);
}

// Get access token — use existing if not expired, otherwise refresh
async function getAccessToken() {
  // Check if the stored access token is still valid (with 60s buffer)
  const configData = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const expiresAt = configData.tokens?.expires_at || 0;
  const accessToken = configData.tokens?.access_token;

  if (accessToken && Date.now() < expiresAt - 60000) {
    console.log('Using existing access token (still valid)');
    return accessToken;
  }

  console.log('Access token expired, refreshing...');
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
    }).toString();

    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error(`Token exchange failed: ${body}`));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Firestore REST API helper
function firestoreRequest(method, path, accessToken, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${PROJECT_ID}/databases/(default)/documents/${path}`,
      method,
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed.error?.message || data).substring(0, 200)}`));
          else resolve(parsed);
        } catch (e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// List all firms
async function listFirms(accessToken) {
  const result = await firestoreRequest('GET', 'firms', accessToken);
  return (result.documents || []).map(doc => ({
    id: doc.name.split('/').pop(),
    data: doc.fields,
  }));
}

// List documentTemplates for a firm
async function listTemplates(firmId, accessToken) {
  const result = await firestoreRequest('GET', `firms/${firmId}/documentTemplates`, accessToken);
  return (result.documents || []).map(doc => ({
    id: doc.name.split('/').pop(),
    fullPath: doc.name,
    fields: doc.fields,
  }));
}

// Update a document's content field
async function updateTemplateContent(firmId, templateId, newContent, accessToken) {
  const body = {
    fields: {
      content: { stringValue: newContent },
    },
  };
  return firestoreRequest(
    'PATCH',
    `firms/${firmId}/documentTemplates/${templateId}?updateMask.fieldPaths=content`,
    accessToken,
    body,
  );
}

// Main
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  console.log(`\n🔧 Fix Template Handlebars Syntax`);
  console.log(`   Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}\n`);

  const accessToken = await getAccessToken();
  console.log('✅ Authenticated with Google OAuth\n');

  const firms = await listFirms(accessToken);
  console.log(`Found ${firms.length} firm(s)\n`);

  let totalFixed = 0;
  let totalOk = 0;

  for (const firm of firms) {
    const firmId = firm.id;
    const firmName = firm.data?.firmName?.stringValue || firm.data?.name?.stringValue || firmId;
    console.log(`── Firm: ${firmName} (${firmId})`);

    const templates = await listTemplates(firmId, accessToken);
    console.log(`   ${templates.length} template(s)\n`);

    for (const tpl of templates) {
      const content = tpl.fields?.content?.stringValue || '';
      const name = tpl.fields?.name?.stringValue || tpl.id;

      if (!content) {
        console.log(`   ⏭️  ${name}: no content, skipping`);
        continue;
      }

      // Check for broken array syntax: {{children[0].name}} (missing dot)
      const brokenPattern = /\{\{(children(?:WithTitles)?|minorChildren|adultChildren|distribution\.residualDistributions|distribution\.specificBequests|assets\.realEstate)\[(\d+)\]/g;
      const matches = content.match(brokenPattern);

      if (matches && matches.length > 0) {
        console.log(`   ⚠️  ${name}: ${matches.length} broken array syntax occurrence(s)`);
        matches.forEach(m => console.log(`       ${m}...`));

        // Fix: add dot before bracket
        const fixed = content.replace(brokenPattern, '{{$1.[$2]');

        if (!dryRun) {
          await updateTemplateContent(firmId, tpl.id, fixed, accessToken);
          console.log(`   ✅ ${name}: FIXED and saved`);
        } else {
          console.log(`   🔍 ${name}: would fix (dry run)`);
        }
        totalFixed++;
      } else {
        totalOk++;
      }
    }
    console.log('');
  }

  console.log(`📊 Done. Fixed: ${totalFixed}, Already OK: ${totalOk}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
