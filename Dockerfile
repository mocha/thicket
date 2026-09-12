# thicket: one image, one process. The API serves the built web app and runs
# the feed fetcher. Needs only DATABASE_URL and PUBLIC_URL at runtime.
#
#   docker build -t thicket .
#   docker run -p 3000:3000 -e DATABASE_URL=... -e PUBLIC_URL=https://thicket.example thicket

# ---- build -----------------------------------------------------------------
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
RUN pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm --filter @thicket/web build && pnpm --filter @thicket/api build
# Production node_modules for the API only.
RUN pnpm --filter @thicket/api deploy --prod /out/api

# ---- run -------------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production PORT=3000 WEB_DIR=/app/web
WORKDIR /app
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /out/api/package.json ./package.json
COPY --from=build /app/packages/api/dist ./dist
COPY --from=build /app/packages/api/drizzle ./drizzle
COPY --from=build /app/packages/web/build ./web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "--enable-source-maps", "dist/index.js"]
