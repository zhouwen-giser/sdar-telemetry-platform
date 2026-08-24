# syntax=docker/dockerfile:1.19@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY apps apps
COPY packages packages
COPY scripts scripts
COPY types types
COPY integrations integrations
COPY vendor/npm-cache /app/vendor/npm-cache
RUN node scripts/vendor-npm-cache.mjs verify \
      --lock package-lock.json --cache /app/vendor/npm-cache \
    && npm ci --offline --cache=/app/vendor/npm-cache \
      --include=dev --ignore-scripts --no-audit --no-fund --no-update-notifier \
    && npm run build \
    && npm prune --offline --omit=dev --ignore-scripts \
      --no-audit --no-fund --no-update-notifier

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32
WORKDIR /app
COPY package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY integrations ./integrations
COPY migrations ./migrations
ARG APP
ENV APP=$APP
CMD ["sh","-c","node dist/apps/$APP/src/main.js"]
