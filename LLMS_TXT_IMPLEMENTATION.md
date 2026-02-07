# llms.txt Implementation for cassandkathryn.com

## Overview

Added support for the [llms.txt specification](https://llmstxt.org/) to the openclaw-railway-template, specifically tailored for the Cass & Kathryn marriage coaching site (cassandkathryn.com / Morrow Marriage LLC).

## What Was Implemented

### 1. `/llms.txt` (Standard Format)

**Location:** Served dynamically at `https://cassandkathryn.com/llms.txt`

**Purpose:** Provides LLMs with a concise overview of the site, following the llms.txt spec:
- H1 title: "Cass & Kathryn Morrow - Marriage Coaching"
- Blockquote summary: What they do, who they help, unique value proposition
- Brief context paragraph
- H2 sections:
  - **Programs:** Links to The Marriage Reset, White Picket Fence Project, Free Training
  - **Resources:** Success stories and FAQ
  - **Contact:** Website, services summary, specialty areas

**Content Focus:**
- Marriage coaching for men and women
- 5,600+ marriages saved
- Specialization in sexless marriages and one-spouse transformation
- Programs: The Marriage Reset (men), The White Picket Fence Project (women)

### 2. `/llms-full.txt` (Extended Documentation)

**Location:** Served dynamically at `https://cassandkathryn.com/llms-full.txt`

**Purpose:** Comprehensive documentation for LLMs that need deeper context. Includes:

**Sections:**
- About Cass & Kathryn (background, survival story, credentials)
- Programs & Services (detailed descriptions of each program)
  - The Marriage Reset (for men)
  - The White Picket Fence Project (for women)
  - Free Training
- Common Situations Addressed
  - Sexless marriage
  - Roommate dynamic
  - Constant fighting
  - Checked-out spouse
  - Failed traditional therapy
- Philosophy & Methodology
  - Identity transformation approach
  - Why only one spouse needs to participate
  - Selective acceptance criteria (23% rate)
- Results & Timeframe
- Media features
- Who this is NOT for
- Contact & next steps
- FAQ highlights

**Content Details:**
- ~4,000 words of comprehensive documentation
- Covers philosophy, methodology, specific programs
- Addresses common objections and questions
- Provides context for LLMs to understand the business model

## Implementation Details

### Architecture

**Dynamic Routing (not static files):**
- Routes are handled in `src/server.js` before SSR/static fallback
- Pattern matches the existing `robots.txt` implementation
- Serves plain text responses with UTF-8 encoding

**Code Location:**
```javascript
// Production site: clientdomain.com or www.clientdomain.com
if (host === clientDomain || host === `www.${clientDomain}`) {
  // Serve llms.txt - tells LLMs what the site is about
  if (req.path === '/llms.txt') {
    res.type('text/plain; charset=utf-8');
    return res.send(`# Cass & Kathryn Morrow - Marriage Coaching
...
`);
  }

  // Serve llms-full.txt - extended version with more details
  if (req.path === '/llms-full.txt') {
    res.type('text/plain; charset=utf-8');
    return res.send(`# Cass & Kathryn Morrow - Marriage Coaching (Full Documentation)
...
`);
  }

  // [SSR/static routing continues...]
}
```

**Why Dynamic (Not Static Files):**
1. ✅ **Domain-specific** - Only served on production domain, NOT on dev subdomain
2. ✅ **No build step** - Updates without rebuilding the site
3. ✅ **Consistent pattern** - Matches existing robots.txt implementation
4. ✅ **Works with SSR or static** - Compatible with both deployment modes
5. ✅ **Easy to update** - Content is in one place (server.js)

### Production Deployment

**When This Goes Live:**
- Committed to `main` branch of `illumin8ca/gerald-railway-template` (formerly openclaw-railway-template)
- Railway will automatically deploy when you merge this to the cassandkathryn.com production instance
- No additional configuration needed

**Testing:**
```bash
# Once deployed to production:
curl https://cassandkathryn.com/llms.txt
curl https://cassandkathryn.com/llms-full.txt

# Should NOT be available on dev:
curl https://dev.cassandkathryn.com/llms.txt
# (will 404 or serve from static files if accidentally added)
```

## Benefits for LLMs

### What LLMs Can Learn

When an LLM fetches `/llms.txt`:
- **Quick overview** of Morrow Marriage's services in ~30 lines
- **Program structure** (men vs women programs)
- **Specialty areas** (sexless marriages, conflict, one-spouse work)
- **Links to key pages** for deeper exploration

When an LLM fetches `/llms-full.txt`:
- **Complete methodology** and philosophy
- **Detailed program descriptions** with target audiences
- **Common scenarios** and how they're addressed
- **FAQ answers** to common questions
- **Selection criteria** (23% acceptance rate, high-commitment)
- **Results timeline** (6-12 months)

### Use Cases

1. **AI chatbots** asking about marriage coaching can quickly understand the business
2. **Development environments** (Cursor, GitHub Copilot) working on the site know the context
3. **Search augmented LLMs** can provide accurate summaries without hallucinating
4. **Future AI training** may use llms.txt for better understanding of site content

## Specification Compliance

✅ **Follows llms.txt spec** (https://llmstxt.org/):
- H1 with site/project name
- Blockquote summary
- Optional detail paragraphs
- H2 sections with markdown lists
- Links with descriptions
- Plain markdown format (no HTML)

✅ **Human and LLM readable** - content is useful for both

✅ **No "Optional" section** - all content is relevant (no secondary/skippable info needed)

## Content Source

**Based on:**
- Live site content from https://cassandkathryn.com/ (fetched 2026-02-07)
- Key messaging: marriage coaching, identity transformation, sexless marriages
- Programs: The Marriage Reset (men), The White Picket Fence Project (women)
- Success metrics: 5,600+ marriages saved, 23% acceptance rate
- Timeframe: 6-12 months for transformation

**Crafted for:**
- Accuracy to Cass & Kathryn's actual offerings
- LLM-friendly structure (markdown, clear sections)
- Concise but comprehensive
- No marketing fluff - practical information

## Future Updates

**To update content:**
1. Edit `src/server.js` in the production routing section
2. Commit and push to `main` branch
3. Railway auto-deploys

**To make it site-agnostic:**
- Could move content to a separate config file (e.g., `data/llms-content.json`)
- Load dynamically based on `CLIENT_DOMAIN` env var
- For now, hardcoded for cassandkathryn.com is fine

**To add ai.txt:**
- Not implemented (less common, mostly for crawler permissions)
- If needed, follow same pattern as llms.txt

## Testing Checklist

Once deployed to Railway:

- [ ] Test `/llms.txt` returns content (not 404)
- [ ] Test `/llms-full.txt` returns extended content
- [ ] Verify dev subdomain does NOT serve llms.txt
- [ ] Check Content-Type is `text/plain; charset=utf-8`
- [ ] Test with an LLM (Claude, ChatGPT) - ask about cassandkathryn.com and see if it can fetch/use llms.txt

## Resources

- **llms.txt Specification:** https://llmstxt.org/
- **Example sites with llms.txt:**
  - https://fastht.ml/docs/llms.txt (FastHTML)
  - https://directory.llmstxt.cloud/ (directory of sites)
- **Commit:** `08105c9` in `illumin8ca/gerald-railway-template`

---

**Implementation completed:** 2026-02-07  
**For:** Andy Doucet / Morrow Marriage LLC (cassandkathryn.com)  
**By:** Gerald (subagent: railway-llms-txt)
