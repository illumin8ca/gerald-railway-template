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

export function fixInvalidConfig() {
  const cfgPath = configPath();
  if (!fs.existsSync(cfgPath)) return;
  try {
    const content = fs.readFileSync(cfgPath, "utf8");
    const config = JSON.parse(content);
    let changed = false;

    // Remove invalid model providers that break `openclaw config set`
    const providers = config?.models?.providers;
    if (providers && typeof providers === "object") {
      for (const [name, provider] of Object.entries(providers)) {
        if (!provider || typeof provider !== "object") {
          console.log(`[config-repair] Removing invalid provider '${name}' (not an object)`);
          delete providers[name];
          changed = true;
          continue;
        }
        // Check for missing/invalid baseUrl
        const hasValidBaseUrl =
          provider.baseUrl &&
          typeof provider.baseUrl === "string" &&
          provider.baseUrl.trim() !== "" &&
          provider.baseUrl !== "undefined";
        // Check for valid models array
        const hasValidModels =
          Array.isArray(provider.models) && provider.models.length > 0;

        if (!hasValidBaseUrl || !hasValidModels) {
          console.log(
            `[config-repair] Removing invalid provider '${name}' (baseUrl: ${hasValidBaseUrl}, models: ${hasValidModels})`,
          );
          delete providers[name];
          changed = true;
        }
      }
      // Clean up empty providers object
      if (Object.keys(providers).length === 0) {
        delete config.models.providers;
        changed = true;
      }
    }

    // Remove invalid auth profiles that can also break config writes
    if (config.auth?.profiles) {
      for (const [key, profile] of Object.entries(config.auth.profiles)) {
        if (profile?.provider === "elevenlabs") {
          console.log(
            `[config-repair] Removing invalid profile '${key}' with provider 'elevenlabs'`,
          );
          delete config.auth.profiles[key];
          changed = true;
        }
      }
    }

    if (changed) {
      fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));
      console.log("[config-repair] Fixed invalid config entries");
    }
  } catch (err) {
    console.warn("[config-repair] Could not fix config:", err.message);
  }
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
