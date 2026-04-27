# Technology Stack

**Analysis Date:** 2026-04-23

## Languages

**Primary:**
- TypeScript 5.9.3, used across `apps/server`, `apps/web`, and `packages/common`.
- Lua 5.1 (KOReader runtime), used exclusively in `plugins/koinsight.koplugin/` (no build step).

**Secondary:**
- JavaScript (CommonJS config files such as `apps/web/postcss.config.cjs`).
- SQL, emitted via Knex query builder and migration files under `apps/server/src/db/migrations/`.

## Runtime

**Environment:**
- Node.js >= 22 (declared in root `package.json` `engines.node`; Docker base is `node:22-alpine` per `Dockerfile`).
- Browser runtime for web client via Vite 7 (`apps/web/vite.config.ts`).
- KOReader embedded Lua runtime for the plugin (uses `socket.http`, `ltn12`, KOReader `ui/*` modules).

**Package Manager:**
- npm 10.2.4 (`packageManager` field in root `package.json`).
- Lockfile: `package-lock.json` present at repo root.
- Workspace layout: `workspaces: ["apps/*", "packages/*"]` (npm workspaces).
- Task runner: Turbo 2.5.8 (`turbo.json`).

## Frameworks

**Core (server, `apps/server/`):**
- Express 5.2.1 - HTTP API framework (`apps/server/src/app.ts`).
- Knex 3.1.0 - SQL query builder and migration engine (`apps/server/src/knex.ts`, `knexfile.ts`).
- better-sqlite3 12.6.0 - synchronous SQLite driver used as the Knex client.
- sqlite3 5.1.7 - also installed (used for reading uploaded KOReader `statistics.sqlite` files in `apps/server/src/upload/`).
- Zod 4.3.5 - runtime validation (used in `apps/server/src/ai/open-ai-service.ts` and route boundaries).
- Ramda 0.31.1 - functional utilities.
- Multer 2.0.2 - multipart upload handling (`apps/server/src/upload/`).
- Morgan 1.10.1 - HTTP request logging (`tiny` format, configured in `apps/server/src/app.ts`).
- CORS 2.8.5 - configured open (`origin: '*'`) in `apps/server/src/app.ts`.
- bcryptjs 3.0.3 - password hashing for kosync user accounts (`apps/server/src/kosync/user-repository.ts`, 12 salt rounds).
- archiver 7.0.1 - zips the plugin folder for download (`apps/server/src/koplugin/koplugin-router.ts`).
- openai 6.16.0 - OpenAI SDK (`apps/server/src/ai/open-ai-service.ts`).
- date-fns 4.1.0 - date utilities.
- dotenv 17.2.3 - env file loader (`apps/server/src/config.ts`).

**Core (web, `apps/web/`):**
- React 18.3.1 + react-dom 18.3.1.
- Vite 7.3.1 with `@vitejs/plugin-react` 5.1.2 and `vite-plugin-svgr` 4.5.0.
- Mantine UI 8.3.12 - `@mantine/core`, `@mantine/charts`, `@mantine/dates`, `@mantine/hooks`, `@mantine/modals`, `@mantine/notifications`.
- `@tabler/icons-react` 3.36.1 - icon set, aliased in `vite.config.ts` to `@tabler/icons-react/dist/esm/icons/index.mjs` to avoid chunking issues.
- Recharts 2.15.0 - chart primitives complementing Mantine charts.
- React Router 7.9.4 - SPA routing (`apps/web/src/routes.ts`).
- SWR 2.3.8 - client-side data fetching (`apps/web/src/api/`).
- nuqs 2.8.6 - URL query state management.
- clsx 2.1.1 - class name helper.
- PostCSS 8.5.6 with `postcss-preset-mantine` 1.18.0, `postcss-simple-vars` 7.0.1, `autoprefixer` 10.4.23.

**Testing:**
- Vitest 4.0.16 - test runner for the server (`apps/server/package.json` scripts).
- `@vitest/coverage-v8` 4.0.16 - V8 coverage provider.
- `@vitest/ui` 4.0.16 - interactive UI for Vitest.
- Supertest 7.1.4 - HTTP integration testing against Express routers.
- `@faker-js/faker` 10.2.0 - fake data for seeds and test fixtures (`apps/server/src/db/`).
- No test runner configured for `apps/web` (no `test` script in `apps/web/package.json`).

**Build / Dev Tooling:**
- Turbo 2.5.8 - monorepo task orchestration (`turbo.json`); tasks: `build`, `dev` (parallel, persistent), `start`, `test:coverage`.
- TypeScript 5.9.3 - shared across workspaces.
- `tsc -b` for server build (`apps/server/tsconfig.json`, CommonJS, target ES2020).
- Separate `apps/server/tsconfig.migrations.json` compiles migrations to `test/dist/migrations` for test runs.
- `apps/web/tsconfig.json` - ESNext module, `jsx: react-jsx`, `noEmit: true` (Vite handles transpilation).
- `packages/common` uses `tsc` watch mode (`packages/common/package.json`).
- nodemon 3.1.11 + ts-node 10.9.2 + tsx 4.21.0 for server dev (`npm --workspace=server run dev`).
- Prettier 3.6.2 - sole formatter (no ESLint per `CLAUDE.md`).
- stylua configured via `stylua.toml` for Lua formatting.

## Key Dependencies

**Critical:**
- `express` 5.2.1 - single HTTP entry point mounting all routers in `apps/server/src/app.ts`.
- `knex` 3.1.0 + `better-sqlite3` 12.6.0 - entire persistence layer; one Knex instance at `apps/server/src/knex.ts` is shared by runtime, migrations, seeds, and tests.
- `@koinsight/common` (workspace `packages/common`) - shared domain types (books, devices, stats, annotations, kosync, progress, user) imported as `@koinsight/common/types/*`.
- `@mantine/*` 8.3.12 - entire web UI component system.
- `swr` 2.3.8 - web data fetching primitive (`apps/web/src/api/api.ts`).
- `openai` 6.16.0 - optional; only loaded when `OPENAI_API_KEY` is set.
- `archiver` 7.0.1 - required for `/api/plugin/download` distribution endpoint.

**Infrastructure:**
- `dotenv` 17.2.3 - loaded at top of `apps/server/src/config.ts`.
- `cors` 2.8.5 - currently open in both dev and prod (see `apps/server/src/app.ts` comments).
- `morgan` 1.10.1 - request access log.
- `bcryptjs` 3.0.3 - password storage for kosync users.

## Configuration

**Environment variables (from `apps/server/src/config.ts` and `turbo.json` `globalEnv`):**
- `NODE_ENV` - switches Knex environment (`knexfile.ts`: development/production/test).
- `HOSTNAME` - Express bind host (default `127.0.0.1` in code, `localhost` in docs).
- `PORT` - Express port (default `3000`).
- `DATA_PATH` - SQLite DB + uploads + covers directory. Default `../../../data` in dev; `/app/data` in Docker (`Dockerfile`).
- `MAX_FILE_SIZE_MB` - Multer upload cap (default `100`, set to `100` in `Dockerfile`).
- `OPENAI_API_KEY` - enables `/api/ai` endpoints; absent = feature disabled.
- `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID` - optional OpenAI client scoping (read in `apps/server/src/ai/open-ai-service.ts`).
- `OPENAI_API_URL`, `OPENAI_API_VERSION` - declared in `turbo.json` `globalEnv` (forwarded through Turbo cache key).
- `VITE_WEB_HOSTNAME`, `VITE_WEB_PORT` - Vite dev server binding (`apps/web/vite.config.ts`).

**Env file:**
- `.env` referenced as a Turbo `globalDependencies` entry (`turbo.json`) and mounted in Docker (`compose.yaml` mounts `./.env:/app/.env`).
- No `.env` file currently present at repo root (noted existence only, contents never read).

**Server tsconfig (`apps/server/tsconfig.json`):**
- `target: ES2020`, `module: commonjs`, `strict: true`, `rootDir: ./src`, `outDir: ./dist`, `types: ["node", "vitest/globals"]`.

**Migrations tsconfig (`apps/server/tsconfig.migrations.json`):**
- Extends base tsconfig; emits migrations to `apps/server/test/dist/migrations` for the test Knex environment.

**Web tsconfig (`apps/web/tsconfig.json`):**
- `target: ESNext`, `module: ESNext`, `jsx: react-jsx`, `noEmit: true`, `types: ["vite/client", "vite-plugin-svgr/client"]`.

**Build:**
- Server: `tsc -b` → `apps/server/dist/`.
- Web: `vite build` → `apps/web/dist/` (target `esnext`, `emptyOutDir: true`).
- Turbo outputs cached at `dist/**` (`turbo.json`).

## Platform Requirements

**Development:**
- Node >= 22, npm 10.2.4.
- SQLite files are written to `./data/` at repo root by default.
- KOReader installation required only for testing the Lua plugin end-to-end.

**Production:**
- Docker (multi-stage `Dockerfile`, `node:22-alpine` builder + runner).
- `compose.yaml` maps host port `3005` → container `3000`, persists `./.docker-data` to `/app/data`.
- Single Node process serves both API and built React assets (catch-all route in `apps/server/src/app.ts` serves `index.html`).
- `ENV NODE_ENV="production"`, `ENV DATA_PATH="/app/data"`, `ENV MAX_FILE_SIZE_MB="100"` baked into image.

---

*Stack analysis: 2026-04-23*
