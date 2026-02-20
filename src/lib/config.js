import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { STATE_DIR } from "./constants.js";

export function configPath() {
  return (
    process.env.OPENCLAW_CONFIG_PATH?.trim() ||
    path.join(STATE_DIR, "openclaw.json")
  );
}

export function isConfigured() {
  try {
    const cfgPath = configPath();
    const exists = fs.existsSync(cfgPath);
    if (!exists) {
      console.log(`[isConfigured] Config file NOT found at: ${cfgPath}`);
      if (!fs.existsSync(STATE_DIR)) {
        console.log(`[isConfigured] STATE_DIR does not exist: ${STATE_DIR}`);
      } else {
        console.log(`[isConfigured] STATE_DIR exists, listing contents:`);
        const files = fs.readdirSync(STATE_DIR);
        console.log(`[isConfigured] Files in STATE_DIR: ${files.join(', ') || '(empty)'}`);
      }
    } else {
      console.log(`[isConfigured] Config file found at: ${cfgPath}`);
    }
    return exists;
  } catch (err) {
    console.error(`[isConfigured] Error checking config: ${err.message}`);
    return false;
  }
}

export function getClientDomain() {
  const envDomain = process.env.CLIENT_DOMAIN?.trim();
  if (envDomain) return envDomain;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'illumin8.json'), 'utf8'));
    return cfg.clientDomain || null;
  } catch { return null; }
}

export function resolveGatewayToken() {
  console.log(`[token] ========== SERVER STARTUP TOKEN RESOLUTION ==========`);
  const envTok = process.env.OPENCLAW_GATEWAY_TOKEN?.trim();
  console.log(`[token] ENV OPENCLAW_GATEWAY_TOKEN exists: ${!!process.env.OPENCLAW_GATEWAY_TOKEN}`);
  console.log(`[token] ENV value length: ${process.env.OPENCLAW_GATEWAY_TOKEN?.length || 0}`);
  console.log(`[token] After trim length: ${envTok?.length || 0}`);

  if (envTok) {
    console.log(`[token] ✓ Using token from OPENCLAW_GATEWAY_TOKEN env variable`);
    console.log(`[token]   First 16 chars: ${envTok.slice(0, 16)}...`);
    console.log(`[token]   Full token: ${envTok}`);
    return envTok;
  }

  console.log(`[token] Env variable not available, checking persisted file...`);
  const tokenPath = path.join(STATE_DIR, "gateway.token");
  console.log(`[token] Token file path: ${tokenPath}`);

  try {
    const existing = fs.readFileSync(tokenPath, "utf8").trim();
    if (existing) {
      console.log(`[token] ✓ Using token from persisted file`);
      console.log(`[token]   First 16 chars: ${existing.slice(0, 8)}...`);
      return existing;
    }
  } catch (err) {
    console.log(`[token] Could not read persisted file: ${err.message}`);
  }

  const generated = crypto.randomBytes(32).toString("hex");
  console.log(`[token] ⚠️  Generating new random token (${generated.slice(0, 8)}...)`);
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, generated, { encoding: "utf8", mode: 0o600 });
    console.log(`[token] Persisted new token to ${tokenPath}`);
  } catch (err) {
    console.warn(`[token] Could not persist token: ${err}`);
  }
  return generated;
}

// Resolve and cache the gateway token at module load time
export const OPENCLAW_GATEWAY_TOKEN = resolveGatewayToken();
process.env.OPENCLAW_GATEWAY_TOKEN = OPENCLAW_GATEWAY_TOKEN;
console.log(`[token] Final resolved token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);
console.log(`[token] ========== TOKEN RESOLUTION COMPLETE ==========\n`);

export function getGitHubToken() {
  if (process.env.GITHUB_TOKEN) {
    console.log('[github] Using GITHUB_TOKEN from environment variable');
    return process.env.GITHUB_TOKEN;
  }

  const oauthPath = path.join(STATE_DIR, 'github-oauth.json');
  if (fs.existsSync(oauthPath)) {
    try {
      const oauth = JSON.parse(fs.readFileSync(oauthPath, 'utf8'));
      if (oauth.access_token) return oauth.access_token;
    } catch {}
  }

  const dashboardOAuthPath = path.join(os.homedir(), '.openclaw', 'github-oauth.json');
  if (fs.existsSync(dashboardOAuthPath)) {
    try {
      const oauth = JSON.parse(fs.readFileSync(dashboardOAuthPath, 'utf8'));
      if (oauth.access_token) return oauth.access_token;
    } catch {}
  }

  const ghConfigPath = path.join(STATE_DIR, 'github.json');
  if (fs.existsSync(ghConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(ghConfigPath, 'utf8'));
      if (config.token) return config.token;
    } catch {}
  }

  return process.env.GITHUB_TOKEN?.trim() || '';
}

// ── Config repair helpers ─────────────────────────────────────────────

// Known provider base URLs for auto-repair
const KNOWN_BASE_URLS = {
  'openai': 'https://api.openai.com/v1',
  'anthropic': 'https://api.anthropic.com',
  'google': 'https://generativelanguage.googleapis.com/v1beta',
  'deepseek': 'https://api.deepseek.com/v1',
  'moonshot': 'https://api.moonshot.ai/v1',
  'minimax': 'https://api.minimax.chat/v1',
  'perplexity': 'https://api.perplexity.ai',
  'openrouter': 'https://openrouter.ai/api/v1',
  'elevenlabs': 'https://api.elevenlabs.io/v1',
  'mistral': 'https://api.mistral.ai/v1',
  'groq': 'https://api.groq.com/openai/v1',
  'together': 'https://api.together.xyz/v1',
  'fireworks': 'https://api.fireworks.ai/inference/v1',
  'cohere': 'https://api.cohere.ai/v1',
};

function guessBaseUrl(providerName) {
  const normalized = providerName.toLowerCase().replace(/[-_\s]/g, '');
  for (const [key, url] of Object.entries(KNOWN_BASE_URLS)) {
    if (normalized.includes(key) || key.includes(normalized)) return url;
  }
  return null;
}

/**
 * Repair invalid OpenClaw config. Called before every gateway start.
 * 
 * Strategy: fix what we can, remove only what's truly broken.
 * - Missing 'models' array → add empty array (gateway tolerates this)
 * - Missing 'baseUrl' with API key → auto-fill for known providers
 * - Missing 'baseUrl' for unknown provider → remove (can't guess)
 * - Empty provider (no apiKey, no baseUrl, no models) → remove
 * - Invalid auth profiles (e.g. elevenlabs) → remove
 * 
 * @param {boolean} dryRun - If true, only diagnose without making changes
 * @returns {{ repaired: boolean, issues: string[] }}
 */
export function fixInvalidConfig(dryRun = false) {
  const cfgPath = configPath();
  if (!fs.existsSync(cfgPath)) return { repaired: false, issues: [] };

  let config;
  try {
    config = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (err) {
    console.warn("[config-repair] Could not parse config:", err.message);
    return { repaired: false, issues: [`Parse error: ${err.message}`] };
  }

  const issues = [];
  let changed = false;

  // --- Repair model providers ---
  const providers = config?.models?.providers;
  if (providers && typeof providers === "object") {
    for (const [name, provider] of Object.entries(providers)) {
      if (!provider || typeof provider !== "object") {
        issues.push(`Provider '${name}': not an object — removing`);
        if (!dryRun) delete providers[name];
        changed = true;
        continue;
      }

      const hasApiKey = !!(provider.apiKey && typeof provider.apiKey === 'string' && provider.apiKey.trim());
      const hasValidBaseUrl = !!(provider.baseUrl && typeof provider.baseUrl === 'string' 
        && provider.baseUrl.trim() && provider.baseUrl !== 'undefined');
      const hasValidModels = Array.isArray(provider.models);

      // Empty provider with nothing useful — remove
      if (!hasApiKey && !hasValidBaseUrl && !hasValidModels) {
        issues.push(`Provider '${name}': completely empty — removing`);
        if (!dryRun) delete providers[name];
        changed = true;
        continue;
      }

      // Fix missing models array (gateway schema requires it)
      if (!hasValidModels) {
        issues.push(`Provider '${name}': missing 'models' array — adding empty array`);
        if (!dryRun) provider.models = [];
        changed = true;
      }

      // Fix missing baseUrl
      if (!hasValidBaseUrl) {
        if (hasApiKey) {
          // Try to auto-fill from known providers
          const guessed = guessBaseUrl(name);
          if (guessed) {
            issues.push(`Provider '${name}': missing 'baseUrl' — setting to '${guessed}'`);
            if (!dryRun) provider.baseUrl = guessed;
            changed = true;
          } else {
            // Unknown provider with API key but no baseUrl — remove (can't function)
            issues.push(`Provider '${name}': missing 'baseUrl' (unknown provider) — removing`);
            if (!dryRun) delete providers[name];
            changed = true;
          }
        }
        // Provider with models but no apiKey and no baseUrl is fine if it's a built-in
      }
    }

    // Clean up empty providers object
    if (!dryRun && Object.keys(providers).length === 0) {
      delete config.models.providers;
      changed = true;
    }
  }

  // --- Repair auth profiles ---
  if (config.auth?.profiles) {
    for (const [key, profile] of Object.entries(config.auth.profiles)) {
      if (profile?.provider === "elevenlabs") {
        issues.push(`Auth profile '${key}': invalid provider 'elevenlabs' — removing`);
        if (!dryRun) {
          delete config.auth.profiles[key];
          changed = true;
        }
      }
    }
  }

  // --- Remove unsupported gateway keys ---
  if (config?.gateway && typeof config.gateway === "object") {
    if (Object.hasOwn(config.gateway, "customBindHost")) {
      issues.push(`gateway.customBindHost is unsupported — removing`);
      if (!dryRun) {
        delete config.gateway.customBindHost;
        changed = true;
      }
    }
  }

  // --- Write repaired config ---
  if (changed && !dryRun) {
    // Create backup before writing
    const backupPath = `${cfgPath}.pre-repair`;
    try { fs.copyFileSync(cfgPath, backupPath); } catch {}
    
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2), { mode: 0o600 });
    console.log(`[config-repair] ✓ Repaired ${issues.length} issues (backup: ${backupPath})`);
  } else if (issues.length === 0) {
    console.log("[config-repair] ✓ Config is clean — no repairs needed");
  }

  for (const issue of issues) {
    console.log(`[config-repair]   • ${issue}`);
  }

  return { repaired: changed && !dryRun, issues };
}

export function directConfigSet(keyPath, value) {
  const cfgPath = configPath();
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    // File doesn't exist or is invalid, start fresh
  }

  const parts = keyPath.split('.');
  let current = config;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;

  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
}
