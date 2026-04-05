FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# Build shared package (required — web app imports types from @moneypulse/shared)
FROM deps AS shared-build
COPY packages/shared/ ./packages/shared/
COPY tsconfig.base.json ./
RUN pnpm --filter @moneypulse/shared build

# Build web app
FROM shared-build AS builder
COPY apps/web/ ./apps/web/
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @moneypulse/web build

# Production
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy standalone output (preserves pnpm symlinks relative to the .pnpm store)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
# Copy static assets and public to app subdirectory (where server.js lives)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
WORKDIR /app/apps/web
EXPOSE 3000
ENV PORT=3000
CMD ["node", "server.js"]
