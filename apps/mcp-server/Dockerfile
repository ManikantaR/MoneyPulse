FROM node:22-alpine AS build
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/mcp-server/package.json apps/mcp-server/
RUN corepack enable pnpm && pnpm install --frozen-lockfile --filter @moneypulse/mcp-server

COPY apps/mcp-server/ apps/mcp-server/
RUN cd apps/mcp-server && pnpm build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/apps/mcp-server/dist ./dist
COPY --from=build /app/apps/mcp-server/package.json ./
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3100
CMD ["node", "dist/index.js", "--sse"]
