# Browser Node Pairing Fix: "gateway closed (1008): pairing required"

**Date resolved:** 2026-02-20
**Service:** openclaw-cassai (Railway)
**Symptom:** `Nodes failed: agent=dm-replies node=auto gateway=default action=status: gateway closed (1008): pairing required`

---

## Summary

When an embedded agent tries to use browser tools through the local gateway, it connects as the **identity device** (`identity/device-auth.json`). If that device's scopes are missing `operator.read` and `operator.write`, the gateway rejects the connection with a "scope-upgrade" / "pairing required" error even though the device IS paired and has a valid token.

**Root cause:** The identity device was paired with scopes `[operator.admin, operator.approvals, operator.pairing]` but the gateway's scope validator requires an explicit `operator.read` check for node/browser operations — `operator.admin` is not treated as a superset.

**Fix:** Add `operator.read` and `operator.write` to the identity device's scopes in two files.

---

## Diagnosis Trail (What We Ruled Out)

This took a while to find. Things that were NOT the problem:

| Red herring | Why it wasn't the fix |
|---|---|
| Gateway bearer token mismatch | Token in openclaw.json matched `OPENCLAW_GATEWAY_TOKEN` env var |
| `gateway.remote` stale config | Was pointing to Mac's loopback gateway via Tailscale — fixed first, but error persisted |
| Chrome extension not paired | Amdos-Mac node was connected with `browser, system` caps |
| Agent `auth.json` empty | `auth.json` is for model API credentials, not gateway auth |
| Missing `device-auth.json` per agent | Embedded agents use the identity device, not a per-agent device |
| Node pairing approval too slow | Approved pending node pairing request, but token never reached agent |

### How we found the real cause

Tailed the gateway log file at `/tmp/openclaw/openclaw-2026-02-20.log` and found this entry:

```json
{
  "subsystem": "gateway",
  "message": "security audit: device access upgrade requested",
  "reason": "scope-upgrade",
  "device": "9e652f85a822be61a169aec5fd625c7adbf1b83a88a8f36669a6dadcc2029818",
  "scopesFrom": "operator.admin,operator.approvals,operator.pairing",
  "scopesTo": "operator.read",
  "client": "gateway-client"
}
```

The identity device was connected and authenticated — but the gateway refused to execute the `nodes` tool call because `operator.read` was not explicitly listed in its scopes.

---

## The Fix

SSH into the Railway container and run this Python script:

```bash
railway ssh --service "<your-service-id>"
```

Then run:

```python
python3 - << 'EOF'
import json, time

DEVICE_ID = '9e652f85a822be61a169aec5fd625c7adbf1b83a88a8f36669a6dadcc2029818'
FULL_SCOPES = ['operator.admin', 'operator.approvals', 'operator.pairing', 'operator.read', 'operator.write']

# 1. Update paired.json
with open('/data/.openclaw/devices/paired.json', 'r') as f:
    paired = json.load(f)

device = paired[DEVICE_ID]
device['scopes'] = FULL_SCOPES
device['tokens']['operator']['scopes'] = FULL_SCOPES

with open('/data/.openclaw/devices/paired.json', 'w') as f:
    json.dump(paired, f, indent=2)
print('paired.json updated')

# 2. Update identity/device-auth.json
with open('/data/.openclaw/identity/device-auth.json', 'r') as f:
    d = json.load(f)

d['tokens']['operator']['scopes'] = FULL_SCOPES
d['tokens']['operator']['updatedAtMs'] = int(time.time() * 1000)

with open('/data/.openclaw/identity/device-auth.json', 'w') as f:
    json.dump(d, f, indent=2)
print('identity/device-auth.json updated')
print('Done. No restart required — scope changes take effect immediately.')
EOF
```

**No gateway restart is required.** The gateway reads scopes from `paired.json` on each connection validation.

---

## Finding the Identity Device ID

The device ID (`9e652f85a8...` above) is specific to this deployment's identity device. To find yours:

```bash
cat /data/.openclaw/identity/device-auth.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['deviceId'])"
```

---

## Architecture: How Embedded Agent Browser Calls Work

```
Slack/Telegram message
        ↓
  Gateway receives → routes to dm-replies agent (embedded)
        ↓
  Agent calls `nodes` tool (browser action)
        ↓
  Gateway WebSocket client connects to ws://127.0.0.1:18789
  using identity device credentials (identity/device-auth.json)
        ↓
  Gateway checks: is deviceId in paired.json? Does token match? Does scope allow?
        ↓ (was failing here: missing operator.read)
  Gateway proxies browser command to Amdos-Mac node
        ↓
  Amdos-Mac node host → local relay (port 18792) → Chrome extension
        ↓
  Browser action executes; result returns upstream
```

Key insight: **embedded agents share the identity device** for their gateway connections. They do NOT use a per-agent `device-auth.json`.

---

## Related: `gateway.remote` Stale Config (Also Fixed)

Before finding the scope issue, we also found and fixed a stale `gateway.remote` config that was redirecting agent WebSocket connections to the Mac's local gateway (via Tailscale) instead of the Railway container's local gateway:

```bash
# Check for stale remote config
openclaw config get gateway.remote

# Remove it if present
openclaw config unset gateway.remote
```

This required a Railway redeploy to fully clear:

```bash
railway redeploy --service "<service-id>" --yes
```

The `gateway.remote` was set from an earlier experiment trying to bridge gateways over Tailscale. Tailscale on the Railway container also had an expired auth key (`TAILSCALE_AUTHKEY`), making the remote endpoint unreachable regardless.

---

## Prevention

To avoid this recurring after a volume reset or re-pairing:

1. After any fresh onboarding or `openclaw configure` run, check the identity device scopes:
   ```bash
   cat /data/.openclaw/identity/device-auth.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['tokens']['operator']['scopes'])"
   ```

2. If `operator.read` or `operator.write` are missing, run the fix script above.

3. Consider adding the scope fix to the `gerald-railway-template` startup script so it auto-patches after every redeploy.

---

## Useful Diagnostic Commands (run inside Railway container via `railway ssh`)

```bash
# Check node connection status
openclaw nodes status

# Check gateway config (verify no stale gateway.remote)
openclaw config get gateway
openclaw config get gateway.remote

# Check identity device scopes
cat /data/.openclaw/identity/device-auth.json

# Check all paired devices
openclaw devices list

# Check pending node pairing requests
openclaw nodes pending

# Tail live gateway logs
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        d = json.loads(line)
        lvl = d.get('_meta', {}).get('logLevelName', '')
        msg = d.get('0', '')
        if lvl in ('WARN', 'ERROR') or 'scope' in str(d) or 'pairing' in str(d):
            print(lvl, msg)
    except: pass
"
```
