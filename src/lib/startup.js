import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUN_BIN = "/root/.bun/bin/bun";
const QMD_BIN = "/root/.bun/bin/qmd";
const BUN_GLOBAL_DIR = "/root/.bun/install/global";
const PERSISTED_BUN_GLOBAL_DIR = "/data/.bun/install/global";

function ensureOpenclawNetworkShim() {
  const sourcePath = path.join(__dirname, "network-interfaces-shim.cjs");
  const targetPath = "/tmp/openclaw-network-shim.cjs";

  try {
    if (!fs.existsSync(sourcePath)) {
      return;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    console.log(`[startup] synced network shim at ${targetPath}`);
  } catch (err) {
    console.warn(`[startup] could not sync network shim: ${err.message}`);
  }
}

function ensureBunGlobals() {
  try {
    fs.mkdirSync(path.dirname(PERSISTED_BUN_GLOBAL_DIR), { recursive: true });

    // Seed the persisted bun global dir once from the image layer so existing tools survive first boot.
    if (
      fs.existsSync(BUN_GLOBAL_DIR) &&
      !fs.existsSync(PERSISTED_BUN_GLOBAL_DIR)
    ) {
      fs.cpSync(BUN_GLOBAL_DIR, PERSISTED_BUN_GLOBAL_DIR, { recursive: true });
      console.log(
        `[startup] seeded persisted bun globals at ${PERSISTED_BUN_GLOBAL_DIR}`,
      );
    }

    let needsLink = true;
    if (fs.existsSync(BUN_GLOBAL_DIR)) {
      const stat = fs.lstatSync(BUN_GLOBAL_DIR);
      if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(BUN_GLOBAL_DIR);
        if (target === PERSISTED_BUN_GLOBAL_DIR) {
          needsLink = false;
        } else {
          fs.unlinkSync(BUN_GLOBAL_DIR);
        }
      } else {
        fs.rmSync(BUN_GLOBAL_DIR, { recursive: true, force: true });
      }
    }

    if (needsLink) {
      fs.symlinkSync(PERSISTED_BUN_GLOBAL_DIR, BUN_GLOBAL_DIR);
      console.log(
        `[startup] symlinked ${BUN_GLOBAL_DIR} -> ${PERSISTED_BUN_GLOBAL_DIR}`,
      );
    }
  } catch (err) {
    console.warn(`[startup] could not persist bun globals: ${err.message}`);
    return;
  }

  if (!fs.existsSync(BUN_BIN)) {
    console.warn(`[startup] bun not found at ${BUN_BIN}; skipping qmd repair`);
    return;
  }

  const qmdWorks = () => {
    try {
      childProcess.execFileSync(QMD_BIN, ["--version"], {
        stdio: "ignore",
        timeout: 20_000,
      });
      return true;
    } catch {
      return false;
    }
  };

  if (qmdWorks()) {
    return;
  }

  console.log("[startup] qmd missing/broken; installing @tobilu/qmd globally");
  try {
    childProcess.execFileSync(BUN_BIN, ["install", "-g", "@tobilu/qmd"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 180_000,
      env: {
        ...process.env,
        PATH: `/root/.bun/bin:${process.env.PATH || ""}`,
      },
    });
  } catch (err) {
    const out = [
      err?.stdout?.toString?.().trim(),
      err?.stderr?.toString?.().trim(),
      err?.message,
    ]
      .filter(Boolean)
      .join(" | ");
    console.warn(`[startup] failed to install @tobilu/qmd: ${out}`);
    return;
  }

  if (qmdWorks()) {
    console.log("[startup] qmd install verified");
  } else {
    console.warn("[startup] qmd install completed but qmd is still not runnable");
  }
}

// Restore Claude Code and Codex from persistent volume on container restart.
export function restorePersistedTools() {
  const home = os.homedir();
  ensureOpenclawNetworkShim();
  ensureBunGlobals();

  const localShare = path.join(home, ".local", "share");
  const localBin = path.join(home, ".local", "bin");
  const links = [
    [path.join(localShare, "claude"), "/data/claude-code"],
    [path.join(home, ".claude"), "/data/.claude"],
    [path.join(home, ".claude.json"), "/data/.claude.json"],
  ];

  for (const dir of [localShare, localBin]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const [link, target] of links) {
    try {
      if (fs.existsSync(target) && !fs.existsSync(link)) {
        fs.symlinkSync(target, link);
        console.log(`[startup] symlinked ${link} -> ${target}`);
      }
    } catch (err) {
      console.warn(`[startup] could not symlink ${link}: ${err.message}`);
    }
  }

  const codexPersist = "/data/.codex/auth.json";
  const codexRuntime = path.join(home, ".codex", "auth.json");
  try {
    if (fs.existsSync(codexPersist) && !fs.existsSync(codexRuntime)) {
      fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
      fs.copyFileSync(codexPersist, codexRuntime);
      console.log(`[startup] restored Codex auth from ${codexPersist}`);
    }
  } catch (err) {
    console.warn(`[startup] could not restore Codex auth: ${err.message}`);
  }

  const binLink = path.join(localBin, "claude");
  const versionsDir = "/data/claude-code/versions";
  try {
    if (fs.existsSync(versionsDir)) {
      const versions = fs.readdirSync(versionsDir).sort();
      if (versions.length > 0) {
        const latest = path.join(versionsDir, versions[versions.length - 1]);
        try {
          fs.unlinkSync(binLink);
        } catch {}
        fs.symlinkSync(latest, binLink);
        console.log(`[startup] symlinked ${binLink} -> ${latest}`);
      }
    }
  } catch (err) {
    console.warn(`[startup] could not link claude binary: ${err.message}`);
  }
}

export async function startTailscale() {
  const authKey = process.env.TAILSCALE_AUTHKEY?.trim();
  if (!authKey) {
    console.log(
      "[tailscale] TAILSCALE_AUTHKEY not set, skipping Tailscale setup",
    );
    return { ok: false, reason: "no auth key" };
  }

  console.log("[tailscale] Starting tailscaled daemon...");

  const tailscaled = childProcess.spawn(
    "tailscaled",
    [
      "--state=/data/.tailscale/tailscaled.state",
      "--socket=/var/run/tailscale/tailscaled.sock",
      "--tun=userspace-networking",
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );

  tailscaled.stdout.on("data", (d) =>
    console.log("[tailscaled]", d.toString().trim()),
  );
  tailscaled.stderr.on("data", (d) =>
    console.log("[tailscaled]", d.toString().trim()),
  );
  tailscaled.unref();

  await new Promise((r) => setTimeout(r, 2000));

  console.log("[tailscale] Authenticating...");
  const hostname = process.env.TAILSCALE_HOSTNAME || "cass-ai-railway";

  return new Promise((resolve) => {
    const up = childProcess.spawn(
      "tailscale",
      ["up", "--authkey", authKey, "--hostname", hostname, "--accept-routes"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    up.stdout.on("data", (d) => {
      output += d.toString();
      console.log("[tailscale]", d.toString().trim());
    });
    up.stderr.on("data", (d) => {
      output += d.toString();
      console.log("[tailscale]", d.toString().trim());
    });

    up.on("close", (code) => {
      if (code === 0) {
        console.log("[tailscale] ✓ Connected to tailnet");
        childProcess.exec("tailscale ip -4", (err, stdout) => {
          if (!err && stdout.trim()) {
            console.log(`[tailscale] IP address: ${stdout.trim()}`);
          }
        });
        resolve({ ok: true });
      } else {
        console.error("[tailscale] Failed to connect:", output);
        resolve({ ok: false, reason: output });
      }
    });
  });
}
