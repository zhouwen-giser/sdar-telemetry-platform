FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY apps apps
COPY packages packages
COPY scripts scripts
COPY types types
RUN npm install --ignore-scripts && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
COPY package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY integrations ./integrations
COPY migrations ./migrations
ARG APP
ENV APP=$APP
CMD ["sh","-c","node dist/apps/$APP/src/main.js"]
