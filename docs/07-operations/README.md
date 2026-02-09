# Operations

## Health Checks

```bash
curl https://your-service.railway.app/setup/healthz
curl https://your-service.railway.app/setup/diagnostic
```

## Viewing Logs

```bash
railway logs                        # All logs
railway logs | grep '\[gateway\]'   # Gateway only
railway logs | grep '\[dashboard\]' # Dashboard only
railway logs | grep '\[dev-server\]'# Dev server only
railway logs | grep '\[token\]'     # Token diagnostics
```

## Debug Mode

Set `OPENCLAW_TEMPLATE_DEBUG=true` in Railway variables for verbose logging.

See [architecture](../01-architecture/architecture.md#debugging) for full debugging guide.
