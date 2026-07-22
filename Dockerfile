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
ARG ONCHAINOS_VERSION=v4.2.5
WORKDIR /app
ENV NODE_ENV=production
ENV BUILD_SHA=${BUILD_SHA}
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Agent-ID listing resolution intentionally delegates to the official OnchainOS
# CLI. Pin and checksum-verify the Linux musl release rather than relying on an
# unversioned curl or a non-existent npm package.
RUN apk add --no-cache curl \
  && curl -fsSL -o /usr/local/bin/onchainos https://github.com/okx/onchainos-skills/releases/download/${ONCHAINOS_VERSION}/onchainos-x86_64-unknown-linux-musl \
  && echo "6fe5a608c7879cbe9c53b217923d2c721f8ae640146497f7ae133cb877878018  /usr/local/bin/onchainos" | sha256sum -c - \
  && chmod 0755 /usr/local/bin/onchainos \
  && onchainos --version
COPY --from=build /app/dist ./dist
COPY src/db/schema.sql ./dist/db/schema.sql
COPY src/db/migrations ./dist/db/migrations
EXPOSE 3000
USER node
CMD ["node", "dist/server.js"]
