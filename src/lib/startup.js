import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

// Restore Claude Code and Codex from persistent volume on container restart.
export function restorePersistedTools() {
  const home = os.homedir();
  ensureOpenclawNetworkShim();

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
