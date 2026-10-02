# Multi-stage build: install + build with dev deps, then produce a slim prod image.
#
# Layout note: the container mirrors the repository layout exactly —
# WORKDIR /app is the npm workspace root, and the API lives at /app/apps/api.
# src/app.ts computes repoRoot as three levels up from apps/api/{src,dist},
# so this mirroring is what makes static/ resolve at runtime.

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
# The test runner reads these three. `test:docker` builds `--target builder` and
# runs `npm test` there, so without them the container had no Vitest config at
# all: Vitest fell back to its defaults, `globals: true` never applied, and every
# suite failed on `describe is not defined`. The `.dockerignore` does not exclude
# them, so they were simply never copied. The runtime stage needs none of the
# three.
COPY vitest.config.ts playwright.config.ts ./
COPY fixtures/ fixtures/
COPY e2e/ e2e/
COPY static/ static/
# `scripts/` because `scripts/config-integrity.test.ts` is part of the suite
# `test:docker` runs. Without it the container runs 7 tests fewer than the host
# and reports success — the same shape of failure as the missing
# `vitest.config.ts` above, where the gap was invisible because nothing compared
# the two counts. Builder only; the runtime stage needs none of these.
COPY scripts/ scripts/
COPY icon.png icon.png

# Build (produces packages/shared/dist, apps/api/dist and apps/web/dist)
RUN npm run build --workspace packages/shared && npm run build --workspace apps/api && npm run build --workspace apps/web

# Prune dev deps so we copy a lean node_modules to the final image.
# This is deliberately its own stage rather than a step at the end of
# `builder`: `test:docker` builds --target builder and runs the suite from
# that image, and vitest, typescript and the linters are all devDependencies -
# pruning them inside `builder` would leave the stage with no test runner.
FROM builder AS pruned
RUN npm prune --omit=dev

# Final stage (runtime)
FROM node:22-alpine AS runtime

# `HOME_ASSISTANT_WEBHOOK_URL` is deliberately NOT set here.
#
# It used to be, via `ARG` + `ENV` in this stage, and the CI workflow passed the
# real webhook as a build argument. An `ENV` is persisted into the image config,
# so every image ever pushed carries the value in plain text - `docker history`
# and `docker inspect` both print it, and anyone who can pull the image can read
# a Home Assistant webhook, which is a bearer secret. The image is published to
# GHCR on every push, so this shipped the secret to a registry rather than
# keeping it in the deployment.
#
# `homeAssistantService.ts` reads `process.env.HOME_ASSISTANT_WEBHOOK_URL` at
# startup, so passing it as a runtime environment variable is exactly equivalent
# and leaks nothing. `docker-compose.yml` forwards it; Dokploy sets it in the
# application's environment.
#
# The API takes no statement string and executes none, so there is no
# arbitrary-SQL console in this image and no flag to disable one.
# `npm run db:studio` opens the SQLite file for inspection without a port.

WORKDIR /app

# Copy pre-built node_modules (hoisted to the workspace root) and app artifacts.
COPY --from=pruned /app/node_modules ./node_modules
COPY --from=pruned /app/package.json ./package.json
COPY --from=pruned /app/package-lock.json ./package-lock.json
COPY --from=pruned /app/packages/shared ./packages/shared
COPY --from=pruned /app/apps/api ./apps/api
COPY --from=pruned /app/apps/web ./apps/web
COPY --from=pruned /app/static ./static
COPY --from=pruned /app/icon.png ./icon.png

# Fail the image build early if the built frontend is missing. A green build that
# produced no `index.html` would ship an API with nothing to serve at `/`.
RUN test -f /app/apps/web/dist/index.html

# Tests belong to the builder stage only: `npm run test:docker` builds that
# stage and runs the full suite from it, so they cannot be excluded at the
# build-context level - a .dockerignore entry would silently drop suites
# from that run. The shipped image needs neither the TypeScript sources, nor
# the static-page helpers.
#
# `apps/api/dist` needs no sweep any more. `tsconfig.json` excludes `*.test.ts`
# from the build, so `tsc` never emits compiled tests; the old `find` here was
# deleting them after the fact, which is what let them accumulate unnoticed in
# local `dist/` and get picked up by Vitest's default include pattern.
RUN rm -rf static/js/__tests__

EXPOSE 3000
CMD ["node", "apps/api/dist/web.js"]
