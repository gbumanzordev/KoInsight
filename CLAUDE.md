# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

KoInsight is a self-hostable dashboard for KOReader reading statistics. It is an npm-workspaces + Turbo monorepo with:

- `apps/server` — Express 5 + TypeScript API, SQLite (better-sqlite3) via Knex.
- `apps/web` — React 18 + Vite + Mantine UI frontend, data fetched via SWR.
- `packages/common` — Shared TypeScript types consumed by both apps as `@koinsight/common`.
- `plugins/koinsight.koplugin` — Lua plugin that runs inside KOReader and uploads stats/annotations to the server.

## Common commands

Run from the repository root unless otherwise noted.

```bash
npm install                               # install all workspaces
npm run dev                               # Turbo: run server + web in parallel
npm run build                             # Turbo: build all workspaces
npm run test:coverage                     # Turbo: run all tests with coverage
npm run seed                              # seed dev SQLite DB with fake data

# Server-only
npm --workspace=server run dev            # nodemon on src/app.ts
npm --workspace=server test               # vitest (builds migrations first)
npm --workspace=server run test:watch
npm --workspace=server run knex migrate:latest
npm --workspace=server run knex migrate:make <name>
npm --workspace=server run knex seed:run -- --specific=<file>.ts

# Web-only
npm --workspace=web run dev               # vite dev server
npm --workspace=web run build

# Formatting
npx prettier --write .
npx prettier --check .
```

Single test: `npm --workspace=server exec vitest run path/to/file.test.ts` (run `npm --workspace=server run build:migrations` first if migration types are stale; the top-level `test` script does this automatically).

Node >=22 and npm 10.2.4 are required (see root `package.json` `engines` / `packageManager`).

## Runtime architecture

### Server startup (`apps/server/src/app.ts`)

On boot, the server runs Knex migrations against the SQLite DB at `${DATA_PATH}/dev.db` (or `prod.db`), then mounts these routers on a single Express app:

- `/` — `kosyncRouter`. Mounted at root deliberately so it matches the KOReader kosync HTTP API verbatim; don't move it under `/api`.
- `/api/plugin` — endpoints used by the Lua `koinsight.koplugin` (bulk stats + annotations sync, plugin ZIP download).
- `/api/devices`, `/api/books`, `/api/stats`, `/api/upload`, `/api/open-library`, `/api/ai` — frontend/API routes.
- Static: serves the built React app from `appConfig.webBuildPath` with a catch-all `/.*/` route that returns `index.html` (SPA fallback).

`express.json`/`urlencoded` are configured with a 50mb limit because clients upload full `statistics.sqlite` databases. CORS is currently open (`origin: '*'`) even in production.

### Data layer

- One Knex instance (`apps/server/src/knex.ts`) shared by runtime code, migrations, seeds, and tests.
- Migrations live in `apps/server/src/db/migrations/`; seeds in `apps/server/src/db/seeds/`. Tests compile migrations via `build:migrations` (separate `tsconfig.migrations.json`) before running — if you add a migration and tests fail to find it, rebuild.
- Faker-based factories under `apps/server/src/db/` back the `npm run seed` command.

### Cross-cutting packages

- `@koinsight/common` exports shared domain types (books, devices, stats, annotations, kosync). Any type used by both the API response shape and the web client belongs here, not duplicated.
- The Vite dev server proxies `/api` to the backend; in production the Express server serves the built web assets directly, so there is only one port in production.

### KOReader plugin (`plugins/koinsight.koplugin`)

Pure Lua, no build step. `main.lua` wires the KOReader menu; `call_api.lua` talks to `/api/plugin/*`; `db_reader.lua` / `annotation_reader.lua` extract from KOReader's local `statistics.sqlite` and per-book sidecar files. The server exposes a ZIP download of this folder so users can install it from the web UI.

## Configuration

Environment variables (see `apps/server/src/config.ts` and `turbo.json` globalEnv):

- `HOSTNAME` (default `localhost`), `PORT` (default `3000`)
- `DATA_PATH` — SQLite + uploads directory. Defaults to `../../../data` in dev, `/app/data` in the Docker image.
- `MAX_FILE_SIZE_MB` (default 100) — upload cap for Multer.
- `OPENAI_API_KEY` / `OPENAI_API_URL` / `OPENAI_API_VERSION` — required only for `/api/ai` routes.
- `NODE_ENV`, `VITE_WEB_HOSTNAME`, `VITE_WEB_PORT`.

## Conventions

- Formatting is Prettier-only (no ESLint). Format before committing.
- Zod is the server-side validation library; prefer it over hand-rolled checks at route boundaries.
- Ramda is used in both apps; idiomatic functional style is common in existing code.
- When adding a route that the KOReader plugin calls, update `plugins/koinsight.koplugin/call_api.lua` and `const.lua` in the same change — there is no schema shared between Lua and TypeScript.
