# Trace — production image (Next.js + better-sqlite3)
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Build tools are only needed if better-sqlite3 has no prebuild for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/seed ./seed
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["./node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
