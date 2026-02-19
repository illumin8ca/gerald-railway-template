const { pathToFileURL } = require("node:url");
const os = require("node:os");
const { syncBuiltinESMExports } = require("node:module");

const originalNetworkInterfaces = os.networkInterfaces;
os.networkInterfaces = function patchedNetworkInterfaces() {
  try {
    return originalNetworkInterfaces.call(os);
  } catch {
    return {};
  }
};
syncBuiltinESMExports();

async function main() {
  const entry = process.argv[2];
  const args = process.argv.slice(3);
  if (!entry) {
    throw new Error("Missing OpenClaw entry path");
  }
  process.argv = [process.argv[0], entry, ...args];
  await import(pathToFileURL(entry).href);
}

main().catch((err) => {
  console.error("[openclaw-launcher] startup failed:", err?.stack || String(err));
  process.exit(1);
});
