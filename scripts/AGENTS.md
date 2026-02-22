# scripts/ -- Utility Scripts

| Script | Purpose |
|---|---|
| `smoke.js` | Docker smoke test -- builds image, runs container, checks `/setup/healthz` |
| `clone-website-repo.sh` | Helper to clone a client website repo with token auth |
| `gateway-status.sh` | Query wrapper gateway status (`/setup/api/gateway/status`) |
| `gateway-restart.sh` | Trigger wrapper gateway restart (`/setup/api/gateway/restart`) |
| `claw` | Interactive wrapper CLI helper for container restarts (`claw gateway status|restart`) |

## Running

```bash
npm run smoke    # Runs scripts/smoke.js (requires Docker)
```
