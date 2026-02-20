import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR, WORKSPACE_DIR, DEBUG, OPENCLAW_ENTRY } from "./constants.js";

export function debug(...args) {
  if (DEBUG) console.log(...args);
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function parseCookiesFromString(cookieStr) {
  const cookies = {};
  if (!cookieStr) return cookies;
  cookieStr.split(';').forEach(pair => {
    const [key, ...val] = pair.trim().split('=');
    if (key) cookies[key] = decodeURIComponent(val.join('='));
  });
  return cookies;
}

export function clawArgs(args) {
  const launcherPath = path.join(
    process.cwd(),
    "src",
    "lib",
    "openclaw-launcher.cjs",
  );
  if (fs.existsSync(launcherPath)) {
    return [launcherPath, OPENCLAW_ENTRY, ...args];
  }
  return [OPENCLAW_ENTRY, ...args];
}

export function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const proc = childProcess.spawn(cmd, args, {
      ...opts,
      env: {
        ...process.env,
        ...(opts.env || {}),
        OPENCLAW_STATE_DIR: STATE_DIR,
        OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR,
      },
    });

    let out = "";
    proc.stdout?.on("data", (d) => (out += d.toString("utf8")));
    proc.stderr?.on("data", (d) => (out += d.toString("utf8")));

    proc.on("error", (err) => {
      out += `\n[spawn error] ${String(err)}\n`;
      resolve({ code: 127, output: out });
    });

    proc.on("close", (code) => resolve({ code: code ?? 0, output: out }));
  });
}

export async function safeRemoveDir(dir) {
  if (fs.existsSync(dir)) {
    await runCmd('rm', ['-rf', dir]);
  }
}

export function perfLog(label) {
  const now = Date.now();
  if (!perfLog.start) perfLog.start = now;
  const elapsed = now - perfLog.start;
  console.log(`[perf] ${label}: ${elapsed}ms`);
}
perfLog.start = null;
