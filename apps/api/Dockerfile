FROM node:20-alpine AS base
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
RUN pnpm --filter @moneypulse/api build

# Production
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=api-build /app/apps/api/dist ./dist
COPY --from=api-build /app/apps/api/package.json ./
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/packages ./packages

EXPOSE 4000
CMD ["node", "dist/main.js"]
