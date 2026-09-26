# Multi-stage build: build with dev deps, then produce a slim prod image

# Builder stage
FROM node:18-alpine AS builder
WORKDIR /app/server

# Native addons (better-sqlite3) need a C++ toolchain at build time.
RUN apk add --no-cache python3 make g++

# Copy server package files and install full deps (dev + prod) to build
COPY server/package.json server/package-lock.json* ./
RUN npm ci

# Copy server sources and frontend assets used at runtime
COPY server/ ./
COPY pages ../pages
COPY openapi.yaml ../openapi.yaml
COPY icon.png ../icon.png
COPY static ../static

# Build TypeScript (produces dist/)
RUN npm run build

# Prune dev deps so we can copy a lean node_modules to the final image.
RUN npm prune --production

# Final stage (runtime)
FROM node:18-alpine AS runtime

# Accept build argument for Home Assistant webhook URL
ARG HOME_ASSISTANT_WEBHOOK_URL
ENV HOME_ASSISTANT_WEBHOOK_URL=${HOME_ASSISTANT_WEBHOOK_URL}

WORKDIR /app/server

# Copy pre-built node_modules (includes compiled better-sqlite3 native module).
COPY --from=builder /app/server/node_modules ./node_modules

# Copy built artifacts and frontend assets into final image
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/server/drizzle ./drizzle
COPY --from=builder /app/pages /app/pages
COPY --from=builder /app/openapi.yaml /app/openapi.yaml
COPY --from=builder /app/icon.png /app/icon.png
COPY --from=builder /app/static /app/static

# Fail the image build early if any required root page is missing.
RUN test -f /app/pages/index.html \
	&& test -f /app/pages/simulation.html \
	&& test -f /app/pages/finance.html \
	&& test -f /app/pages/sql-explorer.html \
	&& test -f /app/pages/vocabulary-learning.html \
	&& test -f /app/pages/analytics.html

EXPOSE 3000
CMD ["node", "dist/web.js"]
