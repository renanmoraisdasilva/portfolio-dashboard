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

# Sources and the frontend assets served at runtime. packages/shared comes in
# too: apps/api imports it, and npm workspaces symlink it into node_modules.
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/
COPY packages/shared/ packages/shared/
COPY pages/ pages/
COPY static/ static/
COPY icon.png icon.png

# Build (produces packages/shared/dist, apps/api/dist and apps/web/dist)
RUN npm run build --workspace packages/shared && npm run build --workspace apps/api && npm run build --workspace apps/web

# Prune dev deps so we copy a lean node_modules to the final image.
# This is deliberately its own stage rather than a step at the end of
# `builder`: `test:docker` builds --target builder and runs the suite from
# that image, and jest, typescript and ts-jest are all devDependencies -
# pruning them inside `builder` would leave the stage with no test runner.
FROM builder AS pruned
RUN npm prune --omit=dev

# Final stage (runtime)
FROM node:22-alpine AS runtime

# Accept build argument for Home Assistant webhook URL
ARG HOME_ASSISTANT_WEBHOOK_URL
ENV HOME_ASSISTANT_WEBHOOK_URL=${HOME_ASSISTANT_WEBHOOK_URL}

# ENABLE_SQL_EXPLORER is deliberately NOT set: /api/sql/* answers 403 unless a
# deployment opts in (Phase 3 of docs/MODERNIZATION-PLAN.md).

WORKDIR /app

# Copy pre-built node_modules (hoisted to the workspace root) and app artifacts.
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/package.json ./package.json
COPY --from=pruned /app/package-lock.json ./package-lock.json
COPY --from=pruned /app/packages/shared ./packages/shared
COPY --from=pruned /app/apps/api ./apps/api
COPY --from=pruned /app/apps/web ./apps/web
COPY --from=pruned /app/pages ./pages
COPY --from=pruned /app/static ./static
COPY --from=pruned /app/icon.png ./icon.png

# Fail the image build early if a required page is missing. Every user-facing
# page migrated to Vue in Phase 5; only the gated SQL Explorer is still vanilla.
RUN test -f /app/pages/sql-explorer.html \
	&& test -f /app/apps/web/dist/index.html

# Tests belong to the builder stage only: `npm run test:docker` builds that
# stage and runs the full suite from it, so they cannot be excluded at the
# build-context level - a .dockerignore entry would silently drop suites
# from that run. The shipped image needs neither the TypeScript sources, nor
# the compiled output tsc produced in dist, nor the static-page helpers.
RUN rm -rf static/js/__tests__ && find apps/api/src apps/api/dist -type f -name '*.test.*' -exec rm -f {} +

EXPOSE 3000
CMD ["node", "apps/api/dist/web.js"]
