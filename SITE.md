# SITE.md - Website Structure Documentation

This document describes the **Cass & Kathryn Morrow Marriage Coaching** website that runs on this Railway deployment.

---

## 🌐 Deployment Overview

### URLs
- **Production:** https://cassandkathryn.com
- **Development:** https://dev.cassandkathryn.com  
- **Gerald Dashboard:** https://gerald.cassandkathryn.com

### Repository
- **GitHub:** `illumin8ca/morrowmarriage-com`
- **Production Branch:** `main`
- **Development Branch:** `development`

### Railway Paths
- **Production (built output):** `/data/workspace/site/production/`
- **Development (full source):** `/data/workspace/site/dev/`
- **Workspace Root:** `/data/workspace/`
- **Config Files:** `/data/.openclaw/`

---

## 🏗️ Site Technology Stack

### Framework & Build Tools
- **Framework:** Astro 5.16.7 (Static Site Generation)
- **Styling:** Tailwind CSS 4.1.18 (utility-first)
- **UI Components:** Swiper.js 12.0.3 (carousels/sliders)
- **Language:** TypeScript (strict mode)
- **Build Tool:** Vite (via Astro)
- **Package Manager:** npm

### Architecture Type
**Static Site Generation (SSG)**
- All pages pre-rendered at build time
- No server-side rendering required
- Deployed as static HTML/CSS/JS files
- Fast page loads, excellent SEO

### Key Features
- **Zero JavaScript by default** - Astro ships minimal JS
- **Islands Architecture** - Interactive components only where needed
- **File-based Routing** - Each `.astro` file in `src/pages/` is a route
- **CDN Asset Delivery** - Images served from `media.morrowmarriage.com`
- **WebP Support** - Modern image formats with fallbacks
- **SEO Optimized** - Meta tags, structured data, sitemap
- **PWA Ready** - Web app manifest and icon set

---

## 📂 Site Directory Structure

```
morrowmarriage-com/
├── src/
│   ├── pages/                    # Routes (file-based routing)
│   │   ├── index.astro          # Homepage (/)
│   │   ├── 404.astro            # Not found page
│   │   └── _disabled/           # Disabled pages (not built)
│   │
│   ├── components/               # Reusable UI components (15 total)
│   │   ├── Header.astro         # Site header with mega menu
│   │   ├── Footer.astro         # Site footer
│   │   ├── Hero.astro           # Homepage hero section
│   │   ├── Button.astro         # Button component
│   │   ├── CookieBanner.astro   # GDPR cookie consent
│   │   ├── SuccessStoryCard.astro           # Testimonial card
│   │   ├── SuccessStoriesSection.astro      # Success stories section
│   │   ├── ProgramsSection.astro            # Programs section
│   │   ├── MediaSection.astro               # Press/media section
│   │   ├── LogoSlider.astro                 # Logo carousel
│   │   ├── FreeTrainingSection.astro        # Training CTA
│   │   ├── MarriageRestored.astro           # Restored marriages section
│   │   ├── DivorceStatistics.astro          # Stats section
│   │   ├── OptimizedImage.astro             # Image helper component
│   │   └── AGENTS.md            # Component development guide
│   │
│   ├── layouts/                  # Page layouts
│   │   ├── Layout.astro         # Base HTML layout (SEO, meta, fonts)
│   │   └── AGENTS.md            # Layout development guide
│   │
│   ├── data/                     # TypeScript data models
│   │   └── successStories.ts    # Success stories data with types
│   │
│   ├── config/                   # Configuration files
│   │   └── legal.ts             # Legal links config
│   │
│   ├── lib/                      # Utility functions
│   │   └── images.ts            # CDN image URL helpers
│   │
│   ├── styles/                   # Styling
│   │   ├── global.css           # Global styles + Tailwind directives
│   │   └── AGENTS.md            # Styling guide
│   │
│   └── assets/                   # Static assets (bundled)
│       └── fonts/               # Custom fonts (WOFF2)
│
├── public/                       # Static files (copied as-is to dist/)
│   ├── favicon.ico              # Legacy favicon
│   ├── icons/                   # Favicon set (8 sizes)
│   ├── site.webmanifest         # PWA manifest
│   ├── top-curved-white.svg     # Section divider SVG
│   ├── btm-curved-white.svg     # Section divider SVG
│   └── robots.txt               # SEO robots file
│
├── docs/                         # Project documentation
│   ├── 00-project-overview/
│   ├── 01-architecture/
│   ├── 02-setup-guides/
│   ├── 03-development/
│   ├── 06-deployment/
│   └── 08-user-guides/
│
├── seo/                          # SEO documentation
│   ├── pages/                   # Page-specific SEO specs
│   ├── keywords.md
│   └── competitive-strategy.md
│
├── astro.config.mjs             # Astro configuration
├── tailwind.config.mjs          # Tailwind configuration
├── tsconfig.json                # TypeScript configuration
├── package.json                 # Dependencies & scripts
└── README.md                    # Project overview
```

---

## 🎨 Styling System

### Tailwind CSS
**Primary styling method** - utility-first CSS framework

**Brand Colors:**
```javascript
{
  'brand-black': '#000000',
  'brand-white': '#FFFFFF',
  'brand-yellow': '#EECC00',          // Main accent
  'brand-yellow-light': '#FFFBE5',    // Light backgrounds
  'brand-red': '#E61E1E',             // Men's program accent
  'brand-red-dark': '#C41919',
}
```

**Typography:**
- **Body Font:** Manrope (400, 500, 600, 700) - Modern sans-serif
- **Display Font:** Playfair Display - Elegant serif for headings
- Loaded from Google Fonts in `Layout.astro`

**Utility Classes Used:**
- `bg-black`, `text-white` - Brand black/white
- `bg-[#EECC00]` - Brand yellow (custom color)
- `py-20` - Consistent section spacing
- `container mx-auto px-4` - Centered content container
- `font-serif` - Playfair Display headings
- `font-sans` - Manrope body text

### Custom CSS
**Location:** `src/styles/global.css`

**Contains:**
- Tailwind directives (`@tailwind base`, `components`, `utilities`)
- Custom animations (fade-in, slide-up, etc.)
- Scroll animation classes (`[data-animate]`)
- Global resets and base styles
- Custom component styles

### Design System
- **White backgrounds** - Modern, clean sections
- **Curved dividers** - SVG curves between sections (`top-curved-white.svg`, `btm-curved-white.svg`)
- **High contrast** - Black text on white, white text on black
- **Yellow accents** - CTAs, highlights, borders
- **Scroll animations** - Elements fade/slide in on scroll

---

## 📄 Page Structure & Routing

### File-Based Routing
Astro uses file-based routing - each `.astro` file in `src/pages/` becomes a route:

```
src/pages/index.astro    →  https://cassandkathryn.com/
src/pages/404.astro      →  404 Not Found page
src/pages/about.astro    →  https://cassandkathryn.com/about
```

### Current Pages
- **Homepage:** `src/pages/index.astro`
- **404 Page:** `src/pages/404.astro`
- **Disabled Pages:** `src/pages/_disabled/` (prefixed with `_` = not built)

### Homepage Sections (in order)
1. **Header** - Navigation with mega menu
2. **Hero** - Main headline + CTA
3. **Success Stories** - Audio testimonials carousel
4. **Programs** - Men's & Women's programs
5. **Media** - Logo slider (press mentions)
6. **Free Training** - Lead magnet CTA
7. **Marriage Restored** - Statistics & transformation
8. **Divorce Statistics** - Problem awareness
9. **Footer** - Links, social, legal

---

## 🔧 How to Edit Pages

### On Railway (Direct Editing)
1. **SSH into Railway:**
   ```bash
   railway ssh
   ```

2. **Navigate to dev site:**
   ```bash
   cd /data/workspace/site/dev/
   ```

3. **Edit files:**
   - Pages: `/data/workspace/site/dev/src/pages/`
   - Components: `/data/workspace/site/dev/src/components/`
   - Styles: `/data/workspace/site/dev/src/styles/global.css`

4. **Dev server auto-reloads** - Changes appear immediately at https://dev.cassandkathryn.com

### From Gerald on Railway
When you're running as Gerald on Railway, the site code is at:
- **Dev:** `/data/workspace/site/dev/`
- **Production:** `/data/workspace/site/production/` (built output only)

Use standard file tools:
```bash
cd /data/workspace/site/dev/src/pages
# Edit index.astro, etc.
```

### Via Git (Recommended for Major Changes)
1. **Clone locally:**
   ```bash
   git clone git@github.com:illumin8ca/morrowmarriage-com.git
   cd morrowmarriage-com
   ```

2. **Make changes locally**

3. **Test locally:**
   ```bash
   npm install
   npm run dev
   # Visit http://localhost:4321
   ```

4. **Push to development branch:**
   ```bash
   git add .
   git commit -m "feat: update homepage hero"
   git push origin development
   ```

5. **Trigger rebuild on Railway** (webhook or dashboard)

6. **Merge to main** when ready for production

---

## ➕ How to Add New Pages

### 1. Create the Page File
```bash
# On Railway:
cd /data/workspace/site/dev/src/pages
touch about.astro
```

### 2. Page Template
```astro
---
import Layout from "../layouts/Layout.astro";
import Header from "../components/Header.astro";
import Footer from "../components/Footer.astro";

const title = "About Us - Morrow Marriage";
const description = "Learn about Cass & Kathryn Morrow and our marriage coaching programs.";
---

<Layout title={title} description={description}>
  <Header />
  
  <main class="bg-white">
    <section class="py-20 container mx-auto px-4">
      <h1 class="text-5xl font-serif text-black mb-8">About Us</h1>
      <p class="text-xl text-gray-700">
        Content here...
      </p>
    </section>
  </main>
  
  <Footer />
</Layout>
```

### 3. Add to Navigation
Edit `src/components/Header.astro` to add the new page to the menu.

### 4. Test
Visit https://dev.cassandkathryn.com/about (dev server auto-includes it)

### 5. Deploy
- **Dev:** Already live (auto-reloads)
- **Production:** Commit to `development`, merge to `main`, trigger rebuild

---

## 🚀 Dev Server

### Starting the Dev Server
On Railway, the dev server runs automatically:
```bash
npm run dev
```

**Default Port:** 4321  
**Dev URL:** https://dev.cassandkathryn.com

### Dev Server Features
- **Hot Module Replacement (HMR)** - Changes appear instantly
- **Watches all files** - Pages, components, styles, data
- **TypeScript checking** - Errors shown in console
- **Fast Refresh** - Preserves component state where possible

### Dev Server Location
- **Process:** Started by OpenClaw on Railway
- **Port:** 4321 (internal)
- **Reverse Proxy:** Nginx routes `dev.cassandkathryn.com` → `localhost:4321`

---

## 🏗️ Build Process

### Production Build
```bash
npm run build
```

**What happens:**
1. Astro compiles `.astro` files to HTML
2. TypeScript compiled to JavaScript
3. Tailwind CSS purged (only used classes)
4. Assets optimized and fingerprinted
5. Output written to `dist/`

**Build Output:** `/data/workspace/site/production/` on Railway

### Build Configuration
**File:** `astro.config.mjs`

```javascript
export default defineConfig({
  site: 'https://morrowmarriage.com',
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
    }),
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
```

**Key Settings:**
- `site` - Base URL (for sitemap, canonical URLs)
- `integrations` - Sitemap plugin for SEO
- `vite.plugins` - Tailwind CSS via Vite

### Build Artifacts
```
dist/
├── index.html           # Homepage
├── 404.html             # Not found page
├── _astro/              # JS, CSS bundles (fingerprinted)
├── icons/               # Favicons (copied from public/)
├── sitemap-index.xml    # Sitemap for SEO
├── robots.txt           # Robots file
└── ...                  # Other static assets
```

---

## 🔄 Rebuild Webhook

### Trigger Rebuild
**POST** `https://cassandkathryn.com/api/rebuild-workspace`

**Purpose:** Pull latest code from GitHub and rebuild the site

**What it does:**
1. Pulls latest commits from `main` (production) or `development` (dev)
2. Runs `npm install` (if package.json changed)
3. Runs `npm run build` (for production)
4. Restarts dev server (for development)

**Authentication:** 
- Protected by Railway environment variable
- Check OpenClaw config for exact endpoint/auth

### Rebuild from Dashboard
**URL:** https://gerald.cassandkathryn.com  
Look for "Rebuild Site" button or similar interface

---

## 🧩 Special Components & Patterns

### OptimizedImage Component
**Purpose:** Load images from CDN with WebP support

**Location:** `src/components/OptimizedImage.astro`

**Usage:**
```astro
<OptimizedImage 
  src="/path/to/image.jpg"
  alt="Descriptive alt text"
  width={800}
  height={600}
/>
```

**Features:**
- Serves from `media.morrowmarriage.com` (Cloudflare R2)
- Automatic WebP format with fallback
- Lazy loading built-in
- SEO-optimized alt tags

### CookieBanner Component
**Purpose:** GDPR/CCPA cookie consent

**Location:** `src/components/CookieBanner.astro`

**Features:**
- Appears on first visit
- "Accept All" / "Reject All" / "Customize" options
- Stores preference in localStorage
- Manages Google Analytics based on consent

### Scroll Animations
**Pattern:** `[data-animate]` attribute + IntersectionObserver

**Usage:**
```astro
<div data-animate data-delay="200">
  <!-- Content animates in on scroll -->
</div>
```

**Implementation:** `src/layouts/Layout.astro` (scroll script)

**Classes:**
- `data-animate` - Marks element for animation
- `data-delay` - Delay in milliseconds (optional)
- `.animate-visible` - Applied when element enters viewport

---

## 📦 Dependencies

### Production Dependencies
```json
{
  "@astrojs/sitemap": "^3.7.0",        // SEO sitemap generation
  "@aws-sdk/client-s3": "^3.913.0",    // Image upload to R2
  "@sendgrid/mail": "^8.1.6",          // Email sending (forms)
  "@tailwindcss/vite": "^4.1.18",      // Tailwind CSS integration
  "astro": "^5.16.7",                  // Framework
  "swiper": "^12.0.3",                 // Carousels
  "tailwindcss": "^4.1.18"             // Styling
}
```

### Dev Dependencies
```json
{
  "@playwright/test": "^1.58.0",       // E2E testing
  "tsx": "^4.20.6",                    // TypeScript execution
  "@types/node": "^22.0.0"             // Node.js types
}
```

### Scripts
```json
{
  "dev": "astro dev",                  // Start dev server
  "build": "astro build",              // Build for production
  "preview": "astro preview",          // Preview prod build
  "astro": "astro",                    // Run Astro CLI
  "upload-images": "tsx scripts/upload-images-to-r2.ts"
}
```

---

## 🐛 Common Issues & Solutions

### Issue: Dev server won't start
**Solution:**
```bash
cd /data/workspace/site/dev
rm -rf node_modules
npm install
npm run dev
```

### Issue: Changes not appearing
**Solution:**
- Check you're editing the right file (dev vs production)
- Hard refresh browser: Ctrl+Shift+R / Cmd+Shift+R
- Check dev server is running: `ps aux | grep astro`
- Restart dev server: `pkill -f "astro dev" && npm run dev`

### Issue: Build fails
**Solution:**
```bash
# Check TypeScript errors
npm run astro check

# Verbose build output
npm run build -- --verbose
```

### Issue: Images not loading
**Common causes:**
- CDN URL wrong (check `src/lib/images.ts`)
- Image file missing from R2
- CORS issue (check Cloudflare R2 CORS settings)

**Debug:**
```bash
# Check image URL in browser
curl -I https://media.morrowmarriage.com/path/to/image.webp
```

### Issue: Styles not updating
**Solution:**
- Clear browser cache
- Check Tailwind config: `tailwind.config.mjs`
- Restart dev server
- Hard refresh: Cmd+Shift+R / Ctrl+Shift+R

---

## 📚 Additional Resources

### Documentation Files
- **`README.md`** - Project overview and quick start
- **`AGENTS.md`** - AI agent development guide (root + per-directory)
- **`docs/`** - Comprehensive documentation (architecture, guides, etc.)
- **`seo/`** - SEO strategy and page specs

### External Resources
- **Astro Docs:** https://docs.astro.build/
- **Tailwind CSS Docs:** https://tailwindcss.com/docs
- **TypeScript Docs:** https://www.typescriptlang.org/docs/
- **Swiper.js Docs:** https://swiperjs.com/

### Key Concepts
- **File-based Routing:** Each file in `src/pages/` = route
- **Component Props:** Pass data via TypeScript interfaces
- **Layouts:** Wrap pages with common structure (header, footer, meta)
- **Static Site Generation:** Pre-rendered at build time, not runtime
- **Islands Architecture:** Minimal JS, interactive components only where needed

---

## ✅ Status Check

**Check site is running:**
```bash
curl https://cassandkathryn.com/status
# or
curl https://dev.cassandkathryn.com/status
```

**Expected response:** `200 OK` or similar health check

---

## 🎯 Quick Reference

### Edit homepage hero section
```bash
# On Railway:
cd /data/workspace/site/dev/src/components
# Edit Hero.astro
```

### Edit footer links
```bash
cd /data/workspace/site/dev/src/components
# Edit Footer.astro
```

### Change site colors
```bash
cd /data/workspace/site/dev
# Edit tailwind.config.mjs (colors section)
# Edit src/styles/global.css (custom styles)
```

### Add new component
```bash
cd /data/workspace/site/dev/src/components
touch NewComponent.astro
# See "How to Add New Pages" section for template
```

### Rebuild production site
```bash
cd /data/workspace/site/production
git pull origin main
npm install
npm run build
# Or: POST to /api/rebuild-workspace
```

---

**Last Updated:** 2026-02-05  
**Maintained By:** Gerald (OpenClaw Agent on Railway)
