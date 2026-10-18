# ─────────────────────────────────────────────────────────────────────────────
# Build context: REPO KÖKÜ (crewinjob-web + crewinjob-agent birlikte gerekir).
#   docker compose -f crewinjob-web/docker-compose.yml up -d --build
#   veya: docker build -f crewinjob-web/Dockerfile .   (repo kökünden)
# Web uygulaması agent modüllerini süreç içinde require eder (lib/agent-bridge.ts),
# bu yüzden crewinjob-agent imajda /crewinjob-agent altında bulunur.
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Dependencies ──────────────────────────────────────────────────────
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
# Web: build için devDependencies (typescript, tailwind, postcss) de gerekli
WORKDIR /repo/crewinjob-web
COPY crewinjob-web/package*.json ./
RUN npm ci
# Agent: yalnızca runtime bağımlılıkları
WORKDIR /repo/crewinjob-agent
COPY crewinjob-agent/package*.json ./
RUN npm ci --omit=dev

# ── Stage 2: Builder ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /repo
COPY --from=deps /repo/crewinjob-web/node_modules   ./crewinjob-web/node_modules
COPY --from=deps /repo/crewinjob-agent/node_modules ./crewinjob-agent/node_modules
COPY crewinjob-web   ./crewinjob-web
COPY crewinjob-agent ./crewinjob-agent

WORKDIR /repo/crewinjob-web
# Build sırasında env gerektiren değişkenler (public olanlar)
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
# next.config.mjs → output: 'standalone'
ENV DOCKER_BUILD=1
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Offline regression gate on the same Linux/Node runtime, before assembling runner.
FROM builder AS verification
RUN --network=none npm run test:platform

# ── Stage 3: Runner (Production) ───────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3033
# Standalone server.js varsayılan olarak $HOSTNAME'e bind olur; Docker bunu container
# adına ayarlar → 127.0.0.1 üzerinden dahili çağrılar (lib/internal-fetch.ts) erişemez.
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV CREWINJOB_AGENT_DIR=/crewinjob-agent

RUN addgroup --system --gid 1001 nodejs
RUN adduser  --system --uid 1001 nextjs

# Public + static dosyalar
COPY --from=verification --chown=nextjs:nodejs /repo/crewinjob-web/public            ./public
COPY --from=verification --chown=nextjs:nodejs /repo/crewinjob-web/.next/standalone  ./
COPY --from=verification --chown=nextjs:nodejs /repo/crewinjob-web/.next/static      ./.next/static
# Agent modülleri (agentModule → CREWINJOB_AGENT_DIR)
COPY --from=verification --chown=nextjs:nodejs /repo/crewinjob-agent                 /crewinjob-agent

# Private operator entry points, not UI fixtures or test loaders.
COPY --from=verification --chown=nextjs:nodejs /repo/crewinjob-web/scripts/platform-backup.mjs /repo/crewinjob-web/scripts/platform-verify-backup.mjs /repo/crewinjob-web/scripts/platform-restore-drill.mjs /repo/crewinjob-web/scripts/platform-monitor.mjs /repo/crewinjob-web/scripts/platform-worker.mjs /repo/crewinjob-web/scripts/platform-runtime-check.mjs ./scripts/
COPY --from=verification --chown=nextjs:nodejs /repo/crewinjob-web/scripts/lib ./scripts/lib
# CLI-only imports are outside Next's route tracing graph.
COPY --from=verification --chown=nextjs:nodejs /repo/crewinjob-web/node_modules/@next/env ./node_modules/@next/env

# Runtime yazma klasörleri (OAuth token, zamanlanmış postlar, blog görselleri, agent verisi)
RUN mkdir -p /app/data /app/public/images/blog /crewinjob-agent/data /crewinjob-agent/logs /crewinjob-agent/output \
 && chown -R nextjs:nodejs /app/data /app/public/images /crewinjob-agent/data /crewinjob-agent/logs /crewinjob-agent/output \
 && chmod 700 /app/data

USER nextjs

# Fail the build if tracing/native packaging omitted an operator dependency.
RUN node scripts/platform-runtime-check.mjs

EXPOSE 3033

CMD ["node", "server.js"]
