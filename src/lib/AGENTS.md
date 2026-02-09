# src/lib/ -- Library Modules

Extracted concerns from the main server. Each file is a focused ES module.

## Module Map

| Module | Purpose |
|---|---|
| `constants.js` | All env var reads, port/path defaults, exported constants |
| `config.js` | Config file I/O (`openclaw.json`, `illumin8.json`), token resolution, `getClientDomain()` |
| `gateway.js` | Gateway lifecycle: spawn, readiness polling, config sync, model/provider setup |
| `dashboard.js` | Dashboard lifecycle: clone, build, start as child process, env passthrough |
| `dev-server.js` | Astro dev server lifecycle: clone, install, spawn, restart on webhook |
| `startup.js` | Boot sequence: Tailscale, workspace clone, secrets loading |
| `auth.js` | Setup wizard Basic auth middleware |
| `github.js` | GitHub token resolution, webhook registration |
| `cloudflare.js` | Cloudflare DNS record creation (CNAME for root, dev, gerald subdomains) |
| `sendgrid.js` | SendGrid domain auth, verified sender registration, DNS record creation |
| `site-builder.js` | `cloneAndBuild()`: git clone, npm install, build, output detection |
| `helpers.js` | `runCmd()` utility for spawning child processes with output capture |
| `prod-server.js` | Production static file serving with .html fallback |

## Patterns

- **All modules use ES module exports** (`export function`, `export const`).
- **Constants are centralized** in `constants.js` -- never read `process.env` directly in other modules (except `dashboard.js` for passthrough).
- **Child process management:** Gateway, dashboard, and dev server are all spawned via `childProcess.spawn()` with stdio piped to console.
- **Config sync pattern:** On every gateway start, wrapper syncs token, model, and chatCompletions endpoint to `openclaw.json` via CLI commands.

## Touch Points

When modifying environment variable handling: start in `constants.js`, then trace usage.
When modifying service lifecycle: `gateway.js`, `dashboard.js`, or `dev-server.js`.
When modifying proxy/auth: `config.js` for token resolution, `server.js` for injection.
