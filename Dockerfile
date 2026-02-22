# Build openclaw from source to avoid npm packaging gaps (some dist files are not shipped).
FROM node:22-bookworm AS openclaw-build

# Dependencies needed for openclaw build
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Install Bun (openclaw build uses it)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /openclaw

# Pin to a known ref (tag/branch), with optional previous-revision fallback on build failure.
ARG OPENCLAW_GIT_REF=main
ARG OPENCLAW_BUILD_RETRIES=1

# Keep a short history so we can step back a commit if main is currently broken.
RUN git clone --depth 5 --branch "${OPENCLAW_GIT_REF}" https://github.com/openclaw/openclaw.git .

# Patch: relax version requirements for packages that may reference unpublished versions.
# Apply to all extension package.json files to handle workspace protocol (workspace:*).
RUN set -eux; \
  find ./extensions -name 'package.json' -type f | while read -r f; do \
    sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*">=[^"]+"/"openclaw": "*"/g' "$f"; \
    sed -i -E 's/"openclaw"[[:space:]]*:[[:space:]]*"workspace:[^"]+"/"openclaw": "*"/g' "$f"; \
  done

RUN set -eu -o pipefail; \
  attempts=0; \
  max_retries="${OPENCLAW_BUILD_RETRIES}"; \
  case "${max_retries}" in \
    ''|*[!0-9]*) \
      echo "OPENCLAW_BUILD_RETRIES must be an integer. Falling back to 1."; \
      max_retries="1"; \
      ;; \
  esac; \
  while true; do \
    if pnpm install --no-frozen-lockfile && pnpm build; then \
      break; \
    fi; \
    attempts=$((attempts + 1)); \
    if [ "${attempts}" -gt "${max_retries}" ]; then \
      echo "OpenClaw build failed after checking ${attempts} revision(s)."; \
      exit 1; \
    fi; \
    if ! git rev-parse --verify --quiet HEAD~1 >/dev/null; then \
      echo "OpenClaw build failed and no previous commit is available to retry (depth too shallow)."; \
      exit 1; \
    fi; \
    echo "OpenClaw build failed on revision $(git rev-parse --short HEAD), retrying with previous commit..."; \
    git reset --hard HEAD~1; \
  done
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:install && pnpm ui:build

# Patch WS maxPayload: 512KB → 10MB (upstream issue #10243)
COPY scripts/patch-ws-maxpayload.js /tmp/patch-ws-maxpayload.js
RUN OPENCLAW_DIST=/openclaw/dist node /tmp/patch-ws-maxpayload.js && rm /tmp/patch-ws-maxpayload.js


# Runtime image
FROM node:22-bookworm
ENV NODE_ENV=production

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    build-essential \
    gcc \
    g++ \
    make \
    procps \
    file \
    git \
    python3 \
    pkg-config \
    sudo \
    ffmpeg \
    rclone \
    imagemagick \
  && rm -rf /var/lib/apt/lists/* \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh

# Install Homebrew (must run as non-root user)
# Create a user for Homebrew installation, install it, then make it accessible to all users
RUN useradd -m -s /bin/bash linuxbrew \
  && echo 'linuxbrew ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers

USER linuxbrew
RUN NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

USER root
RUN chown -R root:root /home/linuxbrew/.linuxbrew
ENV PATH="/home/linuxbrew/.linuxbrew/bin:/home/linuxbrew/.linuxbrew/sbin:${PATH}"

# Install Bun + qmd (local markdown search for workspace files)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
RUN bun install -g https://github.com/tobi/qmd

# Install Claude Code CLI and Codex CLI
RUN npm install -g @anthropic-ai/claude-code@latest @openai/codex@latest

# Create config directories for CLI auth files
RUN mkdir -p /data/.claude /data/.codex
ENV HOME=/data

WORKDIR /app

# Wrapper deps
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile && pnpm store prune

# Copy built openclaw
COPY --from=openclaw-build /openclaw /openclaw

# Remove esbuild binaries from openclaw's dependencies to prevent version conflicts
# with client project builds (openclaw bundles esbuild 0.25.x which breaks projects needing 0.27.x)
RUN find /openclaw -name 'esbuild' -path '*/bin/esbuild' -type f -delete 2>/dev/null; \
    find /openclaw -name 'esbuild' -path '*/.bin/esbuild' -type l -delete 2>/dev/null; \
    true

# Provide a openclaw executable
RUN printf '%s\n' '#!/usr/bin/env bash' 'exec node /openclaw/dist/entry.js "$@"' > /usr/local/bin/openclaw \
  && chmod +x /usr/local/bin/openclaw

COPY src ./src
# Ensure network shim exists at the preload path used by NODE_OPTIONS in this image.
RUN cp src/lib/network-interfaces-shim.cjs /tmp/openclaw-network-shim.cjs

# Persist rclone config and chroma cache on /data volume
ENV RCLONE_CONFIG=/data/.config/rclone/rclone.conf
ENV XDG_CACHE_HOME=/data/.cache

ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]
