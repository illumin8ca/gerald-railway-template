/**
 * Network Interfaces Shim
 * 
 * Mitigates uv_interface_addresses system errors in containerized environments
 * (e.g., Railway, Docker) where the syscall may fail with ERR_SYSTEM_ERROR.
 * 
 * This shim monkey-patches os.networkInterfaces() to gracefully handle failures
 * by returning an empty object instead of crashing the process.
 */

const os = require('node:os');
const { syncBuiltinESMExports } = require('node:module');

const originalNetworkInterfaces = os.networkInterfaces;

os.networkInterfaces = function patchedNetworkInterfaces() {
  try {
    return originalNetworkInterfaces.call(os);
  } catch (err) {
    // Log concise warning (only once)
    if (!patchedNetworkInterfaces.warned) {
      console.warn('[network-shim] os.networkInterfaces() failed, returning empty object:', err.message);
      patchedNetworkInterfaces.warned = true;
    }
    return {};
  }
};

// Ensure ESM imports also see the patched function
syncBuiltinESMExports();

console.log('[network-shim] os.networkInterfaces() patched for container compatibility');
