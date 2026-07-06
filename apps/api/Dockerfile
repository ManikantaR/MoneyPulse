FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/mcp-server/package.json ./apps/mcp-server/
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

# Build MCP server (the advisor's data layer; spawned over stdio by the API)
FROM shared-build AS mcp-build
COPY apps/mcp-server/ ./apps/mcp-server/
RUN pnpm --filter @moneypulse/mcp-server build && \
    pnpm --filter @moneypulse/mcp-server deploy --prod --legacy /deploy-mcp && \
    cp -r /app/apps/mcp-server/dist /deploy-mcp/dist

# Production
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# The API spawns the co-located MCP server over stdio; pin its entrypoint.
ENV MCP_SERVER_ENTRY=/app/mcp-server/dist/index.js
RUN apk add --no-cache curl

COPY --from=api-build /deploy ./
COPY --from=mcp-build /deploy-mcp ./mcp-server
COPY db/migrations ./db/migrations

EXPOSE 4000
CMD ["node", "dist/main.js"]
