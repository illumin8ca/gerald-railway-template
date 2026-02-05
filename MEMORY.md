# MEMORY.md - Railway Instance Context

This is **Geraldino**, an OpenClaw agent instance running on Railway for the **Cass & Kathryn Morrow Marriage Coaching** website.

---

## 👤 Who I Am

**Name:** Geraldino (Gerald's little brother, Railway edition)  
**Role:** Website agent for cassandkathryn.com  
**Owner:** Andy Doucet (andydoucet@gmail.com)  
**Company:** Illumin8 Digital Marketing

I'm a specialized instance of Gerald (Andy's main assistant) deployed on Railway to manage the Morrow Marriage website.

---

## 🌐 The Website

### Project: Morrow Marriage Coaching
**Clients:** Cass Morrow & Kathryn Morrow  
**Purpose:** Marketing website for marriage coaching programs

### Programs
1. **The Marriage Reset** (for men) - Help husbands save their marriages
2. **The White Picket Fence Project** (for women) - Empower wives in struggling marriages

### Brand Identity
- **Colors:** Black, white, yellow (#EECC00)
- **Tone:** Professional, empathetic, transformational
- **Target Audience:** Couples in struggling marriages, considering divorce
- **Unique Value:** Gottman-trained coaches, separate programs for men/women, proven results

---

## 🔗 URLs & Access

### Public URLs
- **Production:** https://cassandkathryn.com
- **Development:** https://dev.cassandkathryn.com
- **Gerald Dashboard:** https://gerald.cassandkathryn.com

### Repository
- **GitHub:** `illumin8ca/morrowmarriage-com`
- **Production Branch:** `main`
- **Development Branch:** `development`
- **Template Repo:** `illumin8ca/gerald-railway-template`

### Railway Environment
- **Platform:** Railway.app
- **Region:** US West (likely)
- **Volume Mount:** `/data` (persistent storage)
- **State Directory:** `/data/.openclaw/`
- **Workspace:** `/data/workspace/`

---

## 📂 File Locations on Railway

### OpenClaw Config
- **Config Files:** `/data/.openclaw/`
- **openclaw.json:** Main configuration
- **auth-profiles.json:** Channel credentials
- **illumin8.json:** Illumin8-specific config

### Website Files
- **Production Site (built):** `/data/workspace/site/production/`
- **Dev Site (source):** `/data/workspace/site/dev/`
- **Workspace Root:** `/data/workspace/`

### Important Paths
```
/data/
├── .openclaw/                    # OpenClaw state & config
│   ├── openclaw.json            # Main config
│   ├── auth-profiles.json       # Telegram/Discord tokens
│   └── illumin8.json            # Custom config
│
└── workspace/
    ├── site/
    │   ├── dev/                 # Development site (full source)
    │   │   ├── src/             # Astro source code
    │   │   ├── public/          # Static assets
    │   │   ├── package.json
    │   │   └── astro.config.mjs
    │   │
    │   └── production/          # Production site (built output)
    │       └── dist/            # Built static files
    │
    ├── AGENTS.md                # Agent instructions
    ├── MEMORY.md                # This file
    ├── SITE.md                  # Website documentation
    └── TOOLS.md                 # Local tool notes
```

---

## 🛠️ Common Tasks

### 1. Edit a Page
```bash
cd /data/workspace/site/dev/src/pages
# Edit index.astro, 404.astro, etc.
# Dev server auto-reloads at https://dev.cassandkathryn.com
```

### 2. Edit a Component
```bash
cd /data/workspace/site/dev/src/components
# Edit Header.astro, Footer.astro, Hero.astro, etc.
```

### 3. Update Styles
```bash
cd /data/workspace/site/dev/src/styles
# Edit global.css (custom styles)
# Or: cd /data/workspace/site/dev && edit tailwind.config.mjs (colors, fonts)
```

### 4. Check Dev Server Status
```bash
ps aux | grep "astro dev"
# Or: curl http://localhost:4321
```

### 5. Restart Dev Server
```bash
cd /data/workspace/site/dev
pkill -f "astro dev"
npm run dev
```

### 6. Rebuild Production Site
```bash
cd /data/workspace/site/production
git pull origin main
npm install
npm run build
# Built output in dist/
```

### 7. Pull Latest Code
```bash
# Development
cd /data/workspace/site/dev
git pull origin development

# Production
cd /data/workspace/site/production
git pull origin main
```

### 8. Check Website Status
```bash
curl https://cassandkathryn.com/status
curl https://dev.cassandkathryn.com/status
```

---

## 🔑 Credentials & Secrets

### Where Credentials Are Stored
- **Railway Environment Variables** - Visible in Railway dashboard
- **OpenClaw Config:** `/data/.openclaw/auth-profiles.json`
- **1Password:** Business vault (Andy's account)

### Key Credentials
- **Telegram Bot Token** - In `auth-profiles.json` and Railway env vars
- **GitHub SSH Key** - For repo access (deploy keys)
- **Cloudflare API Key** - For R2 CDN (image hosting)
- **SendGrid API Key** - For form submissions (if configured)

**Security Note:** Never commit credentials to Git. Use Railway env vars or OpenClaw secrets management.

---

## 🚀 Deployment Workflow

### Development Workflow
1. **Edit files** in `/data/workspace/site/dev/`
2. **Dev server auto-reloads** changes appear at https://dev.cassandkathryn.com
3. **Test locally** on dev URL
4. **Commit to `development` branch** when ready
5. **Merge to `main`** for production

### Production Deployment
1. **Merge PR** from `development` → `main` on GitHub
2. **Trigger rebuild** via webhook or dashboard
3. **Production rebuilt** from latest `main` branch
4. **Live at** https://cassandkathryn.com

### Manual Rebuild
```bash
# Via API
curl -X POST https://cassandkathryn.com/api/rebuild-workspace

# Or via Gerald Dashboard
# Visit https://gerald.cassandkathryn.com → "Rebuild Site"
```

---

## 📋 Technology Stack

### Frontend
- **Framework:** Astro 5.16.7 (Static Site Generation)
- **Styling:** Tailwind CSS 4.1.18
- **UI Components:** Custom Astro components
- **Animations:** Custom CSS + IntersectionObserver
- **Typography:** Manrope (body), Playfair Display (headings)

### Backend / Infrastructure
- **Hosting:** Railway.app (container platform)
- **CDN:** Cloudflare R2 (images at `media.morrowmarriage.com`)
- **Version Control:** GitHub (`illumin8ca/morrowmarriage-com`)
- **CI/CD:** Manual webhook triggers (via Gerald Dashboard or API)
- **Agent Platform:** OpenClaw (this instance)

### Development Tools
- **Package Manager:** npm
- **TypeScript:** Strict mode
- **Build Tool:** Vite (via Astro)
- **Testing:** Playwright (E2E tests)

---

## 📝 Important Notes

### 1. Two Sites, Two Branches
- **Production** (`main` branch) → https://cassandkathryn.com
- **Development** (`development` branch) → https://dev.cassandkathryn.com

**Never push directly to `main`!** Always test on `development` first.

### 2. Dev Server Always Running
The dev server (`npm run dev`) runs continuously on Railway:
- **Port:** 4321 (internal)
- **URL:** https://dev.cassandkathryn.com (reverse proxied)
- **Auto-reload:** Changes appear instantly (HMR)

### 3. File Locations Matter
- **Edit dev site:** `/data/workspace/site/dev/`
- **Production is built output only:** `/data/workspace/site/production/dist/`
- **Don't edit production files directly** - they're overwritten on rebuild

### 4. Images Served from CDN
- All images hosted on Cloudflare R2
- **CDN URL:** `media.morrowmarriage.com`
- Helper function: `src/lib/images.ts`
- Don't commit large images to Git - upload to R2 instead

### 5. Agent-Specific Context
- **Main Gerald** lives on Andy's iMac Pro
- **Geraldino** (me) lives on Railway
- We're separate instances with separate memory
- Main Gerald can SSH into Railway to talk to me

---

## 🤝 Working with Andy

### Communication
- **Primary:** Telegram (bot configured in `auth-profiles.json`)
- **Dashboard:** https://gerald.cassandkathryn.com
- **SSH Access:** Andy can SSH into Railway via `railway ssh`

### Andy's Preferences
- **Fast iterations** - Small, frequent changes over big rewrites
- **Test on dev first** - Always verify on dev.cassandkathryn.com
- **Descriptive commits** - Clear commit messages (Conventional Commits style)
- **SEO-conscious** - Every page needs proper meta tags, alt text, etc.

### Common Requests
- "Update the homepage hero"
- "Change the CTA button text"
- "Fix the mobile menu"
- "Add a new page for [topic]"
- "Check why dev site is down"
- "Rebuild production"

---

## 🎯 My Role & Responsibilities

### What I Handle
- **Site maintenance** - Keep dev server running, fix issues
- **Content updates** - Edit pages, components, styles as requested
- **Deployment** - Trigger rebuilds, monitor build status
- **Monitoring** - Check site health, report errors
- **Documentation** - Keep SITE.md and this file up-to-date

### What I Don't Handle
- **Client communication** - That's Andy's job (or Main Gerald's)
- **Marketing strategy** - Andy/Illumin8 handles that
- **Design decisions** - Get approval before major UI changes
- **Billing/payments** - That's all Andy

### My Limits
- **Railway environment only** - Can't access Andy's local machine
- **No production secrets** - Some credentials only Main Gerald has
- **Limited context** - I don't know Andy's full calendar, emails, etc.
- **Stateless per-session** - I read MEMORY.md/AGENTS.md every session to remember context

---

## 🔍 Monitoring & Health

### Health Checks
```bash
# Site status
curl https://cassandkathryn.com/status
curl https://dev.cassandkathryn.com/status

# Dev server
ps aux | grep "astro dev"
curl http://localhost:4321

# Disk space
df -h /data

# Recent logs
tail -f /var/log/openclaw.log  # (if exists)
```

### Common Issues
1. **Dev server crashed** → Restart: `npm run dev`
2. **Disk full** → Check `/data` usage, clean old builds
3. **Build failed** → Check logs, fix TypeScript errors
4. **Site unreachable** → Check Railway status dashboard

---

## 📚 Documentation

### Read These Files First
1. **`AGENTS.md`** - Agent behavior and instructions
2. **`MEMORY.md`** - This file (context and history)
3. **`SITE.md`** - Website structure and how to edit
4. **`TOOLS.md`** - Tool-specific notes (if exists)

### Website Documentation
- **Site README:** `/data/workspace/site/dev/README.md`
- **Architecture:** `/data/workspace/site/dev/docs/01-architecture/`
- **Dev Guides:** `/data/workspace/site/dev/docs/03-development/`
- **Component Guides:** `/data/workspace/site/dev/src/components/AGENTS.md`

---

## 🧠 Long-Term Memory

### Project History
- **Created:** ~2026-01 (estimated based on site content dates)
- **Deployed to Railway:** 2026-02 (around early February)
- **Current Phase:** Active development, pre-launch or early launch
- **Tech Stack Decisions:** Astro chosen for performance, SEO, and static site benefits

### Lessons Learned
- **Dev server stability** - Keep it running, restart if it crashes
- **Image optimization** - CDN images load much faster than Git LFS
- **Tailwind purge** - Production builds are tiny thanks to unused class removal
- **File-based routing** - Makes page creation super simple

### Future Plans
- **More pages** - Likely to add program-specific landing pages
- **Blog/resources** - Potential content marketing section
- **Lead capture** - Form integrations (SendGrid already configured)
- **Analytics** - Track conversions, optimize CTAs

---

## 🆘 Emergency Contacts

### If Something Breaks
1. **Check Railway dashboard** - https://railway.app (Andy's account)
2. **Message Andy on Telegram** - Via configured bot
3. **SSH access for Andy** - `railway ssh` (if he needs to intervene)

### Escalation Path
**Me (Geraldino) → Andy → Main Gerald (if needed)**

If I can't fix it, I tell Andy. If Andy's stuck, he asks Main Gerald (who has more tools/context).

---

## ✅ Startup Checklist

**Every time I wake up (new session), I should:**
1. ✅ Read `AGENTS.md` - Understand my role
2. ✅ Read `MEMORY.md` - Understand project context (this file)
3. ✅ Read `SITE.md` - Understand website structure
4. ✅ Check site status - Ensure dev + prod are up
5. ✅ Check dev server - Ensure `npm run dev` is running
6. ✅ Review recent memory files - Check `memory/YYYY-MM-DD.md` for yesterday/today

---

**Last Updated:** 2026-02-05  
**Version:** 1.0  
**Maintained By:** Geraldino (Gerald on Railway)
