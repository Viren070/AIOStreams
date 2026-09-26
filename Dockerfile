FROM node:24.18.1-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder

WORKDIR /build

# Build toolchain for native addons that lack prebuilt binaries on this platform
# (e.g. yencode, used by the native usenet engine, has no linux/arm64 prebuild and
# must be compiled with node-gyp → needs Python + a C/C++ toolchain). These tools
# live only in the builder/runtime stages; the final distroless image just copies
# the already-compiled .node binaries, so it stays clean.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy LICENSE file.
COPY LICENSE ./

# Copy the relevant package.json and package-lock.json files.
COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
COPY packages/core/package*.json ./packages/core/
COPY packages/frontend/package*.json ./packages/frontend/
COPY packages/ui/package*.json ./packages/ui/
COPY packages/jellyfin-web/package*.json ./packages/jellyfin-web/
COPY packages/seanime-extensions/package*.json ./packages/seanime-extensions/
COPY packages/crypto/package*.json ./packages/crypto/
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY patches ./patches

# Install dependencies.
RUN pnpm install --frozen-lockfile

# Copy source files.
COPY tsconfig.*json ./

COPY packages/server ./packages/server
COPY packages/core ./packages/core
COPY packages/frontend ./packages/frontend
COPY packages/ui ./packages/ui
COPY packages/jellyfin-web ./packages/jellyfin-web
COPY packages/seanime-extensions ./packages/seanime-extensions
COPY packages/crypto ./packages/crypto
COPY scripts ./scripts
COPY resources ./resources


# Build the project.
RUN pnpm run build

# Remove development dependencies.
RUN rm -rf node_modules
RUN rm -rf packages/core/node_modules
RUN rm -rf packages/server/node_modules
RUN rm -rf packages/frontend/node_modules
RUN rm -rf packages/ui/node_modules
RUN rm -rf packages/jellyfin-web/node_modules
RUN rm -rf packages/seanime-extensions/node_modules

RUN pnpm install --prod --frozen-lockfile


FROM builder AS runtime
WORKDIR /runtime

# Copy the built files from the builder.
# The package.json files must be copied as well for NPM workspace symlinks between local packages to work.
COPY --from=builder /build/package*.json /build/LICENSE ./
COPY --from=builder /build/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /build/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /build/patches ./patches

COPY --from=builder /build/packages/core/package.*json ./packages/core/
COPY --from=builder /build/packages/server/package.*json ./packages/server/

# Loader + built binary; core's node_modules symlink into packages/ resolves it.
COPY --from=builder /build/packages/crypto ./packages/crypto

COPY --from=builder /build/packages/core/dist ./packages/core/dist
COPY --from=builder /build/packages/frontend/dist ./packages/frontend/dist
COPY --from=builder /build/packages/jellyfin-web/dist ./packages/jellyfin-web/dist
COPY --from=builder /build/packages/server/dist ./packages/server/dist
COPY --from=builder /build/packages/server/src/static ./packages/server/dist/static
COPY --from=builder /build/packages/seanime-extensions/dist ./packages/seanime-extensions/dist

COPY --from=builder /build/resources ./resources
COPY --from=builder /build/scripts ./scripts

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /build/packages/server/node_modules ./packages/server/node_modules


FROM debian:12-slim AS mimalloc
RUN apt-get update \
  && apt-get install -y --no-install-recommends libmimalloc2.0 \
  && rm -rf /var/lib/apt/lists/* \
  && cp /usr/lib/*/libmimalloc.so.2 /usr/local/lib/libmimalloc.so.2

# ffprobe (for RemuxDB media-info probing). Only dynamically links glibc,
# which distroless nodejs already ships, so unlike libmimalloc no other
# shared libraries need copying.
FROM debian:12-slim AS ffprobe
ARG TARGETARCH
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl xz-utils \
  && rm -rf /var/lib/apt/lists/*
RUN set -eu; \
  case "$TARGETARCH" in \
    amd64) FFMPEG_ARCH=linux64 ;; \
    arm64) FFMPEG_ARCH=linuxarm64 ;; \
    *) echo "unsupported TARGETARCH: $TARGETARCH" >&2; exit 1 ;; \
  esac; \
  FFMPEG_FILE="ffmpeg-n8.1-latest-${FFMPEG_ARCH}-gpl-8.1.tar.xz"; \
  RELEASE_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest"; \
  curl -fsSL -o "/tmp/${FFMPEG_FILE}" "${RELEASE_URL}/${FFMPEG_FILE}"; \
  curl -fsSL -o /tmp/checksums.sha256 "${RELEASE_URL}/checksums.sha256"; \
  (cd /tmp && grep " ${FFMPEG_FILE}\$" checksums.sha256 | sha256sum -c -); \
  tar -xJf "/tmp/${FFMPEG_FILE}" -C /tmp --wildcards --strip-components=2 '*/bin/ffprobe'; \
  chmod +x /tmp/ffprobe

FROM gcr.io/distroless/nodejs24-debian12 AS production

LABEL org.opencontainers.image.title="AIOStreams"
LABEL org.opencontainers.image.source="https://github.com/Viren070/AIOStreams"
LABEL org.opencontainers.image.description="AIOStreams consolidates multiple Stremio addons and debrid services - including its own suite of built-in addons - into a single, highly customisable super-addon."
LABEL org.opencontainers.image.licenses="AGPL-3.0-only"

WORKDIR /app

COPY --from=busybox:1.36.0-uclibc /bin/wget /bin/wget
COPY --from=busybox:1.36.0-uclibc /bin/sh /bin/sh
COPY --from=mimalloc /usr/local/lib/libmimalloc.so.2 /usr/local/lib/libmimalloc.so.2
ENV LD_PRELOAD=/usr/local/lib/libmimalloc.so.2
COPY --from=ffprobe /tmp/ffprobe /usr/local/bin/ffprobe
ENV PATH="/usr/local/bin:${PATH}"
ENV NODE_OPTIONS="--max-semi-space-size=8 --expose-gc"
COPY --from=runtime /runtime /app

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/scripts/healthcheck.js"]
EXPOSE ${PORT:-3000}

CMD ["/app/packages/server/dist/server.js"]