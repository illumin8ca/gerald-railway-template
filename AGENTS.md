# Gerald Railway Template

**Project:** Railway deployment wrapper for OpenClaw AI agent platform
**Tech Stack:** Node.js (ESM), Express 5, http-proxy, Docker multi-stage build
**Type:** Single project (not a monorepo)

## Essential Reading

1. [README.md](./README.md) -- Quick start and project overview
2. [docs/01-architecture/architecture.md](./docs/01-architecture/architecture.md) -- Full system design
3. Sub-directory AGENTS.md files -- Detailed patterns per area

## Quick Start

```bash
npm install          # Install wrapper deps
npm run dev          # Local development (needs OpenClaw in /openclaw or OPENCLAW_ENTRY set)
npm start            # Production start
npm run lint         # Syntax check (node -c src/server.js)
npm run smoke        # Docker smoke test
```

## Universal Conventions

- **Language:** JavaScript (ESM, `"type": "module"` in package.json)
- **Style:** No formatter/linter enforced beyond `node -c` syntax check
- **Imports:** ES module `import/export`, no CommonJS
- **Commits:** Conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
- **Branches:** `main` (production)
- **Node version:** >=22 (see `engines` in package.json, Dockerfile uses `node:22-bookworm`)

## Security & Secrets

- Never commit secrets to Git -- use Railway env vars or `.env` files
- `.env.example` documents all variables with placeholder values
- Gateway token is auto-generated and persisted to volume at runtime
- Token injection uses http-proxy event handlers, not direct header mutation

## Directory Structure (JIT Index)

### Source Code

- **Entry point:** `src/server.js` (~110KB, main Express app) -- see [src/AGENTS.md](./src/AGENTS.md)
- **Library modules:** `src/lib/` -- see [src/lib/AGENTS.md](./src/lib/AGENTS.md)
- **Static assets:** `src/public/` (setup wizard HTML/CSS/JS)
- **Templates:** `src/templates/` (client skill templates)

### Supporting

- **Scripts:** `scripts/` -- see [scripts/AGENTS.md](./scripts/AGENTS.md)
- **Documentation:** `docs/` -- see [docs/README.md](./docs/README.md)
- **Docker:** `Dockerfile` (multi-stage: builds OpenClaw from source, then runtime image)
- **Railway config:** `railway.toml` (builder=DOCKERFILE, healthcheck, restart policy)

### Quick Find

```bash
# Find a function in server code
grep -rn "functionName" src/

# Find an Express route
grep -rn "app\.\(get\|post\|put\|delete\)" src/server.js

# Find environment variable usage
grep -rn "process\.env\." src/

# Find proxy event handlers
grep -rn "proxy\.on" src/server.js
```

## Definition of Done

Before submitting a PR:
- `npm run lint` passes (syntax check)
- Docker build succeeds: `docker build -t test .`
- No secrets or credentials in diff (`git diff --cached`)
- Conventional commit message
