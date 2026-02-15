import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import cookieParser from "cookie-parser";
import express from "express";
import httpProxy from "http-proxy";
import sendgrid from "@sendgrid/mail";
import * as tar from "tar";

// ── Module imports ────────────────────────────────────────────────────────
import {
  PORT,
  STATE_DIR,
  WORKSPACE_DIR,
  INTERNAL_GATEWAY_PORT,
  GATEWAY_TARGET,
  OPENCLAW_ENTRY,
  OPENCLAW_NODE,
  OPENCLAW_GATEWAY_BIND,
  SITE_DIR,
  PRODUCTION_DIR,
  DEV_DIR,
  DEV_SERVER_PORT,
  DEV_SERVER_TARGET,
  PROD_SERVER_PORT,
  PROD_SERVER_TARGET,
  DASHBOARD_PORT,
  DASHBOARD_TARGET,
  DASHBOARD_DIR,
  INTERNAL_API_KEY,
} from "./lib/constants.js";
import { runCmd, sleep, safeRemoveDir, debug, clawArgs } from "./lib/helpers.js";
import {
  configPath,
  isConfigured,
  fixInvalidConfig,
  directConfigSet,
  OPENCLAW_GATEWAY_TOKEN,
  getClientDomain,
} from "./lib/config.js";
import { restorePersistedTools, startTailscale } from "./lib/startup.js";
import { requireSetupAuth } from "./lib/auth.js";
import { getGitHubToken, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET } from "./lib/github.js";
import { setupCloudflareDNS, createTurnstileWidget } from "./lib/cloudflare.js";
import { setupSendGridDomainAuth } from "./lib/sendgrid.js";
import { cloneAndBuild, autoSaveDevChanges, pullDevBranch, serveStaticSite } from "./lib/site-builder.js";
import { startDevServer, stopDevServer, restartDevServer, getDevServerProcess } from "./lib/dev-server.js";
import { isProdSSR, startProdServer, stopProdServer, restartProdServer, getProdServerProcess } from "./lib/prod-server.js";
import { setupDashboard, setupWorkspace, startDashboard, stopDashboard, getDashboardProcess } from "./lib/dashboard.js";
import {
  startGateway,
  waitForGatewayReady,
  ensureGatewayRunning,
  restartGateway,
  buildOnboardArgs,
  getGatewayProc,
  isGatewayStarting,
} from "./lib/gateway.js";

// ── Startup: restore persistent tools ─────────────────────────────────
restorePersistedTools();

// ── Token already resolved in config.js ──────────────────────────────
// OPENCLAW_GATEWAY_TOKEN is imported from config.js (single source of truth)

const app = express();
app.set('trust proxy', 1);
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ── Auto-recovery: Detect and fix corrupted dev workspaces ────────────
// This runs before Dashboard routes to ensure dev workspace is valid
app.use(async (req, res, next) => {
  // Only check on Dashboard API calls that might use the dev workspace
  if (!req.path.startsWith('/api/site') && !req.path.startsWith('/api/rebuild')) {
    return next();
  }

  const devGitDir = path.join(DEV_DIR, '.git');
  const devPackageJson = path.join(DEV_DIR, 'package.json');

  // Check if dev dir exists but is corrupted (no .git, or no package.json)
  if (fs.existsSync(DEV_DIR) && (!fs.existsSync(devGitDir) || !fs.existsSync(devPackageJson))) {
    console.log('[auto-recovery] Corrupted dev workspace detected:', {
      devDir: DEV_DIR,
      hasGit: fs.existsSync(devGitDir),
      hasPackageJson: fs.existsSync(devPackageJson)
    });

    // Try to recover by re-cloning
    const githubConfigPath = path.join(STATE_DIR, 'github.json');
    if (fs.existsSync(githubConfigPath)) {
      try {
        const githubConfig = JSON.parse(fs.readFileSync(githubConfigPath, 'utf8'));
        const token = getGitHubToken();
        const repoUrl = `https://github.com/${githubConfig.repo}`;
        const authUrl = token ? repoUrl.replace('https://', `https://x-access-token:${token}@`) : repoUrl;

        console.log('[auto-recovery] Wiping corrupted dev workspace and re-cloning...');
        await safeRemoveDir(DEV_DIR);
        fs.mkdirSync(DEV_DIR, { recursive: true });

        const clone = await runCmd('git', ['clone', '--branch', githubConfig.devBranch, authUrl, DEV_DIR]);
        if (clone.code === 0) {
          console.log('[auto-recovery] Dev workspace re-cloned successfully');
          await runCmd('npm', ['install'], { cwd: DEV_DIR });
          console.log('[auto-recovery] Dependencies installed');
        } else {
          console.error('[auto-recovery] Failed to re-clone:', clone.output);
        }
      } catch (err) {
        console.error('[auto-recovery] Error during recovery:', err.message);
      }
    }
  }

  next();
});

// Minimal health endpoint for Railway.
app.get("/setup/healthz", (_req, res) => {
  // Railway health check endpoint - MUST respond quickly
  const health = {
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    configured: isConfigured(),
    processes: {
      gateway: !!getGatewayProc(),
      dashboard: !!getDashboardProcess(),
    }
  };
  res.json(health);
});

// Diagnostic endpoint - no auth required
app.get("/setup/diagnostic", (_req, res) => {
  const stateFiles = fs.existsSync(STATE_DIR) ? fs.readdirSync(STATE_DIR) : [];
  const workspaceFiles = fs.existsSync(WORKSPACE_DIR) ? fs.readdirSync(WORKSPACE_DIR).slice(0, 20) : [];
  
  // Check if openclaw executable exists and is accessible
  let openclawVersion = 'not found';
  let openclawError = null;
  try {
    const result = childProcess.spawnSync(OPENCLAW_NODE, clawArgs(['--version']), { 
      encoding: 'utf8',
      timeout: 5000 
    });
    openclawVersion = result.stdout?.trim() || result.stderr?.trim() || 'no output';
    if (result.error) openclawError = result.error.message;
  } catch (err) {
    openclawError = err.message;
  }
  
  // Check if /data is likely a persistent volume
  // If it's ephemeral container storage, files will be lost on redeploy
  const dataPath = '/data';
  let volumeWarning = null;
  try {
    // Create a test file to check persistence characteristics
    const testFile = path.join(dataPath, '.volume-test');
    const testContent = Date.now().toString();
    if (!fs.existsSync(testFile)) {
      fs.writeFileSync(testFile, testContent);
      volumeWarning = 'First run detected. If this warning appears after every deploy, you DO NOT have a persistent volume!';
    } else {
      const lastRun = fs.readFileSync(testFile, 'utf8');
      const ageMs = Date.now() - parseInt(lastRun);
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      if (ageHours > 24) {
        volumeWarning = `Volume appears persistent (last run: ${ageHours}h ago)`;
      }
    }
  } catch (err) {
    volumeWarning = `Cannot test volume persistence: ${err.message}`;
  }
  
  res.json({
    configured: isConfigured(),
    configPath: configPath(),
    configExists: fs.existsSync(configPath()),
    stateDir: STATE_DIR,
    stateDirExists: fs.existsSync(STATE_DIR),
    stateFiles: stateFiles,
    workspaceDir: WORKSPACE_DIR,
    workspaceDirExists: fs.existsSync(WORKSPACE_DIR),
    workspaceFiles: workspaceFiles,
    volume: {
      path: dataPath,
      warning: volumeWarning,
      recommendation: stateFiles.length === 0 && !isConfigured() 
        ? 'Add a persistent volume in Railway: Settings → Volumes → Mount /data'
        : null,
    },
    processes: {
      gateway: !!getGatewayProc(),
      gatewayStarting: isGatewayStarting(),
      dashboard: !!getDashboardProcess(),
      devServer: !!getDevServerProcess(),
    },
    openclaw: {
      executable: OPENCLAW_NODE,
      version: openclawVersion,
      error: openclawError,
    },
    env: {
      hasSetupPassword: !!process.env.SETUP_PASSWORD,
      hasDefaultModel: !!process.env.DEFAULT_MODEL,
      defaultModel: process.env.DEFAULT_MODEL || null,
      hasMoonshotKey: !!process.env.MOONSHOT_API_KEY,
      hasClientDomain: !!process.env.CLIENT_DOMAIN,
      clientDomain: process.env.CLIENT_DOMAIN || null,
      hasCloudflareKey: !!process.env.CLOUDFLARE_API_KEY,
      hasCloudflareEmail: !!process.env.CLOUDFLARE_EMAIL,
    },
    timestamp: new Date().toISOString(),
  });
});

// Public status endpoint - shows what's happening without auth
app.get("/status", (_req, res) => {
  const stateFiles = fs.existsSync(STATE_DIR) ? fs.readdirSync(STATE_DIR) : [];
  res.json({
    configured: isConfigured(),
    configPath: configPath(),
    stateDir: STATE_DIR,
    stateDirExists: fs.existsSync(STATE_DIR),
    stateFiles: stateFiles,
    dashboard: {
      running: !!getDashboardProcess(),
      installed: fs.existsSync(path.join(DASHBOARD_DIR, 'package.json')),
    },
    gateway: {
      running: !!getGatewayProc(),
    },
    devServer: {
      running: !!getDevServerProcess(),
      installed: fs.existsSync(path.join(DEV_DIR, 'package.json')),
    },
    site: {
      production: fs.existsSync(path.join(PRODUCTION_DIR, 'index.html')),
      dev: fs.existsSync(path.join(DEV_DIR, 'dist', 'index.html')) || fs.existsSync(path.join(DEV_DIR, 'index.html')),
    },
    timestamp: new Date().toISOString(),
  });
});

// Serve static files for setup wizard (no-cache to avoid stale JS/CSS)
app.get("/setup/app.js", requireSetupAuth, (_req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.type("application/javascript");
  res.sendFile(path.join(process.cwd(), "src", "public", "setup-app.js"));
});

app.get("/setup/styles.css", requireSetupAuth, (_req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.type("text/css");
  res.sendFile(path.join(process.cwd(), "src", "public", "styles.css"));
});

app.get("/setup", requireSetupAuth, (_req, res) => {
  res.set("Cache-Control", "no-cache, no-store, must-revalidate");
  res.sendFile(path.join(process.cwd(), "src", "public", "setup.html"));
});

// ── Auth Endpoints ─────────────────────────────────────────────────────────
// Wrapper auth removed - Dashboard handles its own authentication

// Cache openclaw version to avoid repeated subprocess spawns on every page load
let cachedOpenClawVersion = null;
async function getOpenClawVersion() {
  if (!cachedOpenClawVersion) {
    try {
      const result = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
      cachedOpenClawVersion = result.output.trim();
    } catch (err) {
      cachedOpenClawVersion = 'unknown';
    }
  }
  return cachedOpenClawVersion;
}

// Performance tracking
function perfLog(label) {
  const now = Date.now();
  if (!perfLog.start) perfLog.start = now;
  const elapsed = now - perfLog.start;
  console.log(`[perf] ${label}: ${elapsed}ms`);
}
perfLog.start = null;

app.get("/setup/api/status", requireSetupAuth, async (_req, res) => {
  const version = await getOpenClawVersion();

  // We reuse Openclaw's own auth-choice grouping logic indirectly by hardcoding the same group defs.
  // This is intentionally minimal; later we can parse the CLI help output to stay perfectly in sync.
  const authGroups = [
    {
      value: "openai",
      label: "OpenAI",
      hint: "Codex OAuth + API key",
      options: [
        { value: "codex-cli", label: "OpenAI Codex OAuth (Codex CLI)" },
        { value: "openai-codex", label: "OpenAI Codex (ChatGPT OAuth)" },
        { value: "openai-api-key", label: "OpenAI API key" },
      ],
    },
    {
      value: "anthropic",
      label: "Anthropic",
      hint: "Claude Code CLI + API key",
      options: [
        { value: "claude-cli", label: "Anthropic token (Claude Code CLI)" },
        { value: "token", label: "Anthropic token (paste setup-token)" },
        { value: "apiKey", label: "Anthropic API key" },
      ],
    },
    {
      value: "google",
      label: "Google",
      hint: "Gemini API key + OAuth",
      options: [
        { value: "gemini-api-key", label: "Google Gemini API key" },
        { value: "google-antigravity", label: "Google Antigravity OAuth" },
        { value: "google-gemini-cli", label: "Google Gemini CLI OAuth" },
      ],
    },
    {
      value: "openrouter",
      label: "OpenRouter",
      hint: "API key",
      options: [{ value: "openrouter-api-key", label: "OpenRouter API key" }],
    },
    {
      value: "ai-gateway",
      label: "Vercel AI Gateway",
      hint: "API key",
      options: [
        { value: "ai-gateway-api-key", label: "Vercel AI Gateway API key" },
      ],
    },
    {
      value: "moonshot",
      label: "Moonshot AI",
      hint: "Kimi K2 + Kimi Code",
      options: [
        { value: "moonshot-api-key", label: "Moonshot AI API key" },
        { value: "kimi-code-api-key", label: "Kimi Code API key" },
      ],
    },
    {
      value: "zai",
      label: "Z.AI (GLM 4.7)",
      hint: "API key",
      options: [{ value: "zai-api-key", label: "Z.AI (GLM 4.7) API key" }],
    },
    {
      value: "minimax",
      label: "MiniMax",
      hint: "M2.1 (recommended)",
      options: [
        { value: "minimax-api", label: "MiniMax M2.1" },
        { value: "minimax-api-lightning", label: "MiniMax M2.1 Lightning" },
      ],
    },
    {
      value: "qwen",
      label: "Qwen",
      hint: "OAuth",
      options: [{ value: "qwen-portal", label: "Qwen OAuth" }],
    },
    {
      value: "copilot",
      label: "Copilot",
      hint: "GitHub + local proxy",
      options: [
        {
          value: "github-copilot",
          label: "GitHub Copilot (GitHub device login)",
        },
        { value: "copilot-proxy", label: "Copilot Proxy (local)" },
      ],
    },
    {
      value: "synthetic",
      label: "Synthetic",
      hint: "Anthropic-compatible (multi-model)",
      options: [{ value: "synthetic-api-key", label: "Synthetic API key" }],
    },
    {
      value: "opencode-zen",
      label: "OpenCode Zen",
      hint: "API key",
      options: [
        { value: "opencode-zen", label: "OpenCode Zen (multi-model proxy)" },
      ],
    },
  ];

  // Check SendGrid configuration
  let sendgridConfig = null;
  try {
    const sgPath = path.join(STATE_DIR, "sendgrid.json");
    if (fs.existsSync(sgPath)) {
      sendgridConfig = JSON.parse(fs.readFileSync(sgPath, "utf8"));
    }
  } catch (err) {
    console.error("[setup/status] Failed to read sendgrid.json:", err);
  }

  res.json({
    configured: isConfigured(),
    gatewayTarget: GATEWAY_TARGET,
    openclawVersion: version,
    authGroups,
    defaultAuthGroup: process.env.DEFAULT_MODEL?.includes('moonshot') ? 'moonshot' : null,
    defaultAuthChoice: process.env.DEFAULT_MODEL?.includes('moonshot') ? 'moonshot-api-key' : null,
    defaultAuthSecret: process.env.MOONSHOT_API_KEY?.trim() ? '••••••••' : null,
    hasDefaultApiKey: !!process.env.MOONSHOT_API_KEY?.trim(),
    defaultModel: process.env.DEFAULT_MODEL || null,
    defaultClientDomain: process.env.CLIENT_DOMAIN?.trim() || null,
    cloudflareConfigured: !!(process.env.CLOUDFLARE_API_KEY?.trim() && process.env.CLOUDFLARE_EMAIL?.trim()),
    sendgridConfigured: !!(sendgridConfig?.apiKey && sendgridConfig?.senderEmail),
    hasSendgridEnv: !!process.env.SENDGRID_API_KEY?.trim(),
    defaultAllowedEmails: process.env.DEFAULT_ALLOWED_EMAILS?.trim() || null,
  });
});

app.post('/setup/api/github/start-auth', requireSetupAuth, async (req, res) => {
  try {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: 'repo read:user'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        ok: false,
        error: `GitHub API error: ${errorText}`
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[github-auth] start-auth error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post('/setup/api/github/poll-auth', requireSetupAuth, async (req, res) => {
  try {
    const { device_code } = req.body || {};
    if (!device_code) {
      return res.status(400).json({ ok: false, error: 'Missing device_code' });
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        ok: false,
        error: `GitHub API error: ${errorText}`
      });
    }

    const data = await response.json();

    // Check for errors
    if (data.error) {
      if (data.error === 'authorization_pending') {
        return res.json({ status: 'pending' });
      }
      if (data.error === 'slow_down') {
        return res.json({ status: 'slow_down', error: 'slow_down' });
      }
      return res.json({ status: 'error', error: data.error });
    }

    // Success - fetch username
    const access_token = data.access_token;
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    if (!userRes.ok) {
      return res.json({
        status: 'error',
        error: 'Failed to fetch user info'
      });
    }

    const userData = await userRes.json();
    const username = userData.login;

    // Store token in github-oauth.json
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const oauthData = {
      access_token: access_token,
      token_type: data.token_type || 'bearer',
      scope: data.scope || 'repo,read:user',
      username: username,
      connected_at: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(STATE_DIR, 'github-oauth.json'),
      JSON.stringify(oauthData, null, 2),
      { mode: 0o600 }
    );

    res.json({
      status: 'success',
      access_token: access_token,
      username: username
    });
  } catch (err) {
    console.error('[github-auth] poll-auth error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/setup/api/github/repos', requireSetupAuth, async (req, res) => {
  try {
    const token = getGitHubToken();
    if (!token) {
      return res.status(400).json({
        ok: false,
        error: 'No GitHub token available. Connect GitHub first.'
      });
    }

    // Try installation repos first (fine-grained PATs), fall back to user repos
    let repos = [];

    try {
      const installRes = await fetch('https://api.github.com/installation/repositories?per_page=100', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (installRes.ok) {
        const installData = await installRes.json();
        if (installData.repositories && installData.repositories.length > 0) {
          repos = installData.repositories;
        }
      }
    } catch {}

    // Fallback to user repos
    if (repos.length === 0) {
      const userRes = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!userRes.ok) {
        return res.status(userRes.status).json({
          ok: false,
          error: `GitHub API error: ${userRes.statusText}`
        });
      }

      repos = await userRes.json();
    }

    // Format repos for the frontend
    const formattedRepos = repos.map(repo => {
      // Ensure full_name is properly formatted
      const fullName = repo.full_name || `${repo.owner?.login}/${repo.name}`;
      return {
        id: repo.id,
        name: repo.name,
        full_name: fullName,
        owner: repo.owner?.login || '',
        private: repo.private,
        default_branch: repo.default_branch,
        html_url: repo.html_url,
        description: repo.description || '',
        language: repo.language || ''
      };
    });

    console.log(`[github-repos] Returning ${formattedRepos.length} repos`);
    res.json({ repos: formattedRepos });
  } catch (err) {
    console.error('[github-auth] repos error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/setup/api/github/status', requireSetupAuth, async (req, res) => {
  try {
    const oauthPath = path.join(STATE_DIR, 'github-oauth.json');
    if (fs.existsSync(oauthPath)) {
      const oauth = JSON.parse(fs.readFileSync(oauthPath, 'utf8'));
      if (oauth.access_token && oauth.username) {
        return res.json({
          connected: true,
          username: oauth.username
        });
      }
    }
    res.json({ connected: false });
  } catch (err) {
    console.error('[github-auth] status error:', err);
    res.json({ connected: false });
  }
});

app.post('/setup/api/github/disconnect', requireSetupAuth, async (req, res) => {
  try {
    const oauthPath = path.join(STATE_DIR, 'github-oauth.json');
    if (fs.existsSync(oauthPath)) {
      fs.unlinkSync(oauthPath);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[github-auth] disconnect error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ==============================
// GitHub OAuth API Routes (Non-setup paths for Dashboard compatibility)
// ==============================
// These mirror the /setup/api/github/* routes for the Gerald Dashboard client
// which calls /api/github/* directly

app.post('/api/github/start-auth', requireSetupAuth, async (req, res) => {
  try {
    const response = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        scope: 'repo read:user'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        ok: false,
        error: `GitHub API error: ${errorText}`
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error('[github-auth] start-auth error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post('/api/github/poll-auth', requireSetupAuth, async (req, res) => {
  try {
    const { device_code } = req.body || {};
    if (!device_code) {
      return res.status(400).json({ ok: false, error: 'Missing device_code' });
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({
        ok: false,
        error: `GitHub API error: ${errorText}`
      });
    }

    const data = await response.json();

    if (data.error) {
      if (data.error === 'authorization_pending') {
        return res.json({ status: 'pending' });
      }
      if (data.error === 'slow_down') {
        return res.json({ status: 'slow_down', error: 'slow_down' });
      }
      return res.json({ status: 'error', error: data.error });
    }

    const access_token = data.access_token;
    const userRes = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    if (!userRes.ok) {
      return res.json({
        status: 'error',
        error: 'Failed to fetch user info'
      });
    }

    const userData = await userRes.json();
    const username = userData.login;

    fs.mkdirSync(STATE_DIR, { recursive: true });
    const oauthData = {
      access_token: access_token,
      token_type: data.token_type || 'bearer',
      scope: data.scope || 'repo,read:user',
      username: username,
      connected_at: new Date().toISOString()
    };

    fs.writeFileSync(
      path.join(STATE_DIR, 'github-oauth.json'),
      JSON.stringify(oauthData, null, 2),
      { mode: 0o600 }
    );

    res.json({
      status: 'success',
      access_token: access_token,
      username: username
    });
  } catch (err) {
    console.error('[github-auth] poll-auth error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/github/repos', requireSetupAuth, async (req, res) => {
  try {
    const token = getGitHubToken();
    if (!token) {
      return res.status(400).json({
        ok: false,
        error: 'No GitHub token available. Connect GitHub first.'
      });
    }

    let repos = [];

    try {
      const installRes = await fetch('https://api.github.com/installation/repositories?per_page=100', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (installRes.ok) {
        const installData = await installRes.json();
        if (installData.repositories && installData.repositories.length > 0) {
          repos = installData.repositories;
        }
      }
    } catch {}

    if (repos.length === 0) {
      const userRes = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!userRes.ok) {
        return res.status(userRes.status).json({
          ok: false,
          error: `GitHub API error: ${userRes.statusText}`
        });
      }

      repos = await userRes.json();
    }

    const formattedRepos = repos.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: repo.owner?.login || '',
      private: repo.private,
      default_branch: repo.default_branch,
      html_url: repo.html_url,
      description: repo.description || '',
      language: repo.language || ''
    }));

    res.json({ repos: formattedRepos });
  } catch (err) {
    console.error('[github-auth] repos error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/api/github/status', requireSetupAuth, async (req, res) => {
  try {
    // Check Railway template's OAuth location first
    const oauthPath = path.join(STATE_DIR, 'github-oauth.json');
    if (fs.existsSync(oauthPath)) {
      const oauth = JSON.parse(fs.readFileSync(oauthPath, 'utf8'));
      if (oauth.access_token && oauth.username) {
        return res.json({
          connected: true,
          username: oauth.username
        });
      }
    }

    // Check Dashboard's OAuth location
    const dashboardOAuthPath = path.join(os.homedir(), '.openclaw', 'github-oauth.json');
    if (fs.existsSync(dashboardOAuthPath)) {
      const oauth = JSON.parse(fs.readFileSync(dashboardOAuthPath, 'utf8'));
      if (oauth.access_token && oauth.username) {
        return res.json({
          connected: true,
          username: oauth.username
        });
      }
    }

    res.json({ connected: false });
  } catch (err) {
    console.error('[github-auth] status error:', err);
    res.json({ connected: false });
  }
});

app.post('/api/github/disconnect', requireSetupAuth, async (req, res) => {
  try {
    // Clear Railway template's OAuth token
    const oauthPath = path.join(STATE_DIR, 'github-oauth.json');
    if (fs.existsSync(oauthPath)) {
      fs.unlinkSync(oauthPath);
    }

    // Clear Dashboard's OAuth token
    const dashboardOAuthPath = path.join(os.homedir(), '.openclaw', 'github-oauth.json');
    if (fs.existsSync(dashboardOAuthPath)) {
      fs.unlinkSync(dashboardOAuthPath);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[github-auth] disconnect error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ==============================
// Push Notification API Routes
// ==============================
// These proxy to the Gerald Dashboard server which handles push notifications

app.get('/api/push/vapid-key', requireSetupAuth, async (req, res) => {
  try {
    // Forward to dashboard server
    const dashboardRes = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}/api/push/vapid-key`);
    const data = await dashboardRes.json();
    res.status(dashboardRes.status).json(data);
  } catch (err) {
    console.error('[push] vapid-key error:', err);
    res.status(503).json({ error: 'Dashboard push service unavailable' });
  }
});

app.post('/api/push/subscribe', requireSetupAuth, async (req, res) => {
  try {
    const dashboardRes = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await dashboardRes.json();
    res.status(dashboardRes.status).json(data);
  } catch (err) {
    console.error('[push] subscribe error:', err);
    res.status(503).json({ error: 'Dashboard push service unavailable' });
  }
});

app.post('/api/push/unsubscribe', requireSetupAuth, async (req, res) => {
  try {
    const dashboardRes = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}/api/push/unsubscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body)
    });
    const data = await dashboardRes.json();
    res.status(dashboardRes.status).json(data);
  } catch (err) {
    console.error('[push] unsubscribe error:', err);
    res.status(503).json({ error: 'Dashboard push service unavailable' });
  }
});

app.post('/api/push/test', requireSetupAuth, async (req, res) => {
  try {
    const dashboardRes = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}/api/push/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await dashboardRes.json();
    res.status(dashboardRes.status).json(data);
  } catch (err) {
    console.error('[push] test error:', err);
    res.status(503).json({ error: 'Dashboard push service unavailable - is VAPID configured?' });
  }
});

// ==============================
// Codex CLI Authentication (Token Paste Method)
// ==============================
// Instead of running codex CLI on the container (unreliable), users paste their auth token
app.post('/setup/api/codex/start-auth', requireSetupAuth, async (req, res) => {
  // Return instructions for token-based auth
  res.json({
    ok: true,
    method: 'token-paste',
    instructions: [
      '1. On your local machine, install Codex CLI: npm install -g @openai/codex',
      '2. Run: codex login',
      '3. Complete the authentication in your browser',
      '4. Copy the contents of ~/.codex/auth.json',
      '5. Paste the JSON below and click "Save Token"'
    ],
    authFilePath: '~/.codex/auth.json'
  });
});

// Save Codex auth token (pasted from local machine)
app.post('/setup/api/codex/save-token', requireSetupAuth, async (req, res) => {
  try {
    const { authJson } = req.body;
    
    if (!authJson) {
      return res.status(400).json({ ok: false, error: 'authJson is required' });
    }
    
    // Validate it's valid JSON
    let authData;
    try {
      authData = typeof authJson === 'string' ? JSON.parse(authJson) : authJson;
    } catch (e) {
      console.error('[codex-auth] JSON parse error:', e.message, 'Input:', authJson.substring(0, 200));
      return res.status(400).json({ ok: false, error: 'Invalid JSON format: ' + e.message });
    }
    
    // Log what we received for debugging
    console.log('[codex-auth] Received keys:', Object.keys(authData));
    
    // Accept any valid JSON - Codex auth format may vary
    // Just make sure it's not empty
    if (Object.keys(authData).length === 0) {
      return res.status(400).json({ ok: false, error: 'Auth JSON is empty' });
    }
    
    // Save to /data/.codex/auth.json
    const codexDir = '/data/.codex';
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(path.join(codexDir, 'auth.json'), JSON.stringify(authData, null, 2), { mode: 0o600 });
    
    console.log('[codex-auth] Token saved successfully');
    res.json({ ok: true, message: 'Codex authentication saved' });
  } catch (err) {
    console.error('[codex-auth] save-token error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get('/setup/api/codex/status', requireSetupAuth, async (req, res) => {
  try {
    const authPath = path.join('/data/.codex', 'auth.json');

    if (!fs.existsSync(authPath)) {
      return res.json({ authenticated: false });
    }

    const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));

    // Check if we have a valid token structure
    if (authData.access_token || authData.token) {
      return res.json({
        authenticated: true,
        // Don't expose full auth data, just confirmation
        provider: authData.provider || 'chatgpt'
      });
    }

    res.json({ authenticated: false });
  } catch (err) {
    console.error('[codex-auth] status error:', err);
    res.json({ authenticated: false, error: String(err) });
  }
});

app.post('/setup/api/codex/disconnect', requireSetupAuth, async (req, res) => {
  try {
    const authPath = path.join('/data/.codex', 'auth.json');
    if (fs.existsSync(authPath)) {
      fs.unlinkSync(authPath);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[codex-auth] disconnect error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ==============================
// Codex CLI Authentication (SSH-based for Railway)
// ==============================
// Codex CLI requires browser auth which doesn't work on headless servers.
// Users must authenticate via SSH, then we detect the auth file.

// Check Codex auth status (reads auth file created by `codex login` via SSH)
app.get('/api/model-settings/openai-codex/status', async (req, res) => {
  try {
    // Check multiple possible auth file locations
    const possiblePaths = [
      '/data/.codex/auth.json',
      '/data/.codex/credentials.json',
      path.join('/data', '.codex', 'auth.json')
    ];
    
    let authData = null;
    let authPath = null;
    
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        authPath = p;
        try {
          authData = JSON.parse(fs.readFileSync(p, 'utf8'));
          break;
        } catch (e) {
          console.log('[codex-status] Failed to parse auth file:', p, e.message);
        }
      }
    }
    
    if (!authData) {
      return res.json({ 
        authenticated: false,
        instructions: 'Codex CLI is installed. SSH into your container and run: codex login'
      });
    }

    // Check for various auth formats
    const hasToken = authData.access_token || authData.token || authData.apiKey;
    const hasAccount = authData.account || authData.email || authData.user;
    
    if (hasToken || hasAccount) {
      return res.json({ 
        authenticated: true,
        method: authData.apiKey ? 'api_key' : 'subscription',
        account: authData.account?.email || authData.email || authData.user || 'Connected'
      });
    }

    res.json({ 
      authenticated: false,
      instructions: 'Codex CLI is installed. SSH into your container and run: codex login'
    });
  } catch (err) {
    console.error('[codex-status] error:', err);
    res.json({ 
      authenticated: false, 
      error: err.message,
      instructions: 'Codex CLI is installed. SSH into your container and run: codex login'
    });
  }
});

// Disconnect Codex auth
app.post('/api/model-settings/openai-codex/disconnect', async (req, res) => {
  try {
    const possiblePaths = [
      '/data/.codex/auth.json',
      '/data/.codex/credentials.json',
      path.join('/data', '.codex', 'auth.json')
    ];
    
    let deleted = false;
    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        deleted = true;
        console.log('[codex-disconnect] Removed auth file:', p);
      }
    }
    
    // Also try running codex logout if available
    try {
      await runCmd('codex', ['logout']);
    } catch (e) {
      // Ignore errors from logout command
    }
    
    res.json({ ok: true, disconnected: deleted });
  } catch (err) {
    console.error('[codex-disconnect] error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ==============================
// Claude Code CLI Authentication
// ==============================
// Note: Claude Code does not support device code flow.
// Users need to authenticate manually via SSH or provide instructions.
app.get('/setup/api/claude/status', requireSetupAuth, async (req, res) => {
  try {
    const authPath = path.join('/data', '.claude.json');

    if (!fs.existsSync(authPath)) {
      return res.json({ authenticated: false });
    }

    const authData = JSON.parse(fs.readFileSync(authPath, 'utf8'));

    // Check for oauthAccount field (indicates Claude Pro/Max subscription)
    if (authData.oauthAccount || authData.accessToken) {
      return res.json({
        authenticated: true,
        account: authData.oauthAccount?.email || 'authenticated'
      });
    }

    res.json({ authenticated: false });
  } catch (err) {
    console.error('[claude-auth] status error:', err);
    res.json({ authenticated: false, error: String(err) });
  }
});

// Save Claude auth token (pasted from local machine)
app.post('/setup/api/claude/save-token', requireSetupAuth, async (req, res) => {
  try {
    const { oauthToken } = req.body;
    
    if (!oauthToken) {
      return res.status(400).json({ ok: false, error: 'oauthToken is required' });
    }
    
    // Create auth data structure that Claude Code expects
    const authData = {
      oauthAccount: { token: oauthToken },
      accessToken: oauthToken
    };
    
    // Save to /data/.claude.json
    const authPath = path.join('/data', '.claude.json');
    fs.writeFileSync(authPath, JSON.stringify(authData, null, 2), { mode: 0o600 });
    
    console.log('[claude-auth] Token saved successfully');
    res.json({ ok: true, message: 'Claude Code authentication saved' });
  } catch (err) {
    console.error('[claude-auth] save-token error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post('/setup/api/claude/disconnect', requireSetupAuth, async (req, res) => {
  try {
    const authPath = path.join('/data', '.claude.json');
    if (fs.existsSync(authPath)) {
      fs.unlinkSync(authPath);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[claude-auth] disconnect error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post("/setup/api/run", requireSetupAuth, async (req, res) => {
  perfLog.start = Date.now();
  perfLog('[setup] Start');
  
  try {
    if (isConfigured()) {
      await ensureGatewayRunning(OPENCLAW_GATEWAY_TOKEN);
      return res.json({
        ok: true,
        output:
          "Already configured.\nUse Reset setup if you want to rerun onboarding.\n",
      });
    }

    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
    perfLog('[setup] Directories created');

    const payload = req.body || {};
    const onboardArgs = buildOnboardArgs(payload, OPENCLAW_GATEWAY_TOKEN);

    // DIAGNOSTIC: Log token we're passing to onboard
    console.log(`[onboard] ========== TOKEN DIAGNOSTIC START ==========`);
    console.log(`[onboard] Wrapper token (from env/file/generated): ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (length: ${OPENCLAW_GATEWAY_TOKEN.length})`);
    console.log(`[onboard] Onboard command args include: --gateway-token ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);
    console.log(`[onboard] Full onboard command: node ${clawArgs(onboardArgs).join(' ').replace(OPENCLAW_GATEWAY_TOKEN, OPENCLAW_GATEWAY_TOKEN.slice(0, 16) + '...')}`);

    const onboard = await runCmd(OPENCLAW_NODE, clawArgs(onboardArgs));

    let extra = "";

    const ok = onboard.code === 0 && isConfigured();

    // DIAGNOSTIC: Check what token onboard actually wrote to config
    if (ok) {
      try {
        const configAfterOnboard = JSON.parse(fs.readFileSync(configPath(), "utf8"));
        const tokenAfterOnboard = configAfterOnboard?.gateway?.auth?.token;
        console.log(`[onboard] Token in config AFTER onboard: ${tokenAfterOnboard?.slice(0, 16)}... (length: ${tokenAfterOnboard?.length || 0})`);
        console.log(`[onboard] Token match: ${tokenAfterOnboard === OPENCLAW_GATEWAY_TOKEN ? '✓ MATCHES' : '✗ MISMATCH!'}`);
        if (tokenAfterOnboard !== OPENCLAW_GATEWAY_TOKEN) {
          console.log(`[onboard] ⚠️  PROBLEM: onboard command ignored --gateway-token flag and wrote its own token!`);
          extra += `\n[WARNING] onboard wrote different token than expected\n`;
          extra += `  Expected: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...\n`;
          extra += `  Got:      ${tokenAfterOnboard?.slice(0, 16)}...\n`;
        }
      } catch (err) {
        console.error(`[onboard] Could not check config after onboard: ${err}`);
      }
    }

    // Optional channel setup (only after successful onboarding, and only if the installed CLI supports it).
    if (ok) {
      // Ensure gateway token is written into config so the browser UI can authenticate reliably.
      // (We also enforce loopback bind since the wrapper proxies externally.)
      console.log(`[onboard] Now syncing wrapper token to config (${OPENCLAW_GATEWAY_TOKEN.slice(0, 8)}...)`);

      await runCmd(OPENCLAW_NODE, clawArgs(["config", "set", "gateway.mode", "local"]));
      await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "gateway.auth.mode", "token"]),
      );

      const setTokenResult = await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "gateway.auth.token",
          OPENCLAW_GATEWAY_TOKEN,
        ]),
      );

      console.log(`[onboard] config set gateway.auth.token result: exit code ${setTokenResult.code}`);
      if (setTokenResult.output?.trim()) {
        console.log(`[onboard] config set output: ${setTokenResult.output}`);
      }

      if (setTokenResult.code !== 0) {
        console.error(`[onboard] ⚠️  WARNING: config set gateway.auth.token failed with code ${setTokenResult.code}`);
        extra += `\n[WARNING] Failed to set gateway token in config: ${setTokenResult.output}\n`;
      }

      // Verify the token was actually written to config
      try {
        const configContent = fs.readFileSync(configPath(), "utf8");
        const config = JSON.parse(configContent);
        const configToken = config?.gateway?.auth?.token;

        console.log(`[onboard] Token verification after sync:`);
        console.log(`[onboard]   Wrapper token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`);
        console.log(`[onboard]   Config token:  ${configToken?.slice(0, 16)}... (len: ${configToken?.length || 0})`);

        if (configToken !== OPENCLAW_GATEWAY_TOKEN) {
          console.error(`[onboard] ✗ ERROR: Token mismatch after config set!`);
          console.error(`[onboard]   Full wrapper token: ${OPENCLAW_GATEWAY_TOKEN}`);
          console.error(`[onboard]   Full config token:  ${configToken || 'null'}`);
          extra += `\n[ERROR] Token verification failed! Config has different token than wrapper.\n`;
          extra += `  Wrapper: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...\n`;
          extra += `  Config:  ${configToken?.slice(0, 16)}...\n`;
        } else {
          console.log(`[onboard] ✓ Token verification PASSED - tokens match!`);
          extra += `\n[onboard] ✓ Gateway token synced successfully\n`;
        }
      } catch (err) {
        console.error(`[onboard] ERROR: Could not verify token in config: ${err}`);
        extra += `\n[ERROR] Could not verify token: ${String(err)}\n`;
      }

      console.log(`[onboard] ========== TOKEN DIAGNOSTIC END ==========`);

      // Only set gateway.bind when env override is explicitly set
      if (OPENCLAW_GATEWAY_BIND) {
        await runCmd(
          OPENCLAW_NODE,
          clawArgs(["config", "set", "gateway.bind", OPENCLAW_GATEWAY_BIND]),
        );
      }
      await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "gateway.port",
          String(INTERNAL_GATEWAY_PORT),
        ]),
      );
      // Disable OpenClaw Control UI (Gerald Dashboard replaces it)
      await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "gateway.controlUi.enabled", "false"]),
      );
      // Enable OpenAI-compatible chat completions endpoint (required by Gerald Dashboard)
      await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "gateway.http.endpoints.chatCompletions.enabled", "true"]),
      );
      await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "--json", "gateway.trustedProxies", '["127.0.0.1/8","::1/128","100.64.0.0/10","172.16.0.0/12"]']),
      );

      // Sync the gateway auth token to match the wrapper's OPENCLAW_GATEWAY_TOKEN env var
      // This ensures the proxy can authenticate WebSocket connections
      await runCmd(
        OPENCLAW_NODE,
        clawArgs(["config", "set", "gateway.auth.token", OPENCLAW_GATEWAY_TOKEN]),
      );

      const channelsHelp = await runCmd(
        OPENCLAW_NODE,
        clawArgs(["channels", "add", "--help"]),
      );
      const helpText = channelsHelp.output || "";

      const supports = (name) => helpText.includes(name);

      if (payload.telegramToken?.trim()) {
        if (!supports("telegram")) {
          extra +=
            "\n[telegram] skipped (this openclaw build does not list telegram in `channels add --help`)\n";
        } else {
          // Avoid `channels add` here (it has proven flaky across builds); write config directly.
          const token = payload.telegramToken.trim();
          const cfgObj = {
            enabled: true,
            dmPolicy: "pairing",
            botToken: token,
            groupPolicy: "allowlist",
            streamMode: "partial",
          };
          const set = await runCmd(
            OPENCLAW_NODE,
            clawArgs([
              "config",
              "set",
              "--json",
              "channels.telegram",
              JSON.stringify(cfgObj),
            ]),
          );
          const get = await runCmd(
            OPENCLAW_NODE,
            clawArgs(["config", "get", "channels.telegram"]),
          );
          extra += `\n[telegram config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
          extra += `\n[telegram verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
        }
      }

      if (payload.discordToken?.trim()) {
        if (!supports("discord")) {
          extra +=
            "\n[discord] skipped (this openclaw build does not list discord in `channels add --help`)\n";
        } else {
          const token = payload.discordToken.trim();
          const cfgObj = {
            enabled: true,
            token,
            groupPolicy: "allowlist",
            dm: {
              policy: "pairing",
            },
          };
          const set = await runCmd(
            OPENCLAW_NODE,
            clawArgs([
              "config",
              "set",
              "--json",
              "channels.discord",
              JSON.stringify(cfgObj),
            ]),
          );
          const get = await runCmd(
            OPENCLAW_NODE,
            clawArgs(["config", "get", "channels.discord"]),
          );
          extra += `\n[discord config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
          extra += `\n[discord verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
        }
      }

      if (payload.slackBotToken?.trim() || payload.slackAppToken?.trim()) {
        if (!supports("slack")) {
          extra +=
            "\n[slack] skipped (this openclaw build does not list slack in `channels add --help`)\n";
        } else {
          const cfgObj = {
            enabled: true,
            botToken: payload.slackBotToken?.trim() || undefined,
            appToken: payload.slackAppToken?.trim() || undefined,
          };
          const set = await runCmd(
            OPENCLAW_NODE,
            clawArgs([
              "config",
              "set",
              "--json",
              "channels.slack",
              JSON.stringify(cfgObj),
            ]),
          );
          const get = await runCmd(
            OPENCLAW_NODE,
            clawArgs(["config", "get", "channels.slack"]),
          );
          extra += `\n[slack config] exit=${set.code} (output ${set.output.length} chars)\n${set.output || "(no output)"}`;
          extra += `\n[slack verify] exit=${get.code} (output ${get.output.length} chars)\n${get.output || "(no output)"}`;
        }
      }

      // ── Illumin8 client configuration ──────────────────────────────────
      if (payload.clientDomain?.trim()) {
        // Normalize clientDomain: strip www. prefix if present
        // Store apex domain (e.g., solarwyse.ca) for proper subdomain routing
        const rawDomain = payload.clientDomain.trim().toLowerCase();
        const normalizedDomain = rawDomain.replace(/^www\./, '');
        
        const illumin8Config = {
          clientDomain: normalizedDomain,
          clientName: payload.clientName?.trim() || '',
          guardrailLevel: payload.guardrailLevel || 'standard',
          githubRepo: payload.githubRepo?.trim() || '',
          // workspaceRepo is hardcoded to illumin8ca/gerald
          prodBranch: payload.prodBranch?.trim() || 'main',
          devBranch: payload.devBranch?.trim() || 'development',
          configuredAt: new Date().toISOString(),
        };

        fs.writeFileSync(
          path.join(STATE_DIR, 'illumin8.json'),
          JSON.stringify(illumin8Config, null, 2)
        );

        // Also set CLIENT_DOMAIN env for current process
        process.env.CLIENT_DOMAIN = illumin8Config.clientDomain;

        extra += `\n[illumin8] Client configured: ${illumin8Config.clientDomain}\n`;

        // Create site directories
        fs.mkdirSync(path.join(SITE_DIR, 'production'), { recursive: true });
        fs.mkdirSync(path.join(SITE_DIR, 'dev'), { recursive: true });

        // Create placeholder index.html for both
        const placeholder = `<!DOCTYPE html>
<html><head><title>Coming Soon</title></head>
<body style="display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;background:#0a0a0f;color:#fff;">
<h1>Site coming soon</h1>
</body></html>`;

        for (const dir of ['production', 'dev']) {
          const indexPath = path.join(SITE_DIR, dir, 'index.html');
          if (!fs.existsSync(indexPath)) {
            fs.writeFileSync(indexPath, placeholder);
          }
        }
        extra += `\n[illumin8] Site directories created\n`;

        // Write CLIENT-SKILLS.md to workspace
        try {
          const templatePath = path.join(process.cwd(), 'src', 'templates', 'CLIENT-SKILLS.md');
          let template = fs.readFileSync(templatePath, 'utf8');
          template = template.replaceAll('{{CLIENT_NAME}}', payload.clientName?.trim() || 'Client');
          template = template.replaceAll('{{CLIENT_DOMAIN}}', payload.clientDomain.trim().toLowerCase());

          const skillsPath = path.join(WORKSPACE_DIR, 'CLIENT-SKILLS.md');
          fs.writeFileSync(skillsPath, template);
          extra += `\n[illumin8] CLIENT-SKILLS.md written to workspace\n`;
        } catch (err) {
          console.error('[illumin8] Failed to write CLIENT-SKILLS.md:', err);
          extra += `\n[illumin8] Warning: Could not write CLIENT-SKILLS.md: ${err.message}\n`;
        }
      }

      // ── Auto-configure Cloudflare DNS ─────────────────────────────────────
      if (payload.clientDomain?.trim() && process.env.CLOUDFLARE_API_KEY?.trim()) {
        // Use normalized domain (www. already stripped in illumin8Config above)
        const rawDomain = payload.clientDomain.trim().toLowerCase();
        const domain = rawDomain.replace(/^www\./, '');

        // Determine Railway domain for CNAME target
        // IMPORTANT: Only use the *.up.railway.app domain, NOT custom domains (would be circular CNAME)
        const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim() || '';
        const staticUrl = process.env.RAILWAY_STATIC_URL?.replace('https://', '')?.trim() || '';
        const railwayDomain = (publicDomain.endsWith('.up.railway.app') ? publicDomain : '')
          || (staticUrl.endsWith('.up.railway.app') ? staticUrl : '')
          || `${(process.env.RAILWAY_SERVICE_NAME || 'gerald').toLowerCase()}-production.up.railway.app`;

        extra += `\n[dns] Configuring Cloudflare DNS for ${domain}...\n`;
        const dnsResult = await setupCloudflareDNS(domain, railwayDomain);
        extra += `[dns] ${dnsResult.output}\n`;

        // Auto-create Turnstile widget
        if (dnsResult.ok && dnsResult.zoneId) {
          extra += `[turnstile] Creating Turnstile widget...\n`;
          const turnstileResult = await createTurnstileWidget(domain, dnsResult.zoneId);
          extra += `[turnstile] ${turnstileResult.output}\n`;

          if (turnstileResult.ok) {
            // Auto-save Turnstile keys to services config
            const servicesPath = path.join(STATE_DIR, 'services.json');
            let services = {};
            try { services = JSON.parse(fs.readFileSync(servicesPath, 'utf8')); } catch {}
            services.turnstile = {
              siteKey: turnstileResult.siteKey,
              secretKey: turnstileResult.secretKey,
            };
            fs.writeFileSync(servicesPath, JSON.stringify(services, null, 2));
            extra += `[turnstile] Keys saved to services.json\n`;
          }
        }
      }

      // ── SendGrid configuration ─────────────────────────────────────────────
      const resolvedSendgridKey = payload.sendgridApiKey?.trim() || process.env.SENDGRID_API_KEY?.trim();
      if (resolvedSendgridKey && payload.sendgridSenderEmail?.trim()) {
        const sendgridConfig = {
          apiKey: resolvedSendgridKey,
          senderEmail: payload.sendgridSenderEmail.trim(),
          contactFromName: payload.contactFromName?.trim() || '',
        };
        fs.writeFileSync(
          path.join(STATE_DIR, 'sendgrid.json'),
          JSON.stringify(sendgridConfig, null, 2),
          { mode: 0o600 }
        );
        extra += `\n[sendgrid] Configuration saved\n`;

        // Auto-configure SendGrid domain authentication if client domain and Cloudflare are available
        const cfKey = process.env.CLOUDFLARE_API_KEY?.trim();
        const cfEmail = process.env.CLOUDFLARE_EMAIL?.trim();
        if (payload.clientDomain?.trim() && cfKey && cfEmail) {
          // Use normalized domain (www. stripped)
          const rawDomain = payload.clientDomain.trim().toLowerCase();
          const normalizedDomain = rawDomain.replace(/^www\./, '');
          extra += `\n[sendgrid-domain] Configuring SendGrid domain authentication...\n`;
          const domainAuthResult = await setupSendGridDomainAuth(
            normalizedDomain,
            resolvedSendgridKey
          );
          extra += domainAuthResult.output;
        }
      }

      // ── Auth configuration ──────────────────────────────────────────────────
      if (payload.allowedEmails?.trim()) {
        const emails = payload.allowedEmails
          .split(/[\n,]/)
          .map(e => e.trim())
          .filter(e => e && e.includes('@'));

        if (emails.length > 0) {
          const authConfig = {
            allowedEmails: emails,
            sessions: {},
            magicLinks: {},
          };

          fs.writeFileSync(
            path.join(STATE_DIR, 'auth.json'),
            JSON.stringify(authConfig, null, 2),
            { mode: 0o600 }
          );
          extra += `\n[auth] Allowed emails configured: ${emails.join(', ')}\n`;
        }
      }

      // ── Services configuration ───────────────────────────────────────────
      const servicesConfig = {};
      const resolvedServiceSendgrid = payload.sendgridKey?.trim() || resolvedSendgridKey || process.env.SENDGRID_API_KEY?.trim();
      if (resolvedServiceSendgrid) servicesConfig.sendgridKey = resolvedServiceSendgrid;
      if (payload.twilioSid?.trim()) {
        servicesConfig.twilio = {
          accountSid: payload.twilioSid.trim(),
          authToken: payload.twilioToken?.trim() || '',
          phoneNumber: payload.twilioPhone?.trim() || '',
        };
      }
      if (payload.turnstileSiteKey?.trim()) {
        servicesConfig.turnstile = {
          siteKey: payload.turnstileSiteKey.trim(),
          secretKey: payload.turnstileSecretKey?.trim() || '',
        };
      }

      if (Object.keys(servicesConfig).length > 0) {
        fs.writeFileSync(
          path.join(STATE_DIR, 'services.json'),
          JSON.stringify(servicesConfig, null, 2)
        );
        extra += `\n[services] Configuration saved\n`;
      }

      // ── Save additional API keys to auth-profiles.json ──────────────────
      const extraKeys = {};
      if (payload.anthropicApiKey?.trim()) extraKeys.anthropic = payload.anthropicApiKey.trim();
      if (payload.openaiApiKey?.trim()) extraKeys.openai = payload.openaiApiKey.trim();
      if (payload.openrouterApiKey?.trim()) extraKeys.openrouter = payload.openrouterApiKey.trim();
      
      if (Object.keys(extraKeys).length > 0) {
        const agentDir = path.join(STATE_DIR, 'agents', 'main', 'agent');
        const authProfilesPath = path.join(agentDir, 'auth-profiles.json');
        fs.mkdirSync(agentDir, { recursive: true });
        
        let authProfiles = { version: 1, profiles: {}, lastGood: {}, usageStats: {} };
        if (fs.existsSync(authProfilesPath)) {
          try { authProfiles = JSON.parse(fs.readFileSync(authProfilesPath, 'utf8')); } catch {}
        }
        
        // Also read openclaw.json to save API keys there (dashboard reads from both)
        let openclawConfig = {};
        if (fs.existsSync(configPath())) {
          try { openclawConfig = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch {}
        }
        
        const providerBaseUrls = {
          anthropic: 'https://api.anthropic.com/v1',
          openai: 'https://api.openai.com/v1',
          openrouter: 'https://openrouter.ai/api/v1',
        };
        
        for (const [provider, key] of Object.entries(extraKeys)) {
          // Save to auth-profiles.json (what the gateway reads)
          authProfiles.profiles[`${provider}:default`] = {
            type: 'api_key',
            provider,
            key,
          };
          
          // Save to openclaw.json models.providers (what the dashboard reads)
          if (!openclawConfig.models) openclawConfig.models = {};
          if (!openclawConfig.models.providers) openclawConfig.models.providers = {};
          openclawConfig.models.providers[provider] = {
            ...(openclawConfig.models.providers[provider] || {}),
            apiKey: key,
            baseUrl: providerBaseUrls[provider] || '',
          };
          if (provider === 'openrouter' || provider === 'openai') {
            openclawConfig.models.providers[provider].api = 'openai-completions';
          }
          
          extra += `\n[auth] Saved ${provider} API key\n`;
        }
        
        fs.writeFileSync(authProfilesPath, JSON.stringify(authProfiles, null, 2), { mode: 0o600 });
        fs.writeFileSync(configPath(), JSON.stringify(openclawConfig, null, 2));
        console.log(`[onboard] Saved extra API keys: ${Object.keys(extraKeys).join(', ')}`);
      }

      // ── Clone and build website from GitHub ──────────────────────────────
      if (payload.githubRepo?.trim() && payload.clientDomain?.trim()) {
        const repoUrl = `https://github.com/${payload.githubRepo.trim()}`;
        // Prefer manual token from form, fall back to OAuth token, then env var
        let token = payload.githubToken?.trim() || '';
        if (!token) {
          token = getGitHubToken();
        }
        const prodBranch = payload.prodBranch?.trim() || 'main';
        const devBranch = payload.devBranch?.trim() || 'development';

        // Save GitHub config for future rebuilds (only save manual token, not OAuth token)
        const githubConfig = {
          repo: payload.githubRepo.trim(),
          prodBranch,
          devBranch,
          // Only save manual token (OAuth token is saved separately in github-oauth.json)
          token: payload.githubToken?.trim() || '',
        };
        fs.writeFileSync(
          path.join(STATE_DIR, 'github.json'),
          JSON.stringify(githubConfig, null, 2),
          { mode: 0o600 }
        );

        // Build production
        extra += `\n[build] Building production site from ${prodBranch}...\n`;
        const prodResult = await cloneAndBuild(repoUrl, prodBranch, PRODUCTION_DIR, token);
        extra += `[build] Production: ${prodResult.output}\n`;

        // Auto-save any existing dev site changes before clone/pull
        extra += `[build] Checking for uncommitted dev site changes...\n`;
        const saveResult = await autoSaveDevChanges();
        if (saveResult.saved) {
          extra += `[build] ✓ Auto-saved dev site changes\n`;
        }

        // Clone or pull development branch and start dev server
        let devResult;
        const devHasGit = fs.existsSync(path.join(DEV_DIR, '.git'));
        const devHasPackage = fs.existsSync(path.join(DEV_DIR, 'package.json'));
        
        if (devHasGit && devHasPackage) {
          // Dev site already exists - pull instead of re-cloning
          extra += `[build] Dev site exists, pulling latest from ${devBranch}...\n`;
          devResult = await pullDevBranch();
        } else {
          // Fresh clone needed
          extra += `[build] Cloning dev branch (${devBranch}) for live dev server...\n`;
          extra += `[build] Target directory: ${DEV_DIR}\n`;
          devResult = await cloneAndBuild(repoUrl, devBranch, DEV_DIR, token, { keepSource: true });
        }
        extra += `[build] Dev: ${devResult.output}\n`;
        
        // Verify dev site has files
        const devHasPackageJson = fs.existsSync(path.join(DEV_DIR, 'package.json'));
        const devHasDist = fs.existsSync(path.join(DEV_DIR, 'dist'));
        extra += `[build] Dev verification: package.json=${devHasPackageJson}, dist=${devHasDist}\n`;
        if (!devHasPackageJson) {
          extra += `[build] ⚠️ Warning: Dev directory missing package.json - dev server may not work\n`;
        }

        // Start dev server
        try {
          await startDevServer();
          extra += `[dev-server] ✓ Live dev server started on port ${DEV_SERVER_PORT}\n`;
        } catch (err) {
          extra += `[dev-server] ⚠️ Failed to start dev server: ${err.message}\n`;
        }

        // Auto-register GitHub webhook for push events (auto-rebuild on push)
        if (token && payload.clientDomain?.trim()) {
          try {
            const webhookUrl = `https://${payload.clientDomain.trim().toLowerCase()}/api/webhook/github`;
            const repo = payload.githubRepo.trim();

            // Check if webhook already exists
            const existingRes = await fetch(`https://api.github.com/repos/${repo}/hooks`, {
              headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' },
            });
            const existing = existingRes.ok ? await existingRes.json() : [];
            const alreadyExists = existing.some(h => h.config?.url === webhookUrl);

            if (!alreadyExists) {
              const hookRes = await fetch(`https://api.github.com/repos/${repo}/hooks`, {
                method: 'POST',
                headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  name: 'web',
                  active: true,
                  events: ['push'],
                  config: { url: webhookUrl, content_type: 'json', insecure_ssl: '0' },
                }),
              });
              if (hookRes.ok) {
                extra += `[webhook] ✓ GitHub webhook registered: ${webhookUrl}\n`;
              } else {
                const err = await hookRes.text();
                extra += `[webhook] ⚠️ Failed to register webhook (${hookRes.status}): ${err}\n`;
              }
            } else {
              extra += `[webhook] ✓ GitHub webhook already exists\n`;
            }
          } catch (err) {
            extra += `[webhook] ⚠️ Could not register webhook: ${err.message}\n`;
          }
        }
      }

      // ── Clone and set up Gerald Dashboard ──────────────────────────────
      extra += '\n[dashboard] Setting up Gerald Dashboard...\n';
      const githubToken = payload.githubToken?.trim() || getGitHubToken();
      const dashResult = await setupDashboard(githubToken);
      extra += `[dashboard] ${dashResult.output}\n`;

      // ── Default model configuration ──────────────────────────────────────
      // Configure Moonshot provider if API key is set
      if (process.env.MOONSHOT_API_KEY?.trim()) {
        const moonshotKey = process.env.MOONSHOT_API_KEY.trim();
        const moonshotConfig = {
          baseUrl: "https://api.moonshot.cn/v1",
          apiKey: moonshotKey,
          api: "openai-completions",
          models: [
            {
              id: "kimi-k2.5",
              name: "Kimi K2.5",
              reasoning: false,
              input: [0.0012, 0.0012],
              output: [0.0012, 0.0012],
              contextWindow: 131072
            }
          ]
        };
        
        await runCmd(OPENCLAW_NODE, clawArgs([
          'config', 'set', '--json', 'agents.defaults.model.providers.moonshot',
          JSON.stringify(moonshotConfig)
        ]));
        extra += `\n[moonshot] Provider configured with API key\n`;
      }

      // Set default primary model
      if (process.env.DEFAULT_MODEL?.trim()) {
        await runCmd(OPENCLAW_NODE, clawArgs([
          'config', 'set', 'agents.defaults.model.primary', process.env.DEFAULT_MODEL.trim()
        ]));
        extra += `\n[model] Default model set: ${process.env.DEFAULT_MODEL}\n`;
      } else if (process.env.MOONSHOT_API_KEY?.trim()) {
        // If Moonshot key is set but no explicit default model, use Moonshot
        await runCmd(OPENCLAW_NODE, clawArgs([
          'config', 'set', 'agents.defaults.model.primary', 'moonshot/kimi-k2.5'
        ]));
        extra += `\n[model] Default model set: moonshot/kimi-k2.5 (from MOONSHOT_API_KEY)\n`;
      }

      // Apply changes immediately.
      console.log('[setup] Starting gateway after successful setup...');
      try {
        await restartGateway(OPENCLAW_GATEWAY_TOKEN);
        console.log('[setup] ✓ Gateway started successfully');
        extra += '\n[gateway] ✓ Gateway started successfully\n';
      } catch (err) {
        console.error('[setup] ✗ Gateway startup failed:', err);
        extra += `\n[gateway] ✗ Gateway startup failed: ${err.message}\n`;
      }
    }

    // Build completion message with link to Gerald dashboard
    const clientDomain = getClientDomain();
    let completionMsg = '';
    if (ok && clientDomain) {
      completionMsg = `\n${'─'.repeat(50)}\n` +
        `✅ Setup complete!\n\n` +
        `🌐 Production site: https://${clientDomain}\n` +
        `🔧 Dev site: https://dev.${clientDomain}\n` +
        `🤖 Gerald Dashboard: https://gerald.${clientDomain}\n` +
        `\nYour Gerald deployment is ready to go!\n`;
    } else if (ok) {
      completionMsg = `\n${'─'.repeat(50)}\n✅ Setup complete!\n`;
    }

    return res.status(ok ? 200 : 500).json({
      ok,
      output: `${onboard.output}${extra}${completionMsg}`,
      clientDomain: clientDomain || null,
    });
  } catch (err) {
    console.error("[/setup/api/run] error:", err);
    return res
      .status(500)
      .json({ ok: false, output: `Internal error: ${String(err)}` });
  }
});

app.get("/setup/api/debug", requireSetupAuth, async (_req, res) => {
  const v = await runCmd(OPENCLAW_NODE, clawArgs(["--version"]));
  const help = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["channels", "add", "--help"]),
  );
  res.json({
    wrapper: {
      node: process.version,
      port: PORT,
      stateDir: STATE_DIR,
      workspaceDir: WORKSPACE_DIR,
      configPath: configPath(),
      gatewayTokenFromEnv: Boolean(process.env.OPENCLAW_GATEWAY_TOKEN?.trim()),
      gatewayTokenPersisted: fs.existsSync(
        path.join(STATE_DIR, "gateway.token"),
      ),
      railwayCommit: process.env.RAILWAY_GIT_COMMIT_SHA || null,
    },
    openclaw: {
      entry: OPENCLAW_ENTRY,
      node: OPENCLAW_NODE,
      version: v.output.trim(),
      channelsAddHelpIncludesTelegram: help.output.includes("telegram"),
    },
  });
});

app.post("/setup/api/pairing/approve", requireSetupAuth, async (req, res) => {
  const { channel, code } = req.body || {};
  if (!channel || !code) {
    return res
      .status(400)
      .json({ ok: false, error: "Missing channel or code" });
  }
  const r = await runCmd(
    OPENCLAW_NODE,
    clawArgs(["pairing", "approve", String(channel), String(code)]),
  );
  return res
    .status(r.code === 0 ? 200 : 500)
    .json({ ok: r.code === 0, output: r.output });
});

app.post("/setup/api/reset", requireSetupAuth, async (_req, res) => {
  // Minimal reset: delete the config file so /setup can rerun.
  // Keep credentials/sessions/workspace by default.
  try {
    fs.rmSync(configPath(), { force: true });
    res
      .type("text/plain")
      .send("OK - deleted config file. You can rerun setup now.");
  } catch (err) {
    res.status(500).type("text/plain").send(String(err));
  }
});

// Manual gateway control endpoints for debugging
app.post("/setup/api/gateway/start", requireSetupAuth, async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(400).json({ ok: false, error: 'Not configured. Run setup first.' });
    }
    if (getGatewayProc()) {
      return res.json({ ok: true, message: 'Gateway already running' });
    }
    
    console.log('[manual-gateway] Starting gateway...');
    await ensureGatewayRunning(OPENCLAW_GATEWAY_TOKEN);
    res.json({ ok: true, message: 'Gateway started successfully' });
  } catch (err) {
    console.error('[manual-gateway] Failed:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.post("/setup/api/gateway/restart", requireSetupAuth, async (req, res) => {
  try {
    if (!isConfigured()) {
      return res.status(400).json({ ok: false, error: 'Not configured. Run setup first.' });
    }
    
    console.log('[manual-gateway] Restarting gateway...');
    await restartGateway(OPENCLAW_GATEWAY_TOKEN);
    res.json({ ok: true, message: 'Gateway restarted successfully' });
  } catch (err) {
    console.error('[manual-gateway] Restart failed:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/setup/api/gateway/status", requireSetupAuth, async (req, res) => {
  res.json({
    configured: isConfigured(),
    running: !!getGatewayProc(),
    starting: isGatewayStarting(),
    processId: getGatewayProc()?.pid || null,
  });
});

// Config repair endpoint — diagnose and fix invalid config entries
app.post("/setup/api/config/repair", requireSetupAuth, async (req, res) => {
  try {
    const dryRun = req.body?.dryRun === true;
    const result = fixInvalidConfig(dryRun);
    
    if (!dryRun && result.repaired) {
      console.log('[config-repair] Restarting gateway with repaired config...');
      try {
        await restartGateway(OPENCLAW_GATEWAY_TOKEN);
        result.gatewayRestarted = true;
      } catch (err) {
        result.gatewayRestarted = false;
        result.restartError = err.message;
      }
    }
    
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[config-repair] API error:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/setup/api/config/repair", requireSetupAuth, async (req, res) => {
  // GET = dry run (diagnose only, no changes)
  try {
    const result = fixInvalidConfig(true);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Manual dashboard control endpoints
app.post("/setup/api/dashboard/start", requireSetupAuth, async (req, res) => {
  try {
    if (getDashboardProcess()) {
      return res.json({ ok: true, message: 'Dashboard already running' });
    }
    
    console.log('[manual-dashboard] Starting dashboard...');
    await startDashboard(OPENCLAW_GATEWAY_TOKEN);
    res.json({ ok: true, message: 'Dashboard started successfully' });
  } catch (err) {
    console.error('[manual-dashboard] Failed:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/setup/api/dashboard/status", requireSetupAuth, async (req, res) => {
  res.json({
    running: !!getDashboardProcess(),
    installed: fs.existsSync(path.join(DASHBOARD_DIR, 'package.json')),
    processId: getDashboardProcess()?.pid || null,
  });
});

// Rebuild site from GitHub (can be triggered by Gerald or webhook)
app.post('/api/rebuild', requireSetupAuth, async (req, res) => {
  try {
    // Auto-save dev site changes before rebuild
    await autoSaveDevChanges();

    const githubConfigPath = path.join(STATE_DIR, 'github.json');
    if (!fs.existsSync(githubConfigPath)) {
      return res.status(400).json({ ok: false, error: 'No GitHub configuration found. Run setup first.' });
    }

    const githubConfig = JSON.parse(fs.readFileSync(githubConfigPath, 'utf8'));
    const repoUrl = `https://github.com/${githubConfig.repo}`;
    const token = getGitHubToken();
    const target = req.body?.target || 'both'; // 'production', 'dev', or 'both'

    let output = '';

    if (target === 'production' || target === 'both') {
      const result = await cloneAndBuild(repoUrl, githubConfig.prodBranch, PRODUCTION_DIR, token);
      output += `Production (${githubConfig.prodBranch}): ${result.output}\n`;
      
      // For SSR sites, restart the production server
      if (isProdSSR()) {
        await restartProdServer();
        output += 'Production SSR server restarted.\n';
      }
    }

    if (target === 'dev' || target === 'both') {
      const result = await pullDevBranch();
      output += `Dev (${githubConfig.devBranch}): ${result.output}\n`;
      if (getDevServerProcess()) {
        await restartDevServer();
        output += 'Dev server restarted.\n';
      } else {
        await startDevServer();
        output += 'Dev server started.\n';
      }
    }

    res.json({ ok: true, output });
  } catch (err) {
    console.error('[rebuild]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Rebuild Gerald Dashboard from GitHub
app.post('/api/rebuild-dashboard', requireSetupAuth, async (req, res) => {
  try {
    // Auto-save dev site changes before rebuild
    await autoSaveDevChanges();

    // Kill existing dashboard
    await stopDashboard();

    // Remove existing installation to force fresh clone
    await safeRemoveDir(DASHBOARD_DIR);

    // Token from request body, github.json, or env
    const token = req.body?.token?.trim() || '';

    const result = await setupDashboard(token);
    if (!result.ok) {
      return res.status(500).json({ ok: false, output: result.output });
    }

    // Restart dashboard
    await startDashboard(OPENCLAW_GATEWAY_TOKEN);
    res.json({ ok: true, output: result.output + '\nDashboard restarted.' });
  } catch (err) {
    console.error('[rebuild-dashboard]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Rebuild/Update Gerald Workspace from GitHub
app.post('/api/rebuild-workspace', requireSetupAuth, async (req, res) => {
  try {
    // Auto-save dev site changes before rebuild
    await autoSaveDevChanges();

    const token = req.body?.token?.trim() || '';
    const result = await setupWorkspace(token);
    res.json({ ok: result.ok, output: result.output });
  } catch (err) {
    console.error('[rebuild-workspace]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Configure workspace repo URL
app.post('/api/config/workspace-repo', requireSetupAuth, async (req, res) => {
  try {
    const { repoUrl } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ ok: false, error: 'repoUrl required' });
    }

    // Read existing config
    const cfgPath = path.join(STATE_DIR, 'illumin8.json');
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {}

    // Update workspace repo
    config.workspaceRepo = repoUrl;
    fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2));

    res.json({ ok: true, message: `Workspace repo set to ${repoUrl}` });
  } catch (err) {
    console.error('[config/workspace-repo]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Get workspace repo config
app.get('/api/config/workspace-repo', requireSetupAuth, (req, res) => {
  try {
    const cfgPath = path.join(STATE_DIR, 'illumin8.json');
    let config = {};
    try {
      config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    } catch (e) {}

    res.json({ 
      ok: true, 
      repoUrl: config.workspaceRepo || 'https://github.com/illumin8ca/gerald',
      isDefault: !config.workspaceRepo
    });
  } catch (err) {
    console.error('[config/workspace-repo]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Manual SendGrid domain verification endpoint
app.post('/api/verify-sendgrid-domain', requireSetupAuth, async (req, res) => {
  try {
    // Read config from saved files
    const sendgridConfigPath = path.join(STATE_DIR, 'sendgrid.json');
    const illumin8ConfigPath = path.join(STATE_DIR, 'illumin8.json');

    if (!fs.existsSync(sendgridConfigPath)) {
      return res.status(400).json({ ok: false, error: 'SendGrid not configured. Run setup first.' });
    }

    if (!fs.existsSync(illumin8ConfigPath)) {
      return res.status(400).json({ ok: false, error: 'Client domain not configured. Run setup first.' });
    }

    const sendgridConfig = JSON.parse(fs.readFileSync(sendgridConfigPath, 'utf8'));
    const illumin8Config = JSON.parse(fs.readFileSync(illumin8ConfigPath, 'utf8'));

    const domain = illumin8Config.clientDomain;
    const apiKey = sendgridConfig.apiKey;

    if (!domain || !apiKey) {
      return res.status(400).json({ ok: false, error: 'Missing domain or API key in configuration.' });
    }

    const result = await setupSendGridDomainAuth(domain, apiKey);

    res.json({
      ok: result.ok,
      validated: result.validated,
      output: result.output,
    });
  } catch (err) {
    console.error('[verify-sendgrid-domain]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Webhook for GitHub push events (auto-rebuild)
app.post('/api/webhook/github', express.json(), async (req, res) => {
  try {
    const githubConfigPath = path.join(STATE_DIR, 'github.json');
    if (!fs.existsSync(githubConfigPath)) {
      return res.status(200).json({ ok: true, skipped: true, reason: 'Not configured' });
    }

    const githubConfig = JSON.parse(fs.readFileSync(githubConfigPath, 'utf8'));
    const ref = req.body?.ref || '';
    const branch = ref.replace('refs/heads/', '');

    console.log(`[webhook] GitHub push to branch: ${branch}`);

    const repoUrl = `https://github.com/${githubConfig.repo}`;
    const token = getGitHubToken();

    if (branch === githubConfig.prodBranch) {
      console.log(`[webhook] Rebuilding production...`);
      const result = await cloneAndBuild(repoUrl, branch, PRODUCTION_DIR, token);
      return res.json({ ok: true, target: 'production', output: result.output });
    }

    if (branch === githubConfig.devBranch) {
      console.log(`[webhook] Updating dev server...`);
      const result = await pullDevBranch();
      // Restart dev server if it was running, or start it
      if (getDevServerProcess()) {
        await restartDevServer();
      } else {
        await startDevServer();
      }
      return res.json({ ok: true, target: 'dev', output: result.output });
    }

    res.json({ ok: true, skipped: true, reason: `Branch ${branch} not tracked` });
  } catch (err) {
    console.error('[webhook]', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

app.get("/setup/export", requireSetupAuth, async (_req, res) => {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  res.setHeader("content-type", "application/gzip");
  res.setHeader(
    "content-disposition",
    `attachment; filename="openclaw-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz"`,
  );

  // Prefer exporting from a common /data root so archives are easy to inspect and restore.
  // This preserves dotfiles like /data/.openclaw/openclaw.json.
  const stateAbs = path.resolve(STATE_DIR);
  const workspaceAbs = path.resolve(WORKSPACE_DIR);

  const dataRoot = "/data";
  const underData = (p) => p === dataRoot || p.startsWith(dataRoot + path.sep);

  let cwd = "/";
  let paths = [stateAbs, workspaceAbs].map((p) => p.replace(/^\//, ""));

  if (underData(stateAbs) && underData(workspaceAbs)) {
    cwd = dataRoot;
    // We export relative to /data so the archive contains: .openclaw/... and workspace/...
    paths = [
      path.relative(dataRoot, stateAbs) || ".",
      path.relative(dataRoot, workspaceAbs) || ".",
    ];
  }

  const stream = tar.c(
    {
      gzip: true,
      portable: true,
      noMtime: true,
      cwd,
      onwarn: () => {},
    },
    paths,
  );

  stream.on("error", (err) => {
    console.error("[export]", err);
    if (!res.headersSent) res.status(500);
    res.end(String(err));
  });

  stream.pipe(res);
});

// Proxy everything else to the gateway.
const proxy = httpProxy.createProxyServer({
  target: GATEWAY_TARGET,
  ws: true,
  xfwd: true,
  // Critical for streaming: don't buffer responses, pipe them immediately
  changeOrigin: true,
  // Increase timeout for long-running streaming responses (AI chat)
  timeout: 300000,      // 5 minutes for initial connection
  proxyTimeout: 300000, // 5 minutes for proxy response
});

proxy.on("error", (err, req, res) => {
  console.error("[proxy]", err.code || err.message);
  if (res && !res.headersSent && typeof res.writeHead === 'function') {
    res.writeHead(503, { 'Content-Type': 'text/html' });
    res.end('<html><body style="background:#0a0a0f;color:#94a3b8;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2 style="color:#00ff87">Gerald is starting up...</h2><p>Please refresh in a few seconds.</p></div></body></html>');
  }
});

// Keep-alive for streaming connections
proxy.on('proxyRes', (proxyRes, req, res) => {
  // Disable buffering for SSE/streaming responses
  const contentType = proxyRes.headers['content-type'] || '';
  const isStreaming = contentType.includes('text/event-stream') ||
                      contentType.includes('application/octet-stream') ||
                      req.headers['accept']?.includes('text/event-stream');

  if (isStreaming) {
    // Ensure connection stays alive
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering if present

    // Log streaming connection
    console.log(`[proxy] Streaming response started: ${req.url}`);

    // Handle client disconnect
    req.on('close', () => {
      console.log(`[proxy] Client disconnected from stream: ${req.url}`);
    });
  }
});

// Log proxy timeout errors specifically
proxy.on('econnreset', (err, req, res) => {
  console.error('[proxy] Connection reset error:', err.message);
});

proxy.on('timeout', (req, res) => {
  console.error('[proxy] Timeout error on:', req.url);
});

// Inject auth token into HTTP proxy requests - only for gateway, not Dashboard
proxy.on("proxyReq", (proxyReq, req, res) => {
  if (req._proxyTarget === 'dashboard') {
    // Don't inject gateway token - Dashboard handles its own auth via cookies/JWT
  } else {
    console.log(`[proxy] HTTP ${req.method} ${req.url} - injecting token: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}...`);
    proxyReq.setHeader("Authorization", `Bearer ${OPENCLAW_GATEWAY_TOKEN}`);
  }

  // Re-inject body consumed by express.json() so http-proxy can forward it.
  // Without this, POST/PUT/PATCH requests hang because the stream is already drained.
  if (req.body && Object.keys(req.body).length > 0) {
    const bodyData = JSON.stringify(req.body);
    proxyReq.setHeader('Content-Type', 'application/json');
    proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyData));
    proxyReq.write(bodyData);
  }
});

// Inject X-Robots-Tag and meta tag into dev server responses
proxy.on("proxyRes", (proxyRes, req, res) => {
  // Only for dev-server target (set in routing middleware)
  if (req._proxyTarget === 'dev-server') {
    // Set X-Robots-Tag header on all proxied responses
    proxyRes.headers['x-robots-tag'] = 'noindex, nofollow';

    // Inject meta tag into HTML responses
    const contentType = proxyRes.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      const _write = res.write;
      const _end = res.end;
      const chunks = [];

      res.write = function(chunk, ...args) {
        chunks.push(Buffer.from(chunk));
        return true;
      };

      res.end = function(chunk, ...args) {
        if (chunk) {
          chunks.push(Buffer.from(chunk));
        }

        let body = Buffer.concat(chunks).toString('utf8');

        // Inject noindex meta tag if not already present
        if (!body.includes('name="robots"') && body.includes('<head>')) {
          body = body.replace(
            '<head>',
            '<head>\n  <meta name="robots" content="noindex, nofollow">'
          );
        }

        // Update Content-Length
        delete proxyRes.headers['content-length'];
        res.setHeader('Content-Length', Buffer.byteLength(body));

        res.write = _write;
        res.end = _end;
        res.end(body);
      };
    }
  }
});

// Log WebSocket upgrade proxy events (token is injected via headers option in server.on("upgrade"))
proxy.on("proxyReqWs", (proxyReq, req, socket, options, head) => {
  console.log(`[proxy-event] WebSocket proxyReqWs event fired for ${req.url}`);
  console.log(`[proxy-event] Headers:`, JSON.stringify(proxyReq.getHeaders()));
});

app.use(async (req, res, next) => {
  // If not configured, force users to /setup for any non-setup routes.
  if (!isConfigured() && !req.path.startsWith("/setup")) {
    return res.redirect("/setup");
  }

  // ── Illumin8 host-based routing ─────────────────────────────────────
  const clientDomain = getClientDomain();
  if (clientDomain) {
    const host = req.hostname?.toLowerCase();

    // Allow certain endpoints through on any domain (before subdomain routing)
    if (req.path === '/api/webhook/github' || req.path === '/api/rebuild' || req.path === '/status') {
      return next();
    }

    // Production site: clientdomain.com or www.clientdomain.com
    if (host === clientDomain || host === `www.${clientDomain}`) {
      // Serve llms.txt - tells LLMs what the site is about
      if (req.path === '/llms.txt') {
        res.type('text/plain; charset=utf-8');
        return res.send(`# Cass & Kathryn Morrow - Marriage Coaching

> Marriage coaching for men and women in crisis. We've helped 5,600+ couples save their marriages through The Marriage Reset (for men) and The White Picket Fence Project (for women). We specialize in sexless marriages, constant conflict, and emotional disconnection—even when only one spouse is willing to do the work.

Cass & Kathryn survived extreme marital crisis (abuse, 7 separations, restraining order, 2 divorce lawyers) and created a proven methodology that transforms marriages at the identity level—not through communication tips, but through deep personal transformation. Their programs have a 23% acceptance rate (selective, high-commitment only).

## Programs

- [The Marriage Reset](/men): For men ready to lead - Transform yourself at the identity level and become the man she can't help but respect and desire
- [The White Picket Fence Project](/women): For women ready to transform - Stop exhausting yourself, reclaim your identity, and require the partnership you deserve
- [Free Training](/free-training): High-level training covering automatic turn-offs, why marriages fail, and real conflict resolution examples

## Resources

- [Success Stories](/#success-stories): Real transformations from couples on the brink of divorce
- [FAQ](/#faq): Common questions about saving marriages, sexless relationships, and the coaching process

## Contact

- Website: https://cassandkathryn.com
- Services: Marriage coaching for men and women (separate programs)
- Specialty: Sexless marriages, conflict resolution, one-spouse transformation
- Results: 6-12 months typical transformation timeframe
`);
      }

      // Serve llms-full.txt - extended version with more details
      if (req.path === '/llms-full.txt') {
        res.type('text/plain; charset=utf-8');
        return res.send(`# Cass & Kathryn Morrow - Marriage Coaching (Full Documentation)

> Marriage coaching for men and women in crisis. We've helped 5,600+ couples save their marriages through The Marriage Reset (for men) and The White Picket Fence Project (for women). We specialize in sexless marriages, constant conflict, and emotional disconnection—even when only one spouse is willing to do the work.

## About Cass & Kathryn

Cass and Kathryn Morrow are marriage coaches who survived extreme marital crisis to build a thriving relationship and now help others do the same. Their background includes:

- Emotional, physical, and sexual abuse
- Restraining order
- 7 separations
- 2 divorce lawyers
- 1 year of probation

From this foundation, they created a unique coaching methodology that has helped 5,600+ marriages transform. Their approach is different from traditional marriage counseling:

**Key Differentiators:**
- Focus on identity transformation, not communication techniques
- Only ONE spouse needs to participate (though both benefit)
- Addresses the root cause of marital breakdown, not just symptoms
- Selective acceptance (23% acceptance rate) - only works with committed individuals
- Results-driven: most couples see transformation in 6-12 months

## Programs & Services

### The Marriage Reset (For Men)

**Target Audience:** Men whose wives have checked out, stopped having sex, or mentioned divorce

**Core Premise:** Stop waiting for your wife to change. Become the man she can't help but respect and desire through identity-level transformation.

**What It's Not:**
- Not communication tips or date night advice
- Not manipulation tactics
- Not "happy wife, happy life" people-pleasing

**What It Is:**
- Deep work on who you are as a man, leader, and husband
- Learning to lead with strength and presence
- Becoming someone your wife naturally responds to (not because you manipulated, but because you're undeniable)

**Results:**
- Men report their wives initiating intimacy again after years of rejection
- Nasty fights transform into peaceful connection
- Wives who were "done" suddenly re-engage

### The White Picket Fence Project (For Women)

**Target Audience:** Women exhausting themselves trying to hold their marriage together

**Core Premise:** Stop enabling bad behavior and reclaim your identity. Become the woman who creates transformation—with or without his participation.

**Key Concepts:**
- Set boundaries and stop doing all the emotional labor
- Require the partnership you deserve
- Transform yourself (which often transforms the marriage)
- Take your power back

**What It Addresses:**
- Women who feel like roommates, not partners
- Constant fighting and defensiveness
- Carrying all the mental/emotional load
- Husbands who have checked out or won't participate in counseling

### Free Training

High-level training available without commitment. Covers:

- **Automatic Turn-Offs:** From conversations to intimacy—what's killing attraction without you realizing it
- **Why This Is Happening:** The real reason marriages die (not what traditional counseling says)
- **Secret Recording:** Live training from Cass & Kathryn showing real conflict resolution

## Common Situations They Address

### Sexless Marriage
- It's been months or years since intimacy
- When sex happens, it feels like a chore
- Your spouse isn't "just not sexual"—they're not having sex with YOU because they don't feel safe/respected/desired

**Their Approach:** Transform who you are → intimacy returns as genuine desire, not transaction

### You're Roommates, Not Partners
- Co-parent, split bills, sleep in the same bed
- No connection, no spark
- Parallel lives

**Their Approach:** Identity transformation creates natural attraction and connection

### Constant Fighting
- Every conversation becomes conflict
- Always defending yourself
- Nastiness that never stops

**Their Approach:** Learn to lead/set boundaries from a place of strength, not reactivity

### Spouse Has Checked Out
- They've mentioned divorce
- Emotionally gone
- May be seeing someone else

**Their Approach:** Transform yourself to become undeniable (they respond to who you are, not what you say)

### Traditional Therapy Failed
- Tried therapy, books, date nights, love languages
- Nothing worked

**Why Their Approach Works:** Addresses identity, not surface-level behaviors

## Philosophy & Methodology

**Core Belief:** You can't fix a marriage by working on the marriage. You fix it by becoming a different person. When you change, the marriage changes with you.

**Why Only One Spouse Needs to Participate:**
- Most couples start with only one person willing to work
- When you transform at the identity level—who you are, how you show up, how you lead—your spouse responds
- Not because you manipulated them, but because you became someone they can't help but respond to
- You don't need their permission to become undeniable

**Selective Acceptance (23% Rate):**
- Only work with people serious about transformation
- Not looking for quick fixes or victim validation
- Committed to doing the deep work
- If accepted, you're in a room with people who refuse to settle

## Results & Timeframe

**Typical Transformation:** 6-12 months for significant results

**Early Indicators:** Some men notice shifts in their wives within WEEKS

**Success Metrics:**
- 5,600+ marriages saved
- Couples who were filing for divorce ripping up papers
- Women initiating intimacy after 7+ years of rejection
- Nasty conflicts transforming into peaceful connection
- Emotional disconnection becoming genuine partnership

## Featured In

Media coverage includes:
- Maxim
- Forbes Brunei
- Los Angeles Magazine
- LA Weekly
- Multiple podcast interviews (Chris Voss Show, DreamCatchers, The Success Mindset Show)

## Who This Is NOT For

- People looking for quick fixes
- Those wanting someone to validate their victim story
- Anyone not willing to do deep personal work
- People who want their spouse to change but won't change themselves

## Contact & Next Steps

- **Website:** https://cassandkathryn.com
- **For Men:** https://cassandkathryn.com/men (The Marriage Reset)
- **For Women:** https://cassandkathryn.com/women (The White Picket Fence Project)
- **Free Training:** https://cassandkathryn.com/free-training
- **Not Sure?** Start with the free training to understand the approach

## FAQ Highlights

**Q: Can I save my marriage if my spouse has given up?**
A: Yes. Most of the 5,600+ couples started with only ONE person willing to work. When you transform at the identity level, your spouse responds.

**Q: How is this different from marriage counseling?**
A: Traditional counseling focuses on communication techniques and requires both spouses. We focus on IDENTITY transformation. You can't fix a marriage by working on the marriage—you fix it by becoming a different person.

**Q: What if we haven't had sex in years?**
A: Sexless marriages are our specialty. Your spouse isn't "just not a sexual person." They're not having sex with you because they don't feel safe, respected, or desired. Transform who you are → intimacy returns as genuine desire.

**Q: How long does it take?**
A: Most couples see significant transformation within 6-12 months. Some notice shifts within WEEKS. Depends on commitment and depth of damage.

**Q: Why only 23% acceptance rate?**
A: We're selective because transformation requires commitment. We only work with people serious about deep work—not looking for quick fixes or victim validation.
`);
      }

      // For SSR sites, proxy to the production SSR server
      const isSSR = isProdSSR();
      const hasProcess = !!getProdServerProcess();
      console.log(`[routing] Production request: isSSR=${isSSR}, hasProcess=${hasProcess}, target=${PROD_SERVER_TARGET}`);
      if (isSSR && hasProcess) {
        console.log(`[routing] Proxying to prod-server at ${PROD_SERVER_TARGET}`);
        req._proxyTarget = 'prod-server';
        return proxy.web(req, res, { target: PROD_SERVER_TARGET });
      }
      // For static sites (or SSR fallback), serve static files
      console.log(`[routing] Falling back to static: PRODUCTION_DIR=${PRODUCTION_DIR}`);
      return serveStaticSite(PRODUCTION_DIR, req, res);
    }

    // Dev site: dev.clientdomain.com → live dev server (or static fallback)
    if (host === `dev.${clientDomain}`) {
      // Serve robots.txt that blocks all crawlers
      if (req.path === '/robots.txt') {
        res.set('X-Robots-Tag', 'noindex, nofollow');
        res.type('text/plain');
        return res.send('User-agent: *\nDisallow: /\nNoindex: /');
      }

      // Set X-Robots-Tag header on all dev subdomain responses
      res.set('X-Robots-Tag', 'noindex, nofollow');

      if (getDevServerProcess()) {
        req._proxyTarget = 'dev-server'; // skip gateway token injection, enable meta tag injection
        return proxy.web(req, res, { target: DEV_SERVER_TARGET });
      }
      // Fallback to static files if dev server isn't running
      // Check for dist folder first (source code kept, build output in dist/)
      const devDistDir = path.join(DEV_DIR, 'dist');
      const devStaticDir = fs.existsSync(devDistDir) ? devDistDir : DEV_DIR;
      console.log(`[dev-routing] Serving static from: ${devStaticDir}`);
      console.log(`[dev-routing] dist exists: ${fs.existsSync(devDistDir)}, DEV_DIR exists: ${fs.existsSync(DEV_DIR)}`);
      if (fs.existsSync(devStaticDir)) {
        const files = fs.readdirSync(devStaticDir).slice(0, 10);
        console.log(`[dev-routing] Files in ${devStaticDir}: ${files.join(', ')}`);
      }
      return serveStaticSite(devStaticDir, req, res);
    }

    // Gerald dashboard: gerald.clientdomain.com → Dashboard (transparent proxy)
    if (host === `gerald.${clientDomain}`) {
      if (req.path.startsWith('/openclaw')) {
        // Proxy /openclaw paths to OpenClaw gateway (dashboard API calls)
        if (isConfigured()) {
          try { await ensureGatewayRunning(OPENCLAW_GATEWAY_TOKEN); } catch (err) {
            return res.status(503).type('text/plain').send(`Gateway not ready: ${String(err)}`);
          }
        }
        return proxy.web(req, res, { target: GATEWAY_TARGET });
      }

      // Everything else → Gerald Dashboard (Dashboard handles its own auth)
      req._proxyTarget = 'dashboard';
      return proxy.web(req, res, { target: DASHBOARD_TARGET });
    }

    // All other hosts fall through to proxy (setup, healthz, etc.)
  }

  // ── Existing proxy logic ─────────────────────────────────────────────
  if (isConfigured()) {
    try {
      await ensureGatewayRunning(OPENCLAW_GATEWAY_TOKEN);
    } catch (err) {
      return res
        .status(503)
        .type("text/plain")
        .send(`Gateway not ready: ${String(err)}`);
    }
  }

  // Proxy to gateway (auth token injected via proxyReq event)
  return proxy.web(req, res, { target: GATEWAY_TARGET });
});

// Create HTTP server from Express app
// Ensure tailscale directories exist
fs.mkdirSync('/data/.tailscale', { recursive: true });
fs.mkdirSync('/var/run/tailscale', { recursive: true });

// Start Tailscale before the HTTP server
startTailscale().catch(err => console.error('[tailscale] Startup error:', err));

// Graceful shutdown handlers - save dev site changes before exit
process.on('SIGTERM', async () => {
  console.log('[shutdown] Received SIGTERM, saving dev site changes...');
  await autoSaveDevChanges();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[shutdown] Received SIGINT, saving dev site changes...');
  await autoSaveDevChanges();
  process.exit(0);
});

const server = app.listen(PORT, () => {
  console.log(`[wrapper] ========== SERVER STARTED ==========`);
  console.log(`[wrapper] listening on port ${PORT}`);
  console.log(`[wrapper] setup wizard: http://localhost:${PORT}/setup`);
  console.log(`[wrapper] configured: ${isConfigured()}`);
  console.log(`[wrapper] health check: http://localhost:${PORT}/setup/healthz`);
  console.log(`[wrapper] diagnostic: http://localhost:${PORT}/setup/diagnostic`);

  // CRITICAL: Don't await anything in the listen callback
  // Railway health checks need immediate responses or it returns 503
  
  // Auto-start the gateway in background (don't block server startup)
  if (isConfigured()) {
    console.log(`[wrapper] auto-starting gateway in background...`);
    ensureGatewayRunning(OPENCLAW_GATEWAY_TOKEN)
      .then(() => console.log(`[wrapper] ✓ gateway auto-started successfully`))
      .catch(err => console.error(`[wrapper] ✗ gateway auto-start failed: ${err.message}`));
  } else {
    console.log(`[wrapper] not configured - run /setup to configure`);
  }

  // Start dashboard if installed (background)
  startDashboard(OPENCLAW_GATEWAY_TOKEN)
    .then(() => console.log('[dashboard] ✓ auto-started'))
    .catch(err => console.error('[dashboard] ✗ auto-start failed:', err.message));

  // Start dev server if dev site has been cloned (background)
  if (fs.existsSync(path.join(DEV_DIR, 'package.json'))) {
    startDevServer()
      .then(() => console.log('[dev-server] ✓ auto-started'))
      .catch(err => console.error('[dev-server] ✗ auto-start failed:', err.message));
  }

  // Start production SSR server if site is SSR (background)
  // Delay by 5 seconds to allow any stale processes to fully terminate
  if (isProdSSR()) {
    setTimeout(() => {
      startProdServer()
        .then(() => console.log('[prod-server] ✓ auto-started'))
        .catch(err => console.error('[prod-server] ✗ auto-start failed:', err.message));
    }, 5000);
  }

  console.log(`[wrapper] ========== STARTUP COMPLETE ==========`);
});

// Critical: Increase server timeouts for AI streaming (5 minutes)
// Default Node.js timeouts are too short for long LLM responses
server.timeout = 300000; // 5 minutes
server.keepAliveTimeout = 300000; // 5 minutes
server.headersTimeout = 301000; // Slightly longer than keepAliveTimeout

console.log(`[wrapper] Server timeouts set: timeout=${server.timeout}ms, keepAliveTimeout=${server.keepAliveTimeout}ms`);

// Handle server errors
server.on('error', (err) => {
  console.error('[wrapper] ✗ Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`[wrapper] Port ${PORT} is already in use!`);
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('[wrapper] ✗ Uncaught exception:', err);
  // Don't exit - let Railway restart if needed
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[wrapper] ✗ Unhandled promise rejection:', reason);
  // Don't exit - log and continue
});

// Handle WebSocket upgrades
server.on("upgrade", async (req, socket, head) => {
  if (!isConfigured()) {
    socket.destroy();
    return;
  }

  // Route WebSocket by subdomain
  const clientDomain = getClientDomain();
  const wsHost = req.headers.host?.split(':')[0]?.toLowerCase();

  // Dev subdomain WebSocket → dev server (HMR)
  if (clientDomain && wsHost === `dev.${clientDomain}` && getDevServerProcess()) {
    console.log(`[ws-upgrade] Proxying WebSocket to dev server: ${req.url}`);
    proxy.ws(req, socket, head, { target: DEV_SERVER_TARGET });
    return;
  }

  // Only allow WebSocket for gerald subdomain (or no client domain set)
  if (clientDomain && wsHost !== `gerald.${clientDomain}`) {
    socket.destroy();
    return;
  }

  // Parse the request path for routing
  const wsUrl = new URL(req.url, 'http://localhost');

  if (wsUrl.pathname.startsWith('/openclaw') || wsUrl.pathname === '/') {
    // /openclaw paths OR root path → OpenClaw gateway WebSocket (chat, node connections, etc.)
    try {
      await ensureGatewayRunning(OPENCLAW_GATEWAY_TOKEN);
    } catch {
      socket.destroy();
      return;
    }

    console.log(`[ws-upgrade] Proxying WebSocket to gateway: ${req.url}`);

    // Append token to the URL if not already present
    const url = new URL(req.url, GATEWAY_TARGET);
    if (!url.searchParams.has('token')) {
      url.searchParams.set('token', OPENCLAW_GATEWAY_TOKEN);
    }
    req.url = url.pathname + url.search;

    proxy.ws(req, socket, head, {
      target: GATEWAY_TARGET,
      headers: {
        Authorization: `Bearer ${OPENCLAW_GATEWAY_TOKEN}`,
      },
    });
  } else {
    // All other WebSocket paths → Gerald Dashboard (Dashboard handles its own auth)
    console.log(`[ws-upgrade] Proxying WebSocket to dashboard: ${req.url}`);
    proxy.ws(req, socket, head, {
      target: DASHBOARD_TARGET,
    });
  }
});

// ==============================
// Dashboard API Routes (proxied to Gerald Dashboard - no requireSetupAuth)
// ==============================

// Gerald Dashboard version check
app.get('/api/dashboard/gerald-version', async (req, res) => {
  try {
    // Use DASHBOARD_DIR constant (not hardcoded path)
    let currentCommit = 'unknown';
    let behindBy = 0;

    if (fs.existsSync(DASHBOARD_DIR)) {
      try {
        const { output: commit } = await runCmd('git', ['rev-parse', '--short', 'HEAD'], { cwd: DASHBOARD_DIR });
        currentCommit = commit.trim();

        // Check if behind origin/main
        await runCmd('git', ['fetch', 'origin', 'main'], { cwd: DASHBOARD_DIR });
        const { output: behind } = await runCmd('git', ['rev-list', '--count', 'HEAD..origin/main'], { cwd: DASHBOARD_DIR });
        behindBy = parseInt(behind.trim()) || 0;
      } catch (gitErr) {
        console.log('[gerald-version] git check failed:', gitErr.message);
      }
    }

    res.json({
      currentCommit,
      behindBy,
      canUpdate: behindBy > 0,
      updateAvailable: behindBy > 0,
      source: 'wrapper'
    });
  } catch (err) {
    console.error('[gerald-version] error:', err);
    res.status(500).json({ error: 'Failed to check version' });
  }
});

// Gerald Dashboard update
app.post('/api/dashboard/gerald-update', async (req, res) => {
  try {
    if (!fs.existsSync(DASHBOARD_DIR)) {
      return res.status(400).json({ success: false, error: 'Dashboard not installed' });
    }

    // Pull latest changes
    const { output: pullOutput } = await runCmd('git', ['pull', 'origin', 'main'], { cwd: DASHBOARD_DIR });

    // Rebuild the dashboard (use npm run build for proper dependency resolution)
    await runCmd('npm', ['run', 'build'], { cwd: DASHBOARD_DIR });

    // Restart dashboard process
    if (getDashboardProcess()) {
      await stopDashboard();
      await startDashboard(OPENCLAW_GATEWAY_TOKEN);
    }

    res.json({
      success: true,
      message: `Updated and rebuilt. ${pullOutput}`,
      restarted: true
    });
  } catch (err) {
    console.error('[gerald-update] error:', err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

// System health endpoint
app.get('/api/system/health', async (req, res) => {
  try {
    const status = {
      gateway: getGatewayProc() ? 'running' : 'stopped',
      dashboard: getDashboardProcess() ? 'running' : 'stopped',
      devServer: getDevServerProcess() ? 'running' : 'stopped',
      timestamp: new Date().toISOString()
    };
    res.json(status);
  } catch (err) {
    console.error('[system-health] error:', err);
    res.status(500).json({ error: String(err) });
  }
});

// Health data endpoints (mock data for Railway template)
app.get('/api/health/summary', async (req, res) => {
  res.json({
    today: { step_count: 0, active_energy: 0, sleep_hours: 0, exercise_minutes: 0, stand_hours: 0 },
    goals: { step_count: 10000, active_energy: 500, sleep_hours: 8, exercise_minutes: 30, stand_hours: 12 }
  });
});

app.get('/api/health/history/:metric', async (req, res) => {
  res.json({ metric: req.params.metric, days: parseInt(req.query.days) || 7, data: [] });
});

app.get('/api/health/hourly/:metric', async (req, res) => {
  res.json({ metric: req.params.metric, date: req.query.date, data: [] });
});

app.get('/api/health/vitals', async (req, res) => {
  res.json({ vitals: [] });
});

app.get('/api/health/workouts/today', async (req, res) => {
  res.json({ workouts: [] });
});

// Note: Other Dashboard API routes (/api/health/*) are handled above
// The Dashboard server handles its own JWT authentication

process.on("SIGTERM", () => {
  // Best-effort shutdown
  try {
    if (getGatewayProc()) getGatewayProc()?.kill("SIGTERM");
  } catch {
    // ignore
  }
  try {
    if (getDashboardProcess()) getDashboardProcess()?.kill("SIGTERM");
  } catch {
    // ignore
  }
  try {
    if (getDevServerProcess()) getDevServerProcess().kill("SIGTERM");
  } catch {
    // ignore
  }
  process.exit(0);
});
// Trigger redeploy Mon Feb  9 23:19:00 MST 2026
