import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DASHBOARD_DIR,
  DASHBOARD_PORT,
  GATEWAY_TARGET,
  INTERNAL_API_KEY,
  STATE_DIR,
  WORKSPACE_DIR,
} from "./constants.js";
import { configPath, getClientDomain } from "./config.js";
import { runCmd, safeRemoveDir } from "./helpers.js";
import { getGitHubToken } from "./github.js";

let dashboardProcess = null;
let dashboardStarting = null;
let dashboardStopping = null;

export function getDashboardProcess() {
  return dashboardProcess;
}

export function isDashboardStarting() {
  return !!dashboardStarting;
}

export function isDashboardStopping() {
  return !!dashboardStopping;
}

export async function stopDashboard() {
  if (!dashboardProcess) return;
  if (dashboardStopping) {
    console.log("[dashboard] Stop already in progress, waiting...");
    await dashboardStopping;
    return;
  }

  dashboardStopping = (async () => {
    const proc = dashboardProcess;
    dashboardProcess = null; // Clear immediately to avoid race
    try {
      proc.kill("SIGTERM");
    } catch {}
    // Wait for process to actually exit (port release), with timeout
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      proc.on("close", () => { clearTimeout(timeout); resolve(); });
    });
  })();

  try {
    await dashboardStopping;
  } finally {
    dashboardStopping = null;
  }
}

export async function setupDashboard(token) {
  if (!token) {
    token = getGitHubToken();
  }

  const dashboardRepo = "https://github.com/illumin8ca/gerald-dashboard";
  const authUrl = token
    ? dashboardRepo.replace("https://", `https://x-access-token:${token}@`)
    : dashboardRepo;

  if (!fs.existsSync(path.join(DASHBOARD_DIR, "package.json"))) {
    console.log("[dashboard] Cloning Gerald Dashboard...");
    await safeRemoveDir(DASHBOARD_DIR);
    fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
    const clone = await runCmd("git", [
      "clone",
      "--depth",
      "1",
      authUrl,
      DASHBOARD_DIR,
    ]);
    if (clone.code !== 0) {
      console.error("[dashboard] Clone failed:", clone.output);
      return { ok: false, output: clone.output };
    }
  } else {
    console.log("[dashboard] Updating Gerald Dashboard...");
    await runCmd("git", ["remote", "set-url", "origin", authUrl], {
      cwd: DASHBOARD_DIR,
    });
    const pull = await runCmd("git", ["pull", "--ff-only", "origin", "main"], {
      cwd: DASHBOARD_DIR,
    });
    if (pull.code !== 0) {
      console.log("[dashboard] Pull failed, doing fresh clone...");
      await safeRemoveDir(DASHBOARD_DIR);
      fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
      const clone = await runCmd("git", [
        "clone",
        "--depth",
        "1",
        authUrl,
        DASHBOARD_DIR,
      ]);
      if (clone.code !== 0) {
        console.error("[dashboard] Fresh clone failed:", clone.output);
        return { ok: false, output: clone.output };
      }
    } else {
      console.log("[dashboard] Updated:", pull.output.split("\n")[0]);
    }
  }

  console.log("[dashboard] Installing dependencies...");
  const install = await runCmd("npm", ["install", "--production=false"], {
    cwd: DASHBOARD_DIR,
  });
  if (install.code !== 0) {
    console.error("[dashboard] Install failed:", install.output);
    return { ok: false, output: install.output };
  }

  console.log("[dashboard] Building frontend...");
  const build = await runCmd("npm", ["run", "build"], { cwd: DASHBOARD_DIR });
  if (build.code !== 0) {
    console.error("[dashboard] Build failed:", build.output);
    return { ok: false, output: build.output };
  }

  return { ok: true, output: "Dashboard installed and built" };
}

export async function setupWorkspace(token) {
  if (!token) {
    token = getGitHubToken();
    console.log(
      "[workspace] Token lookup result:",
      token ? "found" : "NOT FOUND",
    );
    if (!token) {
      console.log("[workspace] Checked locations:");
      console.log(
        "  -",
        path.join(STATE_DIR, "github-oauth.json"),
        fs.existsSync(path.join(STATE_DIR, "github-oauth.json")),
      );
      console.log(
        "  -",
        path.join(os.homedir(), ".openclaw", "github-oauth.json"),
        fs.existsSync(
          path.join(os.homedir(), ".openclaw", "github-oauth.json"),
        ),
      );
    }
  }

  const workspaceRepo = "https://github.com/illumin8ca/gerald";
  const authUrl = token
    ? workspaceRepo.replace("https://", `https://x-access-token:${token}@`)
    : workspaceRepo;

  const hasGitRepo = fs.existsSync(path.join(WORKSPACE_DIR, ".git"));

  if (!hasGitRepo) {
    console.log(
      `[workspace] Gerald workspace not found. Cloning from ${workspaceRepo}...`,
    );
    console.log(`[workspace] Target directory: ${WORKSPACE_DIR}`);
    console.log(
      `[workspace] Token available: ${token ? "YES" : "NO (public repo clone will fail if private)"}`,
    );

    fs.mkdirSync(path.dirname(WORKSPACE_DIR), { recursive: true });

    if (fs.existsSync(WORKSPACE_DIR)) {
      console.log("[workspace] Removing incomplete workspace directory...");
      await safeRemoveDir(WORKSPACE_DIR);
    }

    console.log("[workspace] Running git clone...");
    const clone = await runCmd("git", [
      "clone",
      "--depth",
      "1",
      authUrl,
      WORKSPACE_DIR,
    ]);

    if (clone.code !== 0) {
      console.error("[workspace] Clone failed:", clone.output);
      console.error(
        "[workspace] This means Gerald's memories (SOUL.md, skills, etc.) won't be available",
      );
      console.error(
        "[workspace] To fix: Connect GitHub in the Dashboard UI to authenticate",
      );
      return { ok: false, output: clone.output };
    }

    console.log(
      "[workspace] Successfully cloned Gerald workspace with memories and skills",
    );

    const soulExists = fs.existsSync(path.join(WORKSPACE_DIR, "SOUL.md"));
    const memoryExists = fs.existsSync(path.join(WORKSPACE_DIR, "memory"));
    console.log(
      `[workspace] Verification: SOUL.md=${soulExists}, memory/=${memoryExists}`,
    );
  } else {
    console.log("[workspace] Updating Gerald workspace...");
    await runCmd("git", ["remote", "set-url", "origin", authUrl], {
      cwd: WORKSPACE_DIR,
    });
    const pull = await runCmd("git", ["pull", "--ff-only", "origin", "main"], {
      cwd: WORKSPACE_DIR,
    });
    if (pull.code !== 0) {
      console.log(
        "[workspace] Pull failed (may have local changes):",
        pull.output.split("\n")[0],
      );
      await runCmd("git", ["fetch", "origin", "main"], { cwd: WORKSPACE_DIR });
      return {
        ok: true,
        output:
          "Workspace fetch complete (pull failed, may have local changes)",
      };
    } else {
      console.log("[workspace] Updated:", pull.output.split("\n")[0]);
    }
  }

  return { ok: true, output: "Workspace ready" };
}

export async function startDashboard(OPENCLAW_GATEWAY_TOKEN) {
  // Prevent concurrent starts
  if (dashboardProcess) return;
  if (dashboardStarting) {
    console.log("[dashboard] Start already in progress, waiting...");
    await dashboardStarting;
    return;
  }
  if (dashboardStopping) {
    console.log("[dashboard] Stop in progress, waiting...");
    await dashboardStopping;
  }

  dashboardStarting = (async () => {
    console.log("[workspace] Setting up workspace...");
    try {
      const workspaceResult = await setupWorkspace();
      if (!workspaceResult.ok) {
        console.warn("[workspace] Setup failed:", workspaceResult.output);
      } else {
        console.log("[workspace] Setup complete:", workspaceResult.output);
      }
    } catch (err) {
      console.warn("[workspace] Setup error:", err.message);
    }

    if (process.env.GERALD_MASTER_KEY) {
      const loadSecretsScript = path.join(
        WORKSPACE_DIR,
        "scripts",
        "load-secrets.sh",
      );
      if (fs.existsSync(loadSecretsScript)) {
        console.log("[secrets] Loading shared secrets...");
        try {
          const secretsResult = await runCmd("bash", [loadSecretsScript], {
            env: {
              ...process.env,
              GERALD_MASTER_KEY: process.env.GERALD_MASTER_KEY,
              STATE_DIR,
            },
          });
          if (secretsResult.code === 0) {
            console.log("[secrets] Shared secrets loaded");
          } else {
            console.warn(
              "[secrets] Failed to load secrets:",
              secretsResult.output,
            );
          }
        } catch (err) {
          console.warn("[secrets] Error loading secrets:", err.message);
        }
      } else {
        console.log("[secrets] Script not found, skipping");
      }
    } else {
      console.log(
        "[secrets] GERALD_MASTER_KEY not set, skipping shared secrets",
      );
    }

    console.log("[dashboard] Checking for updates...");
    let result = { ok: false, output: "Timeout" };
    try {
      const setupPromise = setupDashboard();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Dashboard setup timeout (3 min)")),
          180000,
        ),
      );
      result = await Promise.race([setupPromise, timeoutPromise]);
    } catch (err) {
      console.warn("[dashboard] Setup issue:", err.message);
      result = { ok: false, output: err.message };
    }

    if (!result.ok) {
      if (fs.existsSync(path.join(DASHBOARD_DIR, "package.json"))) {
        console.log(
          "[dashboard] Update failed, starting existing version:",
          result.output,
        );
      } else {
        console.error("[dashboard] Setup failed, cannot start:", result.output);
        return;
      }
    }

    console.log("[dashboard] Starting on port " + DASHBOARD_PORT);

    const jwtSecretPath = path.join(STATE_DIR, "dashboard-jwt-secret");
    let dashboardJwtSecret;
    if (fs.existsSync(jwtSecretPath)) {
      dashboardJwtSecret = fs.readFileSync(jwtSecretPath, "utf8").trim();
    } else {
      dashboardJwtSecret = crypto.randomBytes(32).toString("hex");
      fs.writeFileSync(jwtSecretPath, dashboardJwtSecret, { mode: 0o600 });
      console.log("[dashboard] Generated new JWT secret");
    }

    let telegramBotToken = "";
    try {
      const cfg = JSON.parse(fs.readFileSync(configPath(), "utf8"));
      telegramBotToken = cfg?.channels?.telegram?.botToken || "";
    } catch {}

    try {
      const lsof = childProcess
        .execSync(`lsof -ti:${DASHBOARD_PORT} 2>/dev/null || true`)
        .toString()
        .trim();
      if (lsof) {
        console.log(
          `[dashboard] Killing stale process on port ${DASHBOARD_PORT}: ${lsof}`,
        );
        childProcess.execSync(`kill -9 ${lsof} 2>/dev/null || true`);
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {}

    dashboardProcess = childProcess.spawn("node", ["server/index.js"], {
      cwd: DASHBOARD_DIR,
      env: {
        ...process.env,
        PORT: String(DASHBOARD_PORT),
        NODE_ENV: "production",
        OPENCLAW_GATEWAY_URL: GATEWAY_TARGET,
        OPENCLAW_GATEWAY_TOKEN,
        INTERNAL_API_KEY,
        JWT_SECRET: process.env.JWT_SECRET || dashboardJwtSecret,
        ALLOWED_TELEGRAM_IDS:
          process.env.ALLOWED_TELEGRAM_IDS || "",
        TELEGRAM_BOT_ID: process.env.TELEGRAM_BOT_ID || "",
        TELEGRAM_BOT_TOKEN:
          telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || "",
        SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || "",
        SENDGRID_SENDER_EMAIL: process.env.SENDGRID_SENDER_EMAIL
          || (getClientDomain() ? `noreply@${getClientDomain()}` : "")
          || (process.env.RAILWAY_PUBLIC_DOMAIN ? `noreply@${process.env.RAILWAY_PUBLIC_DOMAIN}` : ""),
        CLIENT_DOMAIN: getClientDomain() || "",
        ALLOWED_EMAILS: process.env.DEFAULT_ALLOWED_EMAILS || "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    dashboardProcess.stdout.on("data", (d) =>
      console.log("[dashboard]", d.toString().trim()),
    );
    dashboardProcess.stderr.on("data", (d) =>
      console.error("[dashboard]", d.toString().trim()),
    );
    dashboardProcess.on("close", (code) => {
      console.log("[dashboard] Process exited with code", code);
      dashboardProcess = null;
    });

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const res = await fetch(
          `http://127.0.0.1:${DASHBOARD_PORT}/api/health`,
        );
        if (res.ok) {
          console.log("[dashboard] Ready (health check)");
          return;
        }
      } catch {}
      try {
        const res = await fetch(`http://127.0.0.1:${DASHBOARD_PORT}/`);
        if (res.status < 500) {
          console.log("[dashboard] Ready (root fallback)");
          return;
        }
      } catch {}
    }
    console.error("[dashboard] Failed to start within 30s");
  })();

  try {
    await dashboardStarting;
  } finally {
    dashboardStarting = null;
  }
}
