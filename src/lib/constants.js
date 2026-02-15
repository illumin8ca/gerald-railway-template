import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);

export const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR?.trim() ||
  path.join(os.homedir(), ".openclaw");

// Support both /data/workspace (Railway volume) and /data/.openclaw/workspace (default)
function resolveWorkspaceDir() {
  // Check env var first
  if (process.env.OPENCLAW_WORKSPACE_DIR?.trim()) {
    return process.env.OPENCLAW_WORKSPACE_DIR.trim();
  }
  // Check if /data/workspace exists (Railway volume mount)
  const railwayWorkspace = "/data/workspace";
  if (fs.existsSync(railwayWorkspace)) {
    return railwayWorkspace;
  }
  // Default to state dir
  return path.join(STATE_DIR, "workspace");
}

export const WORKSPACE_DIR = resolveWorkspaceDir();

// Illumin8 site directories
export const SITE_DIR = path.join(WORKSPACE_DIR, 'site');
export const PRODUCTION_DIR = path.join(SITE_DIR, 'production');
export const DEV_DIR = path.join(SITE_DIR, 'dev');

// Dev server
export const DEV_SERVER_PORT = 4321;
export const DEV_SERVER_TARGET = `http://127.0.0.1:${DEV_SERVER_PORT}`;

// Production SSR server
export const PROD_SERVER_PORT = 34567;
export const PROD_SERVER_TARGET = `http://127.0.0.1:${PROD_SERVER_PORT}`;

// Dashboard
export const DASHBOARD_PORT = 3003;
export const DASHBOARD_TARGET = `http://127.0.0.1:${DASHBOARD_PORT}`;
export const DASHBOARD_DIR = path.join(STATE_DIR || '/data', 'dashboard');
export const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'xQQB2ppPNQ+Ruo1xgr5pIFSix+86prk02IRS1+2208RRuCFM';

// Gateway
export const INTERNAL_GATEWAY_PORT = Number.parseInt(
  process.env.INTERNAL_GATEWAY_PORT ?? "18789",
  10,
);
export const INTERNAL_GATEWAY_HOST = process.env.INTERNAL_GATEWAY_HOST ?? "127.0.0.1";
export const GATEWAY_TARGET = `http://${INTERNAL_GATEWAY_HOST}:${INTERNAL_GATEWAY_PORT}`;

// Openclaw CLI
export const OPENCLAW_ENTRY =
  process.env.OPENCLAW_ENTRY?.trim() || "/openclaw/dist/entry.js";
export const OPENCLAW_NODE = process.env.OPENCLAW_NODE?.trim() || "node";

// Gateway bind override (null = use config, or env/config value)
export const OPENCLAW_GATEWAY_BIND = process.env.OPENCLAW_GATEWAY_BIND?.trim() || null;

// Setup
export const SETUP_PASSWORD = process.env.SETUP_PASSWORD?.trim();

// Debug
export const DEBUG = process.env.OPENCLAW_TEMPLATE_DEBUG?.toLowerCase() === "true";
