# scripts/ -- Utility Scripts

| Script | Purpose |
|---|---|
| `smoke.js` | Docker smoke test -- builds image, runs container, checks `/setup/healthz` |
| `clone-website-repo.sh` | Helper to clone a client website repo with token auth |

## Running

```bash
npm run smoke    # Runs scripts/smoke.js (requires Docker)
```
