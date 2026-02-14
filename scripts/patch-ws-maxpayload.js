#!/usr/bin/env node
/**
 * patch-ws-maxpayload.js
 * 
 * Patches OpenClaw's hardcoded WebSocket maxPayload from 512KB to 10MB.
 * 
 * WHY: OpenClaw's gateway CLI previously had `MAX_PAYLOAD_BYTES = 512 * 1024` hardcoded.
 *      Base64-encoded images from the webchat easily exceed 512KB, causing
 *      WebSocket Error 1009 (Message Too Big) and killing the connection.
 * 
 * NOTE: As of early 2026, upstream OpenClaw already ships with 10MB maxPayload.
 *       This script is kept as a safety net — it patches if needed, and is a
 *       no-op if the value is already 10MB.
 * 
 * RUN: After any `openclaw update`, or manually:
 *       node ~/clawd/scripts/patch-ws-maxpayload.js
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
    return 'error';
  }

  // Already at 10MB (either we patched it or upstream fixed it)?
  if (content.includes(NEW_PATTERN)) {
    console.log(`✅ ${basename} — already 10MB (no patch needed)`);
    return 'ok';
  }

  // Needs patching?
  if (!content.includes(OLD_PATTERN)) {
    // Neither old nor new pattern — upstream may have changed the code entirely.
    // Check if there's any MAX_PAYLOAD_BYTES at all.
    const match = content.match(/const MAX_PAYLOAD_BYTES\s*=\s*([^;]+);/);
    if (match) {
      console.log(`ℹ️  ${basename} — MAX_PAYLOAD_BYTES = ${match[1].trim()} (unknown value, skipping)`);
    } else {
      console.log(`ℹ️  ${basename} — no MAX_PAYLOAD_BYTES found (skipping)`);
    }
    return 'skip';
  }

  // Apply patch
  const patched = content.replace(OLD_PATTERN, NEW_PATTERN);
  
  try {
    fs.writeFileSync(filePath, patched, 'utf8');
    console.log(`🔧 ${basename} — patched: 512KB → 10MB`);
    return 'patched';
  } catch (err) {
    console.error(`❌ Cannot write ${basename}: ${err.message}`);
    return 'error';
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

let okCount = 0;
let patchedCount = 0;
let skipCount = 0;
let errorCount = 0;

for (const file of files) {
  const result = patchFile(file);
  if (result === 'ok') okCount++;
  else if (result === 'patched') patchedCount++;
  else if (result === 'skip') skipCount++;
  else errorCount++;
}

console.log(`\nResult: ${patchedCount} patched, ${okCount} already OK, ${skipCount} skipped, ${errorCount} errors (${files.length} total)`);

// Only fail on actual errors (can't read/write files), not on skip/already-ok
if (errorCount > 0) {
  process.exit(1);
}
