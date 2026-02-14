# Gerald Railway Template - Path Mismatch Analysis

**Date:** 2026-02-13  
**Issue:** Solarwyse deployment showing "Coming Soon" instead of actual site

## Root Cause: Path Mismatch Between Dashboard and Template

### The Problem

The Gerald Dashboard and Gerald Railway Template use **completely different paths** for site deployment:

#### Dashboard Paths (WRONG):
```javascript
// In gerald-dashboard/server/routes/site.js line 274:
const outputPath = path.join(__dirname, '..', '..', 'data', 'sites', 'production');
// Resolves to: /data/.openclaw/dashboard/data/sites/production
```

#### Template Paths (CORRECT):
```javascript
// In gerald-railway-template/src/lib/constants.js:
export const PRODUCTION_DIR = path.join(WORKSPACE_DIR, 'site', 'production');
// Resolves to: /data/workspace/site/production
```

### What Happens

1. **Dashboard** clones/builds site → deploys to `/data/.openclaw/dashboard/data/sites/production`
2. **Template** serves production site → reads from `/data/workspace/site/production`
3. Template finds **empty directory** → shows placeholder "Coming Soon" HTML
4. Actual built site sits in Dashboard's directory, **never served**

## Solution: Align Dashboard to Use Template Paths

The Dashboard needs to:
1. Read `OPENCLAW_WORKSPACE_DIR` or `WORKSPACE_DIR` environment variables
2. Use `/data/workspace/site/production` instead of relative `__dirname` paths
3. Match the template's directory structure

## Files to Fix

### gerald-dashboard/server/routes/site.js
- Line 274: `POST /api/site/rebuild` - hardcoded `data/sites/production`
- Line 676: `POST /api/site/deploy` - hardcoded `data/sites/production`
- Need to add path resolution using env vars at top of file

### gerald-dashboard/server/lib/site-builder.js
- Already correct - takes outputDir as parameter
- No changes needed here

## Dev Server Analysis (NOT an issue)

The "too many dev servers" concern is a misunderstanding. Each server serves a distinct purpose:

| Port  | Service           | Purpose                                      | When Active           |
|-------|-------------------|----------------------------------------------|-----------------------|
| 8080  | Main Server       | Router/proxy (always needed)                 | Always                |
| 18789 | Gateway           | OpenClaw core (AI, tools, auth)              | After setup           |
| 3003  | Dashboard         | Management UI (site deploy, config, etc.)    | After setup           |
| 4321  | Dev Server        | Live dev with HMR (npm run dev)              | When dev site exists  |
| 34567 | Prod SSR Server   | SSR runtime for Astro/Next (node entry.mjs)  | SSR sites only        |

**Verdict:** This is the correct architecture. No simplification needed.

## SSR Detection Logic (CORRECT)

The template correctly detects SSR sites:

```javascript
// prod-server.js
export function isProdSSR() {
  return (
    fs.existsSync(path.join(PRODUCTION_DIR, "dist", "server", "entry.mjs")) ||
    fs.existsSync(path.join(PRODUCTION_DIR, "server", "entry.mjs"))
  );
}
```

After `cloneAndBuild()` moves dist contents to PRODUCTION_DIR:
- Entry is at: `/data/workspace/site/production/server/entry.mjs` ✓
- Second check finds it ✓
- SSR detection works correctly ✓

## Commits Required

1. **Dashboard**: Fix hardcoded paths in site.js (align to template paths)
2. **Template**: (Optional) Add env var to override site paths for flexibility

## Testing Plan

After fix:
1. Deploy Solarwyse via Dashboard
2. Verify files land in `/data/workspace/site/production/`
3. Check template serves actual site (not "Coming Soon")
4. Test SSR server starts and proxies correctly
5. Verify dev.solarwyse.ca serves dev branch with HMR
