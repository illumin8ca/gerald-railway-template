import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  GATEWAY_TARGET,
  INTERNAL_GATEWAY_PORT,
  OPENCLAW_NODE,
  STATE_DIR,
  WORKSPACE_DIR,
} from "./constants.js";
import {
  configPath,
  directConfigSet,
  fixInvalidConfig,
  isConfigured,
} from "./config.js";
import { clawArgs, runCmd, sleep } from "./helpers.js";

let gatewayProc = null;
let gatewayStarting = null;
let lastGatewayToken = null;
let crashCount = 0;
let lastCrashTime = 0;
const MAX_CRASH_RESTARTS = 5;
const CRASH_WINDOW_MS = 300_000; // 5 minutes

export function getGatewayProc() {
  return gatewayProc;
}

export function isGatewayStarting() {
  return !!gatewayStarting;
}

export async function waitForGatewayReady(opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const start = Date.now();
  const endpoints = ["/openclaw", "/openclaw", "/", "/health"];

  while (Date.now() - start < timeoutMs) {
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(`${GATEWAY_TARGET}${endpoint}`, {
          method: "GET",
        });
        if (res) {
          console.log(`[gateway] ready at ${endpoint}`);
          return true;
        }
      } catch (err) {
        // not ready
      }
    }
    await sleep(250);
  }
  console.error(`[gateway] failed to become ready after ${timeoutMs}ms`);
  return false;
}

export async function startGateway(OPENCLAW_GATEWAY_TOKEN) {
  if (gatewayProc) return;
  if (!isConfigured()) throw new Error("Gateway cannot start: not configured");

  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

  fixInvalidConfig();

  console.log(`[gateway] ========== GATEWAY START CONFIG SYNC ==========`);
  console.log(
    `[gateway] Syncing wrapper token to config: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`,
  );

  // gateway.mode=local is required or the gateway refuses to start
  await runCmd(
    OPENCLAW_NODE,
    clawArgs(["config", "set", "gateway.mode", "local"]),
  );

  const syncResult = await runCmd(
    OPENCLAW_NODE,
    clawArgs([
      "config",
      "set",
      "gateway.auth.token",
      OPENCLAW_GATEWAY_TOKEN,
    ]),
  );

  await runCmd(
    OPENCLAW_NODE,
    clawArgs([
      "config",
      "set",
      "gateway.http.endpoints.chatCompletions.enabled",
      "true",
    ]),
  );

  // Apply all gateway settings that onboarding sets (for restart consistency)
  await runCmd(
    OPENCLAW_NODE,
    clawArgs(["config", "set", "gateway.auth.mode", "token"]),
  );
  await runCmd(
    OPENCLAW_NODE,
    clawArgs(["config", "set", "gateway.bind", "loopback"]),
  );
  await runCmd(
    OPENCLAW_NODE,
    clawArgs(["config", "set", "gateway.port", String(INTERNAL_GATEWAY_PORT)]),
  );
  await runCmd(
    OPENCLAW_NODE,
    clawArgs(["config", "set", "gateway.controlUi.enabled", "false"]),
  );
  await runCmd(
    OPENCLAW_NODE,
    clawArgs([
      "config",
      "set",
      "--json",
      "gateway.trustedProxies",
      '["127.0.0.1/8","::1/128","100.64.0.0/10","172.16.0.0/12"]',
    ]),
  );

  const envModel = process.env.DEFAULT_MODEL?.trim();
  if (envModel) {
    await runCmd(
      OPENCLAW_NODE,
      clawArgs([
        "config",
        "set",
        "agents.defaults.model.primary",
        envModel,
      ]),
    );
    console.log(`[gateway] Model synced: ${envModel}`);
  }

  const anthropicToken = process.env.ANTHROPIC_SETUP_TOKEN?.trim();
  if (anthropicToken) {
    const agentDir = path.join(STATE_DIR, "agents", "main", "agent");
    const authStorePath = path.join(agentDir, "auth-profiles.json");
    try {
      fs.mkdirSync(agentDir, { recursive: true });
      let store = {
        version: 1,
        profiles: {},
        order: [],
        lastGood: {},
        usageStats: {},
      };
      if (fs.existsSync(authStorePath)) {
        try {
          store = JSON.parse(fs.readFileSync(authStorePath, "utf8"));
        } catch {}
      }
      const profileId = "anthropic:default";
      store.profiles[profileId] = {
        credential: {
          type: "token",
          provider: "anthropic",
          token: anthropicToken,
        },
      };
      if (!store.order?.includes(profileId)) {
        store.order = store.order || [];
        store.order.unshift(profileId);
      }
      store.lastGood = store.lastGood || {};
      store.lastGood.anthropic = profileId;
      fs.writeFileSync(authStorePath, JSON.stringify(store, null, 2), {
        mode: 0o600,
      });
      console.log(
        `[gateway] Anthropic token synced from ANTHROPIC_SETUP_TOKEN env`,
      );

      await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "auth.profiles.anthropic:default.provider",
          "anthropic",
        ]),
      );
      await runCmd(
        OPENCLAW_NODE,
        clawArgs([
          "config",
          "set",
          "auth.profiles.anthropic:default.mode",
          "token",
        ]),
      );
    } catch (err) {
      console.error(
        `[gateway] Failed to sync Anthropic token: ${err.message}`,
      );
    }
  }

  console.log(`[gateway] Sync result: exit code ${syncResult.code}`);
  if (syncResult.output?.trim()) {
    console.log(`[gateway] Sync output: ${syncResult.output}`);
  }

  if (syncResult.code !== 0) {
    console.error(
      `[gateway] WARNING: Token sync failed with code ${syncResult.code}`,
    );
    console.log(`[gateway] Falling back to direct JSON write for token...`);
    try {
      directConfigSet("gateway.mode", "local");
      directConfigSet("gateway.auth.token", OPENCLAW_GATEWAY_TOKEN);
      console.log(`[gateway] Token + mode written directly to config JSON`);
    } catch (err) {
      console.error(`[gateway] Direct write also failed: ${err.message}`);
    }
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const configToken = config?.gateway?.auth?.token;

    console.log(`[gateway] Token verification:`);
    console.log(
      `[gateway]   Wrapper: ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... (len: ${OPENCLAW_GATEWAY_TOKEN.length})`,
    );
    console.log(
      `[gateway]   Config:  ${configToken?.slice(0, 16)}... (len: ${configToken?.length || 0})`,
    );

    if (configToken !== OPENCLAW_GATEWAY_TOKEN) {
      console.error(`[gateway] Token mismatch detected!`);
      console.error(`[gateway]   Full wrapper: ${OPENCLAW_GATEWAY_TOKEN}`);
      console.error(`[gateway]   Full config:  ${configToken || "null"}`);
      throw new Error(
        `Token mismatch: wrapper has ${OPENCLAW_GATEWAY_TOKEN.slice(0, 16)}... but config has ${(configToken || "null")?.slice?.(0, 16)}...`,
      );
    }
    console.log(`[gateway] Token verification PASSED`);
  } catch (err) {
    console.error(`[gateway] ERROR: Token verification failed: ${err}`);
    throw err;
  }

  console.log(`[gateway] ========== TOKEN SYNC COMPLETE ==========`);

  const args = [
    "gateway",
    "run",
    "--bind",
    "loopback",
    "--port",
    String(INTERNAL_GATEWAY_PORT),
    "--auth",
    "token",
    "--token",
    OPENCLAW_GATEWAY_TOKEN,
  ];

  gatewayProc = childProcess.spawn(OPENCLAW_NODE, clawArgs(args), {
    stdio: "inherit",
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: STATE_DIR,
      OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
    },
  });

  console.log(
    `[gateway] starting with command: ${OPENCLAW_NODE} ${clawArgs(args).join(" ")}`,
  );
  console.log(`[gateway] STATE_DIR: ${STATE_DIR}`);
  console.log(`[gateway] WORKSPACE_DIR: ${WORKSPACE_DIR}`);
  console.log(`[gateway] config path: ${configPath()}`);

  gatewayProc.on("error", (err) => {
    console.error(`[gateway] spawn error: ${String(err)}`);
    gatewayProc = null;
  });

  // Store token for auto-restart
  lastGatewayToken = OPENCLAW_GATEWAY_TOKEN;

  gatewayProc.on("exit", (code, signal) => {
    console.error(`[gateway] exited code=${code} signal=${signal}`);
    gatewayProc = null;

    // Auto-restart on unexpected crash (not SIGTERM/SIGINT = intentional stop)
    if (signal !== 'SIGTERM' && signal !== 'SIGINT' && code !== 0 && lastGatewayToken) {
      const now = Date.now();
      if (now - lastCrashTime > CRASH_WINDOW_MS) {
        crashCount = 0; // Reset crash counter outside window
      }
      lastCrashTime = now;
      crashCount++;

      if (crashCount <= MAX_CRASH_RESTARTS) {
        const delayMs = Math.min(2000 * Math.pow(2, crashCount - 1), 30000);
        console.log(`[gateway] Auto-restart in ${delayMs}ms (crash ${crashCount}/${MAX_CRASH_RESTARTS})`);
        setTimeout(async () => {
          try {
            console.log(`[gateway] Auto-restarting after crash...`);
            await startGateway(lastGatewayToken);
          } catch (err) {
            console.error(`[gateway] Auto-restart failed: ${err.message}`);
          }
        }, delayMs);
      } else {
        console.error(`[gateway] Too many crashes (${crashCount}) in ${CRASH_WINDOW_MS / 1000}s — not restarting. Use /setup/api/config/repair or /setup/api/gateway/restart to recover.`);
      }
    }
  });
}

export async function ensureGatewayRunning(OPENCLAW_GATEWAY_TOKEN) {
  if (!isConfigured()) return { ok: false, reason: "not configured" };
  if (gatewayProc) return { ok: true };
  if (!gatewayStarting) {
    gatewayStarting = (async () => {
      await startGateway(OPENCLAW_GATEWAY_TOKEN);
      const ready = await waitForGatewayReady({ timeoutMs: 300_000 });
      if (!ready) {
        throw new Error(
          "Gateway did not become ready in time (5 min timeout)",
        );
      }
    })().finally(() => {
      gatewayStarting = null;
    });
  }
  await gatewayStarting;
  return { ok: true };
}

export async function restartGateway(OPENCLAW_GATEWAY_TOKEN) {
  console.log("[gateway] Restarting gateway...");

  if (gatewayProc) {
    console.log("[gateway] Killing wrapper-managed gateway process");
    try {
      gatewayProc.kill("SIGTERM");
    } catch {}
    gatewayProc = null;
  }

  console.log(
    `[gateway] Killing any other gateway processes on port ${INTERNAL_GATEWAY_PORT}`,
  );
  try {
    const killResult = await runCmd("pkill", ["-f", "openclaw-gateway"]);
    console.log(`[gateway] pkill result: exit code ${killResult.code}`);
  } catch (err) {
    console.log(`[gateway] pkill failed: ${err.message}`);
  }

  await sleep(1500);

  return ensureGatewayRunning(OPENCLAW_GATEWAY_TOKEN);
}

export function buildOnboardArgs(payload, OPENCLAW_GATEWAY_TOKEN) {
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--json",
    "--no-install-daemon",
    "--skip-health",
    "--workspace",
    WORKSPACE_DIR,
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(INTERNAL_GATEWAY_PORT),
    "--gateway-auth",
    "token",
    "--gateway-token",
    OPENCLAW_GATEWAY_TOKEN,
    "--flow",
    payload.flow || "quickstart",
  ];

  if (payload.authChoice) {
    args.push("--auth-choice", payload.authChoice);

    let secret = (payload.authSecret || "").trim();
    if (
      !secret &&
      payload.authChoice === "moonshot-api-key" &&
      process.env.MOONSHOT_API_KEY?.trim()
    ) {
      secret = process.env.MOONSHOT_API_KEY.trim();
    }
    const map = {
      "openai-api-key": "--openai-api-key",
      apiKey: "--anthropic-api-key",
      "openrouter-api-key": "--openrouter-api-key",
      "ai-gateway-api-key": "--ai-gateway-api-key",
      "moonshot-api-key": "--moonshot-api-key",
      "kimi-code-api-key": "--kimi-code-api-key",
      "gemini-api-key": "--gemini-api-key",
      "zai-api-key": "--zai-api-key",
      "minimax-api": "--minimax-api-key",
      "minimax-api-lightning": "--minimax-api-key",
      "synthetic-api-key": "--synthetic-api-key",
      "opencode-zen": "--opencode-zen-api-key",
    };
    const flag = map[payload.authChoice];
    if (flag && secret) {
      args.push(flag, secret);
    }

    if (payload.authChoice === "token" && secret) {
      args.push("--token-provider", "anthropic", "--token", secret);
    }
  }

  return args;
}
