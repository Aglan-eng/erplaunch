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

# Prepare data dirs (Render mounts the persistent disk here)
RUN mkdir -p /data/db /data/uploads /data/outputs

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000 \
    DATABASE_URL=file:/data/db/dev.db

EXPOSE 3000

WORKDIR /app/apps/api
CMD ["pnpm", "start"]
