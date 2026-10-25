FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY server ./server
COPY web ./web
COPY vite.config.ts ./
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
# tzdata: without it TZ silently falls back to UTC and backups run at the wrong local hour.
RUN apt-get update && apt-get install -y --no-install-recommends tzdata && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
# The restore script runs from source with tsx and needs server/src (incl. migrations).
COPY --from=build /app/server ./server
VOLUME /data
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
