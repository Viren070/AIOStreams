# The standalone web app, served on its own. Build from the repo root:
#   docker build -f packages/web/Dockerfile .

# The output is the same on every platform, so it builds once, natively.
FROM --platform=$BUILDPLATFORM node:24.18.1-slim AS build

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /build

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY patches ./patches
COPY packages/core/package.json ./packages/core/
# Core depends on crypto, and a frozen install checks that link.
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/ui/package.json ./packages/ui/
COPY packages/web/package.json ./packages/web/

# Core is only needed for a type, so its dependencies and native builds are skipped.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  --filter @aiostreams/web --filter @aiostreams/ui

COPY tsconfig.*json ./
COPY packages/ui ./packages/ui
COPY packages/web ./packages/web
COPY packages/core/src ./packages/core/src
COPY packages/frontend/public ./packages/frontend/public
# Without .git, the build reads its commit from SOURCE_COMMIT, or from
# resources/metadata.json if CI wrote one.
COPY resources ./resources
ARG SOURCE_COMMIT

# Otherwise pnpm installs core's dependencies before it runs the script.
RUN PAGE_ICONS=true pnpm --config.verify-deps-before-run=false \
  -F @aiostreams/web build:standalone


FROM nginx/nginx-unprivileged:alpine-slim

LABEL org.opencontainers.image.title="AIOStreams app"
LABEL org.opencontainers.image.source="https://github.com/Viren070/AIOStreams"
LABEL org.opencontainers.image.description="The AIOStreams app on its own, signing in to any AIOStreams or Jellyfin server."
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"

COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/packages/web/dist-standalone /usr/share/nginx/html

# The base image lags behind Alpine's security fixes, so this picks them up.
# It sits after the copy so that every new build runs it again.
USER root
RUN apk upgrade --no-cache
USER 101

EXPOSE 8080
