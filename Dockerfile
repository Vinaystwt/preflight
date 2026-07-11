FROM node:20-alpine AS build
ARG BUILD_SHA
ENV BUILD_SHA=${BUILD_SHA}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runtime
ARG BUILD_SHA
WORKDIR /app
ENV NODE_ENV=production
ENV BUILD_SHA=${BUILD_SHA}
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
