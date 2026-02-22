# Gerald Railway Template

One-click Railway deployment for [OpenClaw](https://github.com/openclaw/openclaw), an AI coding assistant platform. Provides a web setup wizard, reverse proxy, persistent state, and multi-service orchestration in a single container.

## What You Get

- **OpenClaw Gateway + Control UI** at `/` and `/openclaw`
- **Setup Wizard** at `/setup` (password-protected)
- **Gerald Dashboard** at `gerald.yourdomain.com` (Telegram login)
- **Live Dev Server** at `dev.yourdomain.com` (Astro HMR)
- **Production Static Hosting** at `yourdomain.com`
- **Persistent state** via Railway Volume (survives redeploys)
- **Auto DNS setup** via Cloudflare API
- **Auto rebuild** via GitHub push webhooks

## Quick Start

### Deploy to Railway

1. Click **Deploy to Railway** from the template
2. Add a **Volume** mounted at `/data` (1 GB min)
3. Set `SETUP_PASSWORD` and `CLIENT_DOMAIN` in variables
4. Visit `https://<your-app>.up.railway.app/setup`
5. Complete the wizard

See [docs/06-deployment/railway-deployment.md](./docs/06-deployment/railway-deployment.md) for the full guide.

### Local Development

```bash
# Docker build + run
docker build -t gerald-railway-template .
docker run --rm -p 8080:8080 \
  -e PORT=8080 \
  -e SETUP_PASSWORD=test \
  -e OPENCLAW_STATE_DIR=/data/.openclaw \
  -e OPENCLAW_WORKSPACE_DIR=/data/workspace \
  -v $(pwd)/.tmpdata:/data \
  gerald-railway-template

# Visit http://localhost:8080/setup (password: test)
```

### Development Commands

| Command | Description |
|---|---|
| `npm run dev` | Start wrapper locally (needs OpenClaw at `/openclaw` or `OPENCLAW_ENTRY` set) |
| `npm start` | Production start |
| `npm run lint` | Syntax check (`node -c src/server.js`) |
| `npm run smoke` | Docker smoke test |

## Architecture

Four services in one container, orchestrated by an Express wrapper:

| Service | Port | Purpose |
|---|---|---|
| **Wrapper** | 8080 | Public entry point, host-based routing, proxy |
| **Gateway** | 18789 | OpenClaw AI agent runtime |
| **Dashboard** | 3003 | Gerald web UI |
| **Dev Server** | 4321 | Live Astro dev with HMR |

The wrapper inspects `req.hostname` and routes:
- `yourdomain.com` -> static production files
- `dev.yourdomain.com` -> dev server (port 4321)
- `gerald.yourdomain.com` -> dashboard (port 3003)
- `*.up.railway.app` -> gateway (port 18789)

See [docs/01-architecture/architecture.md](./docs/01-architecture/architecture.md) for the full design.

## Project Structure

```
gerald-railway-template/
├── src/
│   ├── server.js          # Main Express app (~110KB)
│   ├── lib/               # Extracted modules (config, gateway, dashboard, etc.)
│   ├── public/            # Setup wizard frontend (HTML, CSS, JS)
│   └── templates/         # Client skill templates
├── scripts/
│   ├── smoke.js                # Docker smoke test
│   ├── clone-website-repo.sh
│   ├── gateway-status.sh        # Check wrapper-managed gateway status
│   ├── gateway-restart.sh       # Restart gateway process via setup API
│   └── claw                    # In-container helper CLI (`claw gateway status|restart`)
├── docs/                  # Organized documentation (numbered folders)
├── Dockerfile             # Multi-stage build (OpenClaw from source + runtime)
├── railway.toml           # Railway config-as-code (DOCKERFILE builder)
├── .env.example           # All environment variables documented
└── package.json           # pnpm, node >=22
```

## Environment Variables

**Required:** `SETUP_PASSWORD`

**Recommended:** `DEFAULT_MODEL`, `MOONSHOT_API_KEY`, `GITHUB_TOKEN`, `SENDGRID_API_KEY`, `CLOUDFLARE_API_KEY`, `CLOUDFLARE_EMAIL`

**Per-deployment:** `CLIENT_DOMAIN`

See [.env.example](./.env.example) for the full list with descriptions.

## Documentation

| Topic | Location |
|---|---|
| Architecture & system design | [docs/01-architecture/](./docs/01-architecture/) |
| CLI authentication (Claude/Codex) | [docs/02-setup-guides/](./docs/02-setup-guides/) |
| Developer workflow & branching | [docs/03-development/](./docs/03-development/) |
| Railway deployment & template config | [docs/06-deployment/](./docs/06-deployment/) |
| Operations & troubleshooting | [docs/07-operations/](./docs/07-operations/) |
| AI agent instructions | [AGENTS.md](./AGENTS.md) |

## Troubleshooting

| Issue | Solution |
|---|---|
| Config lost after redeploy | Add persistent volume at `/data` |
| Gateway won't start | Check `[gateway]` and `[token]` in Railway logs |
| HMR not working on dev site | Check WebSocket proxy: `railway logs \| grep '[ws-upgrade]'` |
| Dashboard login fails | Verify `ALLOWED_TELEGRAM_IDS` includes your Telegram user ID |
| Build fails (esbuild) | Wrapper auto-handles; check `[build]` logs if persistent |

### Restarting Gateway (No `systemctl`)

This container runs as a single wrapper process (no `systemd`), so `systemctl` is not expected to exist.

- Restart only the gateway:
```bash
SETUP_PASSWORD=... bash scripts/gateway-restart.sh
```

- Check gateway status:
```bash
SETUP_PASSWORD=... bash scripts/gateway-status.sh
```

When running inside the container, use the `claw` helper:
```bash
claw gateway status
claw gateway restart
```

It is equivalent to calling:
```bash
SETUP_PASSWORD=... OPENCLAW_WRAPPER_URL=http://127.0.0.1:8080 bash scripts/gateway-status.sh
SETUP_PASSWORD=... OPENCLAW_WRAPPER_URL=http://127.0.0.1:8080 bash scripts/gateway-restart.sh
```

- Remote restart (for Railway URL):
```bash
OPENCLAW_WRAPPER_URL=https://your-app.up.railway.app \
SETUP_PASSWORD=... \
bash scripts/gateway-restart.sh
```

You can also call the same endpoint directly:
```bash
curl -u ":$SETUP_PASSWORD" -X POST "${OPENCLAW_WRAPPER_URL}/setup/api/gateway/restart"
```

## License

[MIT](./LICENSE)
