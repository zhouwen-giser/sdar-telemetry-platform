FROM node:22-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml tsconfig.json ./
COPY apps apps
COPY packages packages
COPY scripts scripts
COPY types types
RUN npm install --ignore-scripts && npm run build
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
ARG APP
ENV APP=$APP
CMD ["sh","-c","node dist/apps/$APP/src/main.js"]
