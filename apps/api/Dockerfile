FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

# Build shared package
FROM deps AS shared-build
COPY packages/shared/ ./packages/shared/
COPY tsconfig.base.json ./
RUN pnpm --filter @moneypulse/shared build

# Build API
FROM shared-build AS api-build
COPY apps/api/ ./apps/api/
RUN pnpm --filter @moneypulse/api build && \
    pnpm --filter @moneypulse/api deploy --prod --legacy /deploy && \
    cp -r /app/apps/api/dist /deploy/dist

# Production
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache curl

COPY --from=api-build /deploy ./
COPY db/migrations ./db/migrations

EXPOSE 4000
CMD ["node", "dist/main.js"]
