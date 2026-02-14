import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { PRODUCTION_DIR, DEV_DIR, PROD_SERVER_PORT } from "./constants.js";
import { getClientDomain } from "./config.js";

let prodServerProcess = null;

export function getProdServerProcess() {
  return prodServerProcess;
}

export function isProdSSR() {
  return (
    fs.existsSync(path.join(PRODUCTION_DIR, "dist", "server", "entry.mjs")) ||
    fs.existsSync(path.join(PRODUCTION_DIR, "server", "entry.mjs"))
  );
}

/** Return the correct entry script path relative to PRODUCTION_DIR */
function getSSREntryScript() {
  if (fs.existsSync(path.join(PRODUCTION_DIR, "dist", "server", "entry.mjs"))) {
    return "dist/server/entry.mjs";
  }
  if (fs.existsSync(path.join(PRODUCTION_DIR, "server", "entry.mjs"))) {
    return "server/entry.mjs";
  }
  return null;
}

export async function startProdServer(retryCount = 0) {
  if (prodServerProcess) return;
  if (!isProdSSR()) {
    console.log("[prod-server] Not an SSR site, skipping");
    return;
  }

  console.log(
    `[prod-server] Starting SSR server on port ${PROD_SERVER_PORT}... (attempt ${retryCount + 1})`,
  );

  try {
    childProcess.execSync(`pkill -f 'entry.mjs' 2>/dev/null || true`);
    childProcess.execSync(
      `fuser -k ${PROD_SERVER_PORT}/tcp 2>/dev/null || true`,
    );
    await new Promise((r) => setTimeout(r, 2000));
  } catch {}

  // Ensure node_modules is available for SSR runtime dependencies
  try {
    const prodNodeModules = path.join(PRODUCTION_DIR, "node_modules");
    if (!fs.existsSync(prodNodeModules)) {
      // Try dev workspace first (has the site's full dependencies)
      const devNodeModules = path.join(DEV_DIR, "node_modules");
      if (fs.existsSync(devNodeModules)) {
        console.log("[prod-server] Symlinking dev node_modules to production...");
        fs.symlinkSync(devNodeModules, prodNodeModules);
      }
      // Fallback: if production has its own package.json
      else if (fs.existsSync(path.join(PRODUCTION_DIR, "package.json"))) {
        console.log("[prod-server] Installing dependencies in production dir...");
        childProcess.execSync(`cd "${PRODUCTION_DIR}" && npm install --legacy-peer-deps 2>&1`, {
          stdio: "pipe",
        });
      }
      // Last resort: copy template's node_modules
      else {
        const rootNodeModules = path.join(process.cwd(), "node_modules");
        if (fs.existsSync(rootNodeModules)) {
          console.log("[prod-server] Copying root node_modules to production...");
          childProcess.execSync(`cp -r "${rootNodeModules}" "${prodNodeModules}"`);
        }
      }
    }
  } catch (e) {
    console.warn("[prod-server] Failed to ensure dependencies:", e.message);
  }

  const clientDomain = getClientDomain();
  const siteUrl = clientDomain
    ? `https://${clientDomain}`
    : `http://localhost:${PROD_SERVER_PORT}`;

  const startScript = getSSREntryScript() || "dist/server/entry.mjs";

  prodServerProcess = childProcess.spawn("node", [startScript], {
    cwd: PRODUCTION_DIR,
    env: {
      ...process.env,
      PORT: String(PROD_SERVER_PORT),
      HOST: "0.0.0.0",
      NODE_ENV: "production",
      SITE_URL: siteUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  prodServerProcess.stdout.on("data", (d) =>
    console.log("[prod-server]", d.toString().trim()),
  );
  prodServerProcess.stderr.on("data", (d) =>
    console.error("[prod-server]", d.toString().trim()),
  );
  prodServerProcess.on("close", (code) => {
    console.log("[prod-server] Process exited with code", code);
    prodServerProcess = null;
  });

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const res = await fetch(`http://127.0.0.1:${PROD_SERVER_PORT}/`);
      if (res.ok || res.status === 304 || res.status === 404) {
        console.log("[prod-server] Ready");
        return;
      }
    } catch {}
  }

  if (retryCount < 2) {
    console.warn("[prod-server] Failed to start, retrying in 5 seconds...");
    prodServerProcess = null;
    await new Promise((r) => setTimeout(r, 5000));
    return startProdServer(retryCount + 1);
  }
  console.warn(
    "[prod-server] Timed out waiting for SSR server to start after retries",
  );
}

export function stopProdServer() {
  if (!prodServerProcess) return;
  console.log("[prod-server] Stopping...");
  prodServerProcess.kill("SIGTERM");
  prodServerProcess = null;
}

export async function restartProdServer() {
  stopProdServer();
  await new Promise((r) => setTimeout(r, 1000));
  await startProdServer();
}
