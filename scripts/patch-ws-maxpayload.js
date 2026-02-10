#!/usr/bin/env node
/**
 * patch-ws-maxpayload.js
 * 
 * Patches OpenClaw's hardcoded WebSocket maxPayload from 512KB to 10MB.
 * 
 * WHY: OpenClaw's gateway CLI has `MAX_PAYLOAD_BYTES = 512 * 1024` hardcoded.
 *      Base64-encoded images from the webchat easily exceed 512KB, causing
 *      WebSocket Error 1009 (Message Too Big) and killing the connection.
 * 
 * SAFE: Only replaces the exact string `512 * 1024` in the MAX_PAYLOAD_BYTES
 *       constant declaration. If the string isn't found (already patched or
 *       OpenClaw changed the code), it skips the file harmlessly.
 * 
 * RUN: After any `openclaw update`, or manually:
 *       node ~/clawd/scripts/patch-ws-maxpayload.js
 * 
 * UPSTREAM: https://github.com/openclaw/openclaw/issues/XXX
 *           (request to make maxPayload configurable via gateway config)
 */

const fs = require('fs');
const path = require('path');

const OPENCLAW_DIST = process.env.OPENCLAW_DIST || '/openclaw/dist';
const OLD_PATTERN = 'const MAX_PAYLOAD_BYTES = 512 * 1024;';
const NEW_PATTERN = 'const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;';

function findGatewayCliFiles(distDir) {
  try {
    const files = fs.readdirSync(distDir);
    return files
      .filter(f => f.startsWith('gateway-cli-') && f.endsWith('.js'))
      .map(f => path.join(distDir, f));
  } catch (err) {
    console.error(`❌ Cannot read dist directory: ${distDir}`);
    console.error(`   ${err.message}`);
    return [];
  }
}

function patchFile(filePath) {
  const basename = path.basename(filePath);
  
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`❌ Cannot read ${basename}: ${err.message}`);
    return false;
  }

  // Already patched?
  if (content.includes(NEW_PATTERN)) {
    console.log(`✅ ${basename} — already patched (10MB)`);
    return true;
  }

  // Needs patching?
  if (!content.includes(OLD_PATTERN)) {
    console.warn(`⚠️  ${basename} — pattern not found (OpenClaw may have changed the code)`);
    return false;
  }

  // Apply patch
  const patched = content.replace(OLD_PATTERN, NEW_PATTERN);
  
  try {
    fs.writeFileSync(filePath, patched, 'utf8');
    console.log(`🔧 ${basename} — patched: 512KB → 10MB`);
    return true;
  } catch (err) {
    console.error(`❌ Cannot write ${basename}: ${err.message}`);
    return false;
  }
}

// Main
console.log('WebSocket maxPayload patcher for OpenClaw');
console.log(`Target: ${OPENCLAW_DIST}/gateway-cli-*.js\n`);

const files = findGatewayCliFiles(OPENCLAW_DIST);

if (files.length === 0) {
  console.error('No gateway-cli-*.js files found. Is OpenClaw installed?');
  process.exit(1);
}

let patchedCount = 0;
let failCount = 0;

for (const file of files) {
  if (patchFile(file)) {
    patchedCount++;
  } else {
    failCount++;
  }
}

console.log(`\nResult: ${patchedCount} patched, ${failCount} failed, ${files.length} total`);

if (failCount > 0) {
  process.exit(1);
}
