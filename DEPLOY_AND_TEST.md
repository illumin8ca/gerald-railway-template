# Quick Deploy & Test Guide

## 🎯 What Was Fixed

The Dashboard was deploying sites to the wrong directory (`/data/.openclaw/dashboard/data/sites/production`) while the Template was serving from `/data/workspace/site/production`. This caused all sites to show "Coming Soon" placeholders instead of actual content.

**Fix:** Dashboard now reads `OPENCLAW_WORKSPACE_DIR` and deploys to the same directory the Template serves from.

---

## ⚡ Quick Deploy Steps

### 1. Update Dashboard on Railway

The Dashboard has already been updated (commit `50efb0a`). Railway should auto-deploy from the main branch.

**If auto-deploy is disabled:**
```bash
# Trigger manual redeploy in Railway Dashboard
# or via Railway CLI:
railway up -d
```

**Verify Dashboard updated:**
1. Check Railway logs for: `[dashboard] ✓ auto-started`
2. Look for new path resolution messages in logs

### 2. Rebuild Solarwyse Site

Once Dashboard is running with the new code:

1. Go to Gerald Dashboard (https://gerald.andydoucet.com or gerald subdomain)
2. Navigate to **Site** section
3. Click **Deploy Production**
4. Wait for build to complete
5. Check build log for: `Output directory: /data/workspace/site/production`

### 3. Test Production Site

Visit https://solarwyse.ca

**Expected:** Actual Astro SSR site with full content  
**Not expected:** "Site coming soon" placeholder

### 4. Test Dev Site

Visit https://dev.solarwyse.ca

**Expected:** Development branch with live HMR  
**Not expected:** Empty directory or errors

---

## 🔍 Quick Verification Commands

If you have SSH access to Railway:

```bash
# Check production directory (should have site files)
ls -la /data/workspace/site/production/

# Check for SSR entry point
ls -la /data/workspace/site/production/server/entry.mjs

# Check processes (should see prod-server on 34567 for SSR sites)
ps aux | grep entry.mjs

# Check main server logs
tail -100 /var/log/gerald-railway-template.log
```

---

## ✅ Success Indicators

- [ ] Dashboard build logs show: `Output directory: /data/workspace/site/production`
- [ ] https://solarwyse.ca shows actual site content (not "Coming Soon")
- [ ] Railway logs show: `[prod-server] ✓ auto-started` (for SSR sites)
- [ ] https://dev.solarwyse.ca shows development version
- [ ] Files exist at: `/data/workspace/site/production/` on Railway

---

## 🚨 If Still Showing "Coming Soon"

### Check 1: Dashboard Updated?
```bash
# Check Dashboard commit on Railway
cd /data/.openclaw/dashboard && git log -1 --oneline
# Should show: 50efb0a Fix: Align Dashboard site paths
```

### Check 2: Site Rebuilt After Fix?
- Dashboard only uses new paths for NEW builds
- Old builds are still in old location
- **Solution:** Rebuild via Dashboard UI

### Check 3: Files in Right Place?
```bash
# Should have files:
ls /data/workspace/site/production/
# Should NOT be empty

# Old wrong location (should be ignored now):
ls /data/.openclaw/dashboard/data/sites/production/
```

### Check 4: SSR Server Running?
```bash
# For SSR sites, check if prod-server started:
ps aux | grep entry.mjs
# Should see: node server/entry.mjs (or dist/server/entry.mjs)
```

---

## 📚 Full Documentation

- **Detailed Analysis:** `PATH_MISMATCH_ANALYSIS.md`
- **Complete Fix Summary:** `FIX_SUMMARY.md`
- **This Quick Guide:** `DEPLOY_AND_TEST.md`

---

## 🎉 Expected Outcome

After deploying the Dashboard fix and rebuilding Solarwyse:

1. Production site shows actual Astro SSR content
2. Dev site shows development branch with HMR
3. SSR server handles dynamic routes correctly
4. No more "Coming Soon" placeholders
5. Dashboard and Template use same directory structure

**Estimated time:** 5-10 minutes (mostly waiting for build)
