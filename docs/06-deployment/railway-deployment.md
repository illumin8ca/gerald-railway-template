# Railway Deployment Guide

## Quick Deploy (New Client, ~2 Minutes)

With Railway Shared Variables already configured:

1. **Deploy from Template** -- click "Deploy to Railway"
2. **Add Volume** -- Settings > Volumes > Mount Path: `/data`, Size: 1 GB
3. **Set per-deployment variable**: `CLIENT_DOMAIN=clientdomain.com`
4. **Visit setup wizard**: `https://<service-url>.up.railway.app/setup`
5. **Click "Run Setup"** -- wait ~30 seconds

After setup completes:
- `https://clientdomain.com` -- Production site
- `https://dev.clientdomain.com` -- Dev site (hot reload)
- `https://gerald.clientdomain.com` -- Gerald dashboard
- DNS automatically configured (Cloudflare)
- GitHub webhooks auto-rebuild on push

## Deploying from GitHub (Manual Volume)

If deploying directly from the GitHub repo instead of the Railway Template, the volume must be added manually.

### Option A: Railway CLI

```bash
npm i -g @railway/cli
railway login
railway link
chmod +x railway-setup.sh
./railway-setup.sh
```

### Option B: Railway Dashboard

1. Open your deployed service
2. **Settings** > **Volumes** > **New Volume**
3. Mount Path: `/data`, Size: 1 GB
4. Railway restarts the service automatically

### Why Volumes Can't Be Auto-Created

Railway does not support defining volumes in `railway.toml`, `railway.json`, or `Dockerfile`. They must be created via Dashboard, CLI, or API.

## Environment Variables

### Required (Shared Variables)

| Variable | Purpose |
|---|---|
| `SETUP_PASSWORD` | Protects `/setup` wizard |
| `GITHUB_TOKEN` | Dashboard updates + webhook registration |
| `DEFAULT_MODEL` | AI model (e.g. `moonshot/kimi-k2.5`) |
| `MOONSHOT_API_KEY` | API key for Moonshot provider |
| `SENDGRID_API_KEY` | Email service for magic links |
| `CLOUDFLARE_API_KEY` | DNS automation |
| `CLOUDFLARE_EMAIL` | Cloudflare account email |

### Per-Deployment

| Variable | Purpose |
|---|---|
| `CLIENT_DOMAIN` | Client's domain (e.g. `example.com`) |

### Optional (Auto-Defaults)

| Variable | Default | Purpose |
|---|---|---|
| `SENDGRID_SENDER_EMAIL` | `noreply@{CLIENT_DOMAIN}` | Sender email |
| `PORT` | `8080` | Wrapper listen port |
| `OPENCLAW_GATEWAY_TOKEN` | Auto-generated | Gateway auth token |
| `OPENCLAW_STATE_DIR` | `/data/.openclaw` | Config/state directory |
| `OPENCLAW_WORKSPACE_DIR` | `/data/workspace` | Agent workspace |

See `.env.example` for the full list.

## Verification

```bash
curl https://your-service.railway.app/setup/diagnostic
```

Look for `"stateDirExists": true` and no volume warnings.

## Volume Configuration in Template Composer

When publishing as a Railway Template:

1. Go to [Railway Template Composer](https://railway.app/new/template)
2. Repository: `illumin8ca/gerald-railway-template`, Branch: `main`
3. **Add Volume**: Mount Path `/data`, Size 1 GB
4. Set Health Check: Path `/setup/healthz`, Timeout 300s
5. Publish

## Client Repo Requirements

The client's website repo needs:
- GitHub repository (public or private with `GITHUB_TOKEN` access)
- `main` branch for production, `development` branch for dev server
- `npm run build` script that outputs to `dist/`, `build/`, or `out/`

## Troubleshooting

| Symptom | Fix |
|---|---|
| Config lost after redeploy | Volume not mounted to `/data` |
| 503 Service Unavailable | Check logs, visit `/setup/healthz` and `/setup/diagnostic` |
| Gateway not starting | Check `[gateway]` logs, verify token sync with `[token]` logs |
| Build failed - missing dep | Move build-time deps from `devDependencies` to `dependencies` |
| Email service not configured | Check `SENDGRID_API_KEY` shared variable |
| DNS update failed | Check `CLOUDFLARE_API_KEY` and `CLOUDFLARE_EMAIL` |
