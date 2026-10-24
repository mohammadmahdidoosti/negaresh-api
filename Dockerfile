# Negaresh: web UI + /api/v1. Requires Node >= 22.13 (node:sqlite).
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 LLM_USAGE_DB=/data/usage.sqlite
COPY --from=build /app ./
RUN npm prune --omit=dev && mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
CMD ["sh", "-c", "npx next start -p ${PORT}"]
