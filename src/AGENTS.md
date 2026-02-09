# src/ -- Application Source

Express wrapper that orchestrates four services in a single Railway container: OpenClaw gateway, Gerald dashboard, Astro dev server, and static site serving.

## Key Files

| File | Purpose | Size |
|---|---|---|
| `server.js` | Main Express app: routing, proxy, setup wizard API, webhook handlers, static serving | ~110KB |
| `lib/` | Extracted modules (config, gateway, dashboard, auth, etc.) | see [lib/AGENTS.md](./lib/AGENTS.md) |
| `public/` | Setup wizard frontend (HTML, CSS, vanilla JS) |
| `templates/` | Client skill templates (markdown) |

## Patterns & Conventions

- **Single large entry point:** `server.js` contains all Express routes, proxy config, and lifecycle management. Library modules in `lib/` handle specific concerns.
- **ES Modules:** All files use `import`/`export` (no `require`).
- **No build step:** Plain JavaScript, no TypeScript, no bundler.
- **No framework abstractions:** Raw Express routes, manual proxy setup with `http-proxy`.

### Route Organization in server.js

Routes are organized by host-based routing:
1. Exempted routes (webhooks, API, setup) -- bypass host check
2. Production site (`clientdomain.com`) -- static file serving
3. Dev site (`dev.clientdomain.com`) -- proxy to Astro dev server
4. Dashboard (`gerald.clientdomain.com`) -- proxy to dashboard, `/openclaw/*` to gateway
5. Railway domain (`*.up.railway.app`) -- proxy to gateway (setup/admin)

### Proxy Pattern

```javascript
// Token injection via proxy event handlers (NOT direct header mutation)
proxy.on("proxyReq", (proxyReq, req) => {
  if (req._proxyTarget !== 'dashboard') {
    proxyReq.setHeader("Authorization", `Bearer ${token}`);
  }
});
```

### Body Re-injection

Express's `express.json()` consumes the body stream. The `proxyReq` handler re-injects it for proxied POST/PUT/PATCH requests.

## Common Gotchas

- `server.js` is very large (~110KB). Use grep or symbol search to navigate, don't read the whole file.
- WebSocket upgrades are handled in `server.on("upgrade")`, not Express middleware.
- Dashboard requests must NOT get gateway token injected (uses separate Telegram auth).
- Static file serving manually handles `.html` extension fallback and SPA routing.
