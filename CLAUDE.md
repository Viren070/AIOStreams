# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

AIOStreams is a Stremio "super-addon" that aggregates results from many upstream Stremio addons + debrid/usenet services, then deduplicates, filters, sorts, formats and (optionally) proxies the streams before returning them to Stremio. It is a single-process Node service that also serves a React SPA configuration UI.

Requires Node `>=24` and pnpm `>=11` (enforced in root `package.json` engines).

## Commands

All commands run from the repo root. The repo is a pnpm workspace with packages under `packages/*`.

- `pnpm install` — install everything (pnpm workspaces).
- `pnpm build` — build `core` → `server` → `frontend` → `seanime-extensions` in that order (the order matters; later packages depend on `@aiostreams/core`).
- `pnpm dev` — run `core`, `server` and `frontend` in parallel watch mode.
- `pnpm start:dev` — `tsx watch` of `packages/server/src/server.ts` with `NODE_ENV=development` (use this when you only need the backend to reload).
- `pnpm start` — run the built server (`node packages/server/dist/server`). Requires `pnpm build` first.
- `pnpm start:frontend:dev` — only the rsbuild dev server for the SPA.
- `pnpm test` — run vitest in every workspace (`vitest run --passWithNoTests`).
- Per-package: `pnpm -F core test`, `pnpm -F frontend typecheck`, `pnpm -F frontend lint`, etc.
- Single test file: `pnpm -F <pkg> exec vitest run path/to/file.test.ts` (or add `-t "<name>"` for a single test).
- `pnpm format` — Prettier across all `*.ts`/`*.tsx`.
- `pnpm gen:env-docs` — regenerate env-var documentation from the config schema (run after changing `packages/core/src/config/schema`).
- `pnpm metadata` — regenerate addon metadata (`scripts/generateMetadata.cjs`).
- Docs site: `pnpm docs:dev` / `pnpm docs:build`.

The frontend uses rsbuild (not Vite/webpack directly) — `pnpm -F frontend dev` / `build` / `preview`.

## Architecture

### Workspace layout

- `packages/core` — the engine. Everything addon-related, all I/O, DB, cache, config, presets, builtins, stream pipeline. Other packages depend on it as `@aiostreams/core`.
- `packages/server` — thin Express 5 app that wires `core` to HTTP. Owns routing, middleware, rate limiting, static asset serving, and the server lifecycle.
- `packages/frontend` — React 19 SPA (rsbuild + TanStack Router + TanStack Query + Tailwind + Radix). Built output is served by the server from `packages/frontend/dist` at runtime.
- `packages/seanime-extensions` — separate Seanime extension bundles, built independently.
- `packages/docs` — the docs site (separate build).

### Request flow

1. `packages/server/src/server.ts` boots: initialises DB → templates → Redis (if configured) → AnimeDatabase / SeaDex / Prowlarr preconfigured indexers → registers scheduled `TaskManager` jobs (user pruning, cache eviction) → starts analytics → `app.listen`.
2. `packages/server/src/app.ts` mounts routers:
   - `/api/v{API_VERSION}/*` — JSON API consumed by the SPA (`user`, `health`, `status`, `format`, `catalogs`, `posters`, `oauth/exchange/gdrive`, `debrid`, `search`, `anime`, `proxy`, `templates`, `sync`, `auth`, `dashboard`). 404 handler is scoped to the API router.
   - `/stremio/...` — Stremio protocol endpoints. Public manifest/stream/configure routes are mounted directly; authenticated routes live under `/stremio/:uuid/:encryptedPassword` and go through `userDataMiddleware`, which resolves the `UserData` for the rest of the pipeline.
   - `/chilllink/:uuid/:encryptedPassword/*`, `/seanime/*`, `/builtins/*` (the last gated by `internalMiddleware`).
   - Legacy `/:config/stream/...` returns a single "reconfigure" stream pointing at the new configure URL. Legacy `/configure` redirects to `/stremio/configure`.
   - Static: `/assets/*` is content-hashed and served with `immutable` cache headers and bypasses the static rate limiter; `/logo.png`, favicons, manifest icons go through `staticRateLimiter`; SPA fallback serves `index.html`.
3. Stream requests construct an `AIOStreams` instance (`packages/core/src/main/index.ts`) from the resolved `UserData`. The constructor wires a pipeline of singletons: `Proxifier`, `StreamLimiter`, `StreamFilterer`, `StreamPrecomputer`, `StreamFetcher`, `StreamDeduplicator`, `StreamSorter`. The `setup.ts` helpers (`applyPresets`, `assignPublicIps`, `fetchManifests`, `buildResources`) turn the user's preset selections into concrete `Addon` instances and resolved manifests; `resources.ts` / `catalog.ts` implement the actual `getStreams` / `getCatalog` / `getMeta` / `getSubtitles` / `getAddonCatalog` calls.

### Presets vs builtins

- **Presets** (`packages/core/src/presets/*.ts`, ~80 files, registered in `presetManager.ts`) describe how to configure and call an external Stremio addon (Torrentio, Comet, MediaFusion, Easynews, etc.). Each preset extends a common `Preset` base in `preset.ts` and exposes configuration metadata consumed by the SPA. When adding a new community addon, add a preset file and register it in `presetManager.ts`.
- **Builtins** (`packages/core/src/builtins/*`) are addon implementations hosted in-process (gdrive, knaben, prowlarr, torznab/newznab, eztv, torrent-galaxy, seadex, easynews-search, library, …). They are exposed under `/builtins/<name>` via routes in `packages/server/src/routes/builtins`, and the `internalMiddleware` enforces that they are only called by the engine itself.

### Configuration

- `packages/core/src/config` owns all runtime configuration. `bootstrap.ts` reads env vars via `envalid`; `schema/` defines the user-data shape with zod; `describe.ts` produces metadata for the SPA and for `pnpm gen:env-docs`. After changing any env var or user-data schema, run `pnpm gen:env-docs` and rebuild.
- Per-user configuration is persisted via `packages/core/src/db` (repositories + migrations). The DB layer abstracts SQLite (`better-sqlite3`) and Postgres (`pg`) behind a shared driver — pick by setting the `DATABASE_URI` env var.
- Caching has three backends behind one `Cache` API: in-memory, SQL (rows in the configured DB), and Redis (if `REDIS_URI` is set). The cache clearing tasks in `server.ts` reflect this.

### Frontend

- Routing: TanStack Router with file-based routes in `packages/frontend/src/routes`. The `router.tsx` wires it up.
- Data: TanStack Query against `/api/v{N}/...`. The SPA never talks to `/stremio/*` directly.
- UI: Tailwind 3 + Radix primitives + `class-variance-authority` for variants; `framer-motion`/`motion` for animation.

### Release flow

- `release-please-config.json` drives release-please (conventional commits → version bumps → changelog). `pnpm release` (commit-and-tag-version) is the local equivalent. The CI workflow `.github/workflows/deploy-docker.yml` builds and publishes the Docker image.

## Conventions

- ES modules everywhere (`"type": "module"`). Relative imports inside a package must include the `.js` extension (TypeScript NodeNext resolution) — e.g. `from '../db/index.js'` even though the source is `.ts`.
- Cross-package imports use the workspace name: `from '@aiostreams/core'`.
- Logger: `createLogger('<scope>')` from `@aiostreams/core` (Pino under the hood); do not `console.log`.
- Errors that prevent startup should be thrown as `ConfigStartupError` — `server.ts` prints those without a stack trace.
