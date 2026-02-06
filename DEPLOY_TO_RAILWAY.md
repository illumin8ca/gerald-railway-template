# Deploy to Railway - One-Click Guide

## ⚠️ Important: Volume Configuration

**If deploying from the official Railway Template:** Volume is auto-created ✅

**If deploying directly from GitHub:** Volume must be added manually ⚠️

---

## Deploying from Official Template (Recommended)

Click the "Deploy to Railway" button → Volume is automatically created and mounted to `/data` ✅

Then skip to **Step 3: Run Setup Wizard** below.

---

## Deploying from GitHub (Manual Setup Required)

If you're deploying directly from the GitHub repo (not using the Railway Template), you have 2 options:

---

## Option 1: Automated Script (Recommended)

**After deploying the template:**

```bash
# Install Railway CLI (if not already installed)
npm i -g @railway/cli

# Login to Railway
railway login

# Link to your deployed service
railway link

# Run the setup script (creates volume automatically)
chmod +x railway-setup.sh
./railway-setup.sh
```

This script will:
- ✅ Create a 1GB persistent volume
- ✅ Mount it to `/data`
- ✅ Verify it's configured correctly

---

## Option 2: Manual Setup (Railway Dashboard)

### Step 1: Deploy from Template
1. Click "Deploy on Railway" button
2. Wait for deployment to complete
3. Note your service URL: `https://your-service.railway.app`

### Step 2: Add Persistent Volume
1. Go to Railway dashboard
2. Open your deployed service
3. Click **Settings** → **Volumes**
4. Click **"New Volume"**
5. Configure:
   - **Name:** `gerald-data` (or anything)
   - **Mount Path:** `/data`
   - **Size:** 1 GB (minimum)
6. Click **"Add"**
7. Railway will restart your service automatically

### Step 3: Add Environment Variables (if not auto-set)

Go to **Variables** tab and add:

```bash
SETUP_PASSWORD = <your-secure-password>
DEFAULT_MODEL = moonshot/kimi-k2.5
MOONSHOT_API_KEY = sk-WSQeH5T6ZNBqxvfiONEfK5ERSLyNZrSOIoJlFSu8PAOWJP3O
CLIENT_DOMAIN = yourdomain.com
CLOUDFLARE_API_KEY = <your-key>
CLOUDFLARE_EMAIL = <your-email>
```

### Step 4: Run Setup Wizard
1. Visit `https://your-service.railway.app/setup`
2. Enter your `SETUP_PASSWORD`
3. Complete the wizard
4. Done! Configuration persists forever now

---

## Why Isn't This Automatic?

Railway's platform **does not support** defining volumes in:
- `railway.toml`
- `railway.json`
- `Dockerfile`
- Any config file

Volumes **must** be created via:
- Railway Dashboard UI ✅
- Railway CLI ✅
- Railway API ✅

This is a Railway platform limitation, not a template issue.

---

## Verification

After adding the volume, check:

```bash
curl https://your-service.railway.app/setup/diagnostic
```

Look for:
```json
{
  "volume": {
    "warning": "Volume appears persistent (last run: Xh ago)",
    "recommendation": null
  },
  "stateDirExists": true
}
```

If you see `"recommendation": "Add a persistent volume..."` → volume not mounted correctly.

---

## Troubleshooting

### "I keep having to run setup after every deploy"
→ Volume not created or not mounted to `/data`

### "Volume already exists" error
→ Good! Just continue to the next step

### "Permission denied" when creating volume
→ Make sure you've run `railway link` to connect to your service

### Setup completes but configuration doesn't persist
→ Check volume mount path is exactly `/data` (case-sensitive)

---

## One-Line Deploy + Setup (Railway CLI)

```bash
# Deploy and setup in one go
railway up && \
railway volume add --name gerald-data --mount-path /data && \
railway open
```

Then visit the URL and complete the setup wizard.
