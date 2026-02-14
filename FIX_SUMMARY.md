# Gerald Railway Template - Fix Summary

**Date:** 2026-02-13  
**Issue:** Solarwyse deployment showing "Coming Soon" instead of actual site

## ✅ Root Cause Identified

**Path Mismatch Between Dashboard and Template**

The Dashboard was deploying sites to a different directory than where the template serves them from:

- **Dashboard deployed to:** `/data/.openclaw/dashboard/data/sites/production` ❌
- **Template serves from:** `/data/workspace/site/production` ✅

Result: Template served from empty directory → showed placeholder "Coming Soon" HTML

## ✅ Fixes Applied

### 1. Gerald Dashboard (illumin8ca/gerald-dashboard)

**Commit:** `50efb0a` - "Fix: Align Dashboard site paths with Railway Template"

**Changes:**
- Added `getWorkspaceDirs()` helper function to read paths from environment
- Replaced all hardcoded `__dirname` based paths with environment-based paths
- Now reads `OPENCLAW_WORKSPACE_DIR` or `WORKSPACE_DIR` (set by template wrapper)
- Defaults to `/data/workspace` if not set

**Files Modified:**
- `server/routes/site.js` - All deployment endpoints now use correct paths

**Affected Endpoints:**
- `POST /api/site/rebuild` - Manual site rebuild
- `POST /api/site/deploy-production` - Deploy from production branch
- `POST /api/site/clone-repo` - Initial repository clone
- `POST /api/site/disconnect-repo` - Workspace cleanup

### 2. Gerald Railway Template (illumin8ca/gerald-railway-template)

**Commit:** `dd0580f` - "docs: Add path mismatch analysis and fix documentation"

**Changes:**
- Added comprehensive analysis document (`PATH_MISMATCH_ANALYSIS.md`)
- Documented that dev server architecture is correct (not "too many servers")
- Each server serves a distinct purpose and is necessary

**No code changes needed** - Template paths were already correct!

## 🎯 Testing Checklist

After deploying the fixed Dashboard to Railway:

1. **Deploy Solarwyse via Dashboard:**
   - Go to Dashboard → Site → Deploy Production
   - Wait for build to complete
   - Check logs for: `Output directory: /data/workspace/site/production`

2. **Verify Production Site:**
   - Visit https://solarwyse.ca
   - Should show actual Astro SSR site (not "Coming Soon")
   - Check for proper navigation, content, forms

3. **Verify SSR Server:**
   - Check Railway logs for: `[prod-server] ✓ auto-started`
   - Should proxy to port 34567 for SSR runtime
   - Visit site and check for server-side features (if any)

4. **Verify Dev Site:**
   - Visit https://dev.solarwyse.ca
   - Should show development branch with live HMR
   - Make a test edit, push to dev branch
   - Site should auto-rebuild and update

5. **Check File Structure on Railway:**
   ```bash
   ls -la /data/workspace/site/production/
   # Should show: server/, client/, _astro/, etc. (Astro SSR output)
   
   ls -la /data/workspace/site/dev/
   # Should show: src/, package.json, astro.config.mjs, etc. (Source code)
   ```

## 📊 Architecture Validation

The "too many dev servers" concern was investigated and found to be **not an issue**.

Each server serves a distinct purpose:

| Port  | Service           | Purpose                                      | When Active           |
|-------|-------------------|----------------------------------------------|-----------------------|
| 8080  | Main Server       | Router/proxy (always needed)                 | Always                |
| 18789 | Gateway           | OpenClaw core (AI, tools, auth)              | After setup           |
| 3003  | Dashboard         | Management UI (site deploy, config, etc.)    | After setup           |
| 4321  | Dev Server        | Live dev with HMR (`npm run dev`)            | When dev site exists  |
| 34567 | Prod SSR Server   | SSR runtime for Astro/Next (node entry.mjs)  | SSR sites only        |

**Verdict:** This is the correct architecture. No simplification needed.

## 🔍 Related Files Reference

### Template Constants
`src/lib/constants.js`:
```javascript
export const PRODUCTION_DIR = path.join(WORKSPACE_DIR, 'site', 'production');
export const DEV_DIR = path.join(WORKSPACE_DIR, 'site', 'dev');
```

### Dashboard Path Resolution (NEW)
`server/routes/site.js`:
```javascript
function getWorkspaceDirs() {
  const workspaceDir = process.env.OPENCLAW_WORKSPACE_DIR || 
                       process.env.WORKSPACE_DIR || 
                       '/data/workspace';
  const siteDir = path.join(workspaceDir, 'site');
  
  return {
    production: path.join(siteDir, 'production'),
    dev: path.join(siteDir, 'dev'),
    workspace: workspaceDir,
    site: siteDir
  };
}
```

### Template Sets Environment
`src/lib/dashboard.js` (startDashboard function):
```javascript
env: {
  ...process.env,
  OPENCLAW_WORKSPACE_DIR: WORKSPACE_DIR, // ← Dashboard reads this
  // ... other env vars
}
```

## 🚀 Deployment Steps

1. **Dashboard Update** (automatic on Railway):
   - Railway auto-deploys from main branch
   - New commit `50efb0a` will be deployed on next push/redeploy
   - Dashboard will restart and use correct paths

2. **Template Update** (automatic on Railway):
   - Template commit `dd0580f` is documentation only
   - No code changes, so no redeploy needed
   - But existing deployments will benefit from Dashboard fix

3. **Verify After Deploy:**
   - Check Dashboard logs for new path resolution messages
   - Rebuild Solarwyse site via Dashboard
   - Visit https://solarwyse.ca to confirm fix

## 📝 Notes for Future

- **Path alignment is critical** - Dashboard and Template must use same directories
- **Environment variables provide flexibility** - Can override paths if needed
- **SSR detection works correctly** - No changes needed to prod-server.js logic
- **Dev server architecture is sound** - Each process has a purpose

## ❓ If Site Still Shows "Coming Soon"

Possible causes:

1. **Dashboard not updated:** Check Railway for latest commit `50efb0a`
2. **Site not rebuilt:** Rebuild via Dashboard → Site → Deploy Production
3. **Files in wrong location:** SSH to Railway and check `/data/workspace/site/production/`
4. **SSR server failed:** Check logs for `[prod-server]` errors
5. **Domain routing issue:** Check `getClientDomain()` in template config

Debug commands for Railway SSH:
```bash
# Check workspace structure
ls -la /data/workspace/site/

# Check production files
ls -la /data/workspace/site/production/
cat /data/workspace/site/production/server/entry.mjs | head -20

# Check processes
ps aux | grep node

# Check Dashboard build logs
tail -100 /data/.openclaw/dashboard/data/logs/build.log
```

## ✅ Success Criteria

Fix is successful when:
- [ ] Dashboard deploys to `/data/workspace/site/production/`
- [ ] Template serves from `/data/workspace/site/production/`
- [ ] https://solarwyse.ca shows actual Astro SSR site
- [ ] SSR server runs on port 34567 and proxies correctly
- [ ] https://dev.solarwyse.ca shows dev branch with HMR
- [ ] No "Coming Soon" placeholder on production site
