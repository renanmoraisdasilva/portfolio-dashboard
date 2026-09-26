# Multi-stage build: install + build with dev deps, then produce a slim prod image.
#
# Layout note: the container mirrors the repository layout exactly —
# WORKDIR /app is the npm workspace root, and the API lives at /app/apps/api.
# src/app.ts computes repoRoot as three levels up from apps/api/{src,dist},
# so this mirroring is what makes pages/ and static/ resolve at runtime.

FROM node:22-alpine AS builder

# Native addon toolchain. .npmrc sets ignore-scripts=true so npm never invokes
# node-gyp automatically; this is kept so a maintainer who explicitly runs
# `npm rebuild` (or adds a dependency with no prebuilt binary) can do so.
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Workspace manifests first, so npm ci can resolve the lockfile before sources land.
# .npmrc carries ignore-scripts=true — see the comment in that file.
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

# API sources and the frontend assets served at runtime.
COPY apps/api/ apps/api/
COPY pages/ pages/
COPY static/ static/
COPY icon.png icon.png

# Build TypeScript (produces apps/api/dist)
RUN npm run build --workspace apps/api

# Prune dev deps so we copy a lean node_modules to the final image.
RUN npm prune --omit=dev

# Final stage (runtime)
FROM node:22-alpine AS runtime

# Accept build argument for Home Assistant webhook URL
ARG HOME_ASSISTANT_WEBHOOK_URL
ENV HOME_ASSISTANT_WEBHOOK_URL=${HOME_ASSISTANT_WEBHOOK_URL}

WORKDIR /app

# Copy pre-built node_modules (hoisted to the workspace root) and app artifacts.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/pages ./pages
COPY --from=builder /app/static ./static
COPY --from=builder /app/icon.png ./icon.png

# Fail the image build early if any required root page is missing.
RUN test -f /app/pages/index.html \
	&& test -f /app/pages/simulation.html \
	&& test -f /app/pages/sql-explorer.html \
	&& test -f /app/pages/analytics.html

EXPOSE 3000
CMD ["node", "apps/api/dist/web.js"]
