FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY apps apps
COPY packages packages
COPY scripts scripts
COPY types types
COPY integrations integrations
RUN npm install --ignore-scripts && npm run build && npm prune --omit=dev

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
