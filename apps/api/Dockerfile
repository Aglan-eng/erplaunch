# Production Dockerfile for @ofoq/api (ERPLaunch backend).
# Runs `tsx src/server.ts` — no tsc build step, tsx handles TS at runtime.
# Built from the monorepo root so pnpm workspaces resolve correctly.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

# Dependency layer — copy only manifests first so Docker caches install
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
COPY packages/rule-engine/package.json ./packages/rule-engine/
COPY packages/adaptor-sdk/package.json ./packages/adaptor-sdk/
COPY packages/adaptor-registry/package.json ./packages/adaptor-registry/
COPY packages/adaptor-netsuite/package.json ./packages/adaptor-netsuite/
COPY packages/adaptor-odoo/package.json ./packages/adaptor-odoo/

RUN pnpm install --frozen-lockfile --filter @ofoq/api... --filter "./packages/**"

# Source layer (include the shared tsconfig the workspace packages extend)
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
COPY packages/rule-engine ./packages/rule-engine
COPY packages/adaptor-sdk ./packages/adaptor-sdk
COPY packages/adaptor-registry ./packages/adaptor-registry
COPY packages/adaptor-netsuite ./packages/adaptor-netsuite
COPY packages/adaptor-odoo ./packages/adaptor-odoo

# Build workspace packages — api imports from their dist/ outputs
RUN pnpm --filter "./packages/**" -r run build

# Phase 51.4 hotfix — inline export-template assets so the rendered
# proposal PDF never depends on the binary PNG/TTF files being on disk
# at runtime. Regenerates the committed `assets.generated.ts` from the
# real .png/.ttf sources before the image freezes.
RUN pnpm --filter @ofoq/api run build:assets

# Prepare data dirs (Render mounts the persistent disk here)
RUN mkdir -p /data/db /data/uploads /data/outputs

# Phase 51.1 — Alpine-native Chromium for the HTML→PDF engine.
# We install the distro chromium package (musl-built, native to this
# image). The two ENV lines tell puppeteer-core to skip any browser
# download and point the launcher at /usr/bin/chromium-browser.
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    DATABASE_URL=file:/data/db/dev.db \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3000

WORKDIR /app/apps/api
CMD ["pnpm", "start"]
