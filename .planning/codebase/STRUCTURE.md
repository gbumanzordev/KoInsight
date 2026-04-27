# Codebase Structure

**Analysis Date:** 2026-04-23

## Directory Layout

```
KoInsight/
├── apps/
│   ├── server/              # Express 5 + TS API, SQLite via Knex
│   │   ├── src/
│   │   ├── test/setup/      # Vitest global setup
│   │   ├── vitest.config.ts
│   │   ├── tsconfig.json
│   │   └── tsconfig.migrations.json
│   └── web/                 # React 18 + Vite + Mantine + SWR
│       ├── src/
│       ├── public/
│       ├── index.html
│       ├── vite.config.ts
│       └── postcss.config.js
├── packages/
│   └── common/              # Shared TS types (@koinsight/common)
│       ├── types/
│       ├── package.json
│       └── tsconfig.json
├── plugins/
│   └── koinsight.koplugin/  # Lua plugin for KOReader (no build)
├── bruno/                   # Bruno API request collections
├── images/                  # README screenshots
├── compose.yaml             # Docker Compose
├── Dockerfile
├── turbo.json               # Turbo pipeline (build/dev/test)
├── package.json             # Root workspaces + npm scripts
├── .prettierrc              # Prettier config (no ESLint)
├── stylua.toml              # Lua formatter config
├── release.sh
├── CLAUDE.md
├── DEVELOPMENT.md
└── README.md
```

## Directory Purposes

**`apps/server/src/`:**
- Purpose: Express API runtime, migrations, seeds, factories, route/service/repository modules.
- Contains: One subfolder per feature plus top-level entry files.
- Key files: `app.ts` (entry), `config.ts`, `knex.ts`, `knexfile.ts`.

**`apps/web/src/`:**
- Purpose: React SPA consumed by Vite.
- Contains: `api/` (SWR clients), `components/`, `pages/`, `utils/`, `assets/`, `routes.ts`, `app.tsx`, `index.tsx`.

**`packages/common/types/`:**
- Purpose: Shared domain types imported as `@koinsight/common`.
- Contains: `book.ts`, `book-device.ts`, `book-genre.ts`, `books-api.ts`, `annotation.ts`, `device.ts`, `genre.ts`, `page-stat.ts`, `progress.ts`, `stats-api.ts`, `user.ts`, `openai.ts`, `index.ts`.

**`plugins/koinsight.koplugin/`:**
- Purpose: KOReader Lua plugin; no build step.
- Files: `main.lua` (menu wiring), `call_api.lua` (HTTP to `/api/plugin/*`), `const.lua` (route constants), `db_reader.lua` (reads local `statistics.sqlite`), `annotation_reader.lua` (per-book sidecar parser), `upload.lua`, `settings.lua`, `_meta.lua`.

## `apps/server/src/` module layout

**Entry + cross-cutting:** `app.ts`, `config.ts`, `knex.ts`, `knexfile.ts`.

**`books/`** `books-router.ts`, `books-service.ts`, `books-repository.ts`, `get-book-by-id-middleware.ts`, plus `covers/covers-router.ts`, `covers/covers-service.ts`.

**`stats/`** `stats-router.ts`, `stats-service.ts`, `stats-repository.ts`.

**`annotations/`** `annotations-repository.ts` (router lives inside `books-router.ts` + `koplugin-router.ts`).

**`devices/`** `devices-router.ts`, `device-repository.ts`.

**`genres/`** `genre-repository.ts` (no standalone router, consumed by books).

**`kosync/`** `kosync-router.ts`, `kosync-repository.ts`, `kosync-authenticate-middleware.ts`, `user-repository.ts`. Mounted at `/` (not `/api`) to match KOReader's kosync protocol verbatim.

**`koplugin/`** `koplugin-router.ts` (bulk stats + annotations sync endpoints consumed by the Lua plugin; also serves plugin ZIP).

**`upload/`** `upload-router.ts`, `upload-service.ts` (Multer-based `statistics.sqlite` ingestion, 50mb JSON and `MAX_FILE_SIZE_MB` file caps).

**`ai/`** `open-ai-router.ts`, `open-ai-service.ts` (mounted at `/api/ai`, gated on `OPENAI_API_KEY`).

**`open-library/`** `open-library-router.ts`, `open-library-service.ts`, `open-library-types.ts`.

**`utils/`** `ranges.ts`, `strings.ts` and their co-located tests.

**`db/`:**
- `migrations/` timestamped Knex migrations (`YYYYMMDDHHMMSS_<snake_case>.ts`), compiled via `tsconfig.migrations.json` into `dist/` before tests.
- `seeds/` numbered seeds (`01_devices.ts`..`07_users_progress.ts`) driving `npm run seed`.
- `factories/` Faker factories (`book-factory.ts`, `annotation-factory.ts`, `device-factory.ts`, `genre-factory.ts`, `page-stat-factory.ts`, `progress-factory.ts`, `user-factory.ts`, `book-device-factory.ts`, `koreader-annotation-factory.ts`).

## `apps/web/src/` layout

**Root files:** `index.tsx` (bootstrap), `app.tsx` + `app.module.css` (shell), `routes.ts` (React Router config), `index.css`, `vite-env.d.ts`.

**`api/`** SWR/fetch clients: `api.ts` (base), `books.ts`, `devices.ts`, `kosync.ts`, `open-library.ts`, `upload-db-file.ts`, plus composite hooks `use-book-with-data.ts`, `use-page-stats.ts`.

**`components/`** one subfolder per component group:
- `calendar/` (`calendar.tsx`, `calendar-week.tsx` + CSS modules)
- `charts/` (`custom-bar.tsx`)
- `dot-trail/`, `empty-state/`, `logo/`
- `navbar/` (`navbar.tsx`, `upload-form.tsx`, `download-plugin.tsx`)
- `statistics/` (`statistics.tsx`, `statistic.tsx`, `reading-calendar.tsx`)

**`pages/`** feature page folders + standalone pages:
- `book-page/` (`book-page.tsx`, `book-card.tsx`, `book-page-raw.tsx`, `book-page-calendar.tsx`) with nested `book-page-annotations/`, `book-page-manage/`, `components/`.
- `books-page/` (`books-page.tsx`, `books-cards.tsx`, `books-table.tsx`).
- `stats-page/` (`stats-page.tsx`, `week-stats.tsx`).
- `calendar-page.tsx`, `syncs-page.tsx`.

**`utils/`** `dates.ts`. **`assets/`** SVG logos.

Hooks that are feature-scoped live beside their consumer (e.g. `pages/book-page/book-page-annotations/use-annotation-filters.ts`); cross-feature hooks live in `api/`.

## Naming Conventions

**Files:** kebab-case everywhere (`books-router.ts`, `book-card.tsx`, `use-annotation-filters.ts`). Migrations prefix a Knex timestamp; seeds prefix a two-digit order.

**Feature-suffix pattern (server):** `<feature>-router.ts`, `<feature>-service.ts`, `<feature>-repository.ts`, `<feature>-*-middleware.ts` (for example `kosync-authenticate-middleware.ts`, `get-book-by-id-middleware.ts`). Tests mirror the suffix: `<feature>-router.test.ts`, `<feature>-repository.test.ts`, and topic-scoped variants (`books-service-annotations.test.ts`, `upload-service-soft-delete.test.ts`).

**Components (web):** file named after the default export in kebab-case; matching CSS Module `<name>.module.css` sits next to the component.

**Types (`@koinsight/common`):** singular domain nouns (`book.ts`, `device.ts`); API-shape bundles use the `-api.ts` suffix (`books-api.ts`, `stats-api.ts`); re-exported through `types/index.ts`.

## Key File Locations

**Entry points:**
- `apps/server/src/app.ts`: Express bootstrap, mounts all routers, runs migrations, serves SPA fallback.
- `apps/web/src/index.tsx`: React entry; `apps/web/src/app.tsx` + `apps/web/src/routes.ts` wire routing.
- `plugins/koinsight.koplugin/main.lua`: KOReader plugin entry.

**Configuration:**
- `apps/server/src/config.ts`: reads `HOSTNAME`, `PORT`, `DATA_PATH`, `MAX_FILE_SIZE_MB`, `OPENAI_*`.
- `apps/server/src/knexfile.ts`: Knex config used by CLI + runtime.
- `turbo.json`: pipeline + `globalEnv`.
- `apps/web/vite.config.ts`: dev proxy for `/api` to backend.

**Testing:**
- `apps/server/vitest.config.ts`: loads `apps/server/test/setup/test-setup.ts` (fresh SQLite + migrations per suite).
- `apps/server/tsconfig.migrations.json`: compiles migrations to JS before Vitest runs (triggered by `build:migrations`).

**SPA fallback:** served inside `apps/server/src/app.ts` via catch-all `/.*/` returning `appConfig.webBuildPath/index.html`.

**Plugin ZIP:** generated/served from `apps/server/src/koplugin/koplugin-router.ts` (sources `plugins/koinsight.koplugin/`).

## Where to Add New Code

**New server feature:** create `apps/server/src/<feature>/` with `<feature>-router.ts`, `<feature>-service.ts`, `<feature>-repository.ts`, and co-located `*.test.ts`. Mount the router from `apps/server/src/app.ts` under `/api/<feature>` (never under `/api` for kosync-compatible endpoints).

**New DB table:** `npm --workspace=server run knex migrate:make <name>` (writes to `apps/server/src/db/migrations/`); add a factory in `apps/server/src/db/factories/` and a numbered seed in `apps/server/src/db/seeds/`. Add the row type to `packages/common/types/` and re-export from `types/index.ts`.

**New KOReader plugin endpoint:** add route under `apps/server/src/koplugin/koplugin-router.ts` and update `plugins/koinsight.koplugin/call_api.lua` + `const.lua` in the same change (no shared schema).

**New web page:** create `apps/web/src/pages/<page-name>/<page-name>.tsx` (or flat `.tsx` for single-file pages like `calendar-page.tsx`), register in `apps/web/src/routes.ts`, add SWR client in `apps/web/src/api/`.

**New component:** `apps/web/src/components/<component>/<component>.tsx` plus `<component>.module.css` co-located.

**Shared type:** `packages/common/types/<name>.ts` re-exported through `packages/common/types/index.ts`.

## Co-location Rules

- Server tests live beside their source (`books-router.ts` + `books-router.test.ts`), not in a separate `__tests__/` folder. Topic-specific tests use a third suffix segment (`upload-service-soft-delete.test.ts`).
- Web CSS Modules sit beside their component (`navbar.tsx` + `navbar.module.css`, `book-card.tsx` + `book-card.module.css`).
- Feature-scoped hooks live inside the page/feature folder (`pages/book-page/book-page-annotations/use-annotation-filters.ts`); cross-cutting SWR hooks live under `apps/web/src/api/` (`use-book-with-data.ts`, `use-page-stats.ts`).
- Nested page folders may expose an `index.ts` barrel (`pages/book-page/book-page-annotations/index.ts`).

## Special Directories

**`apps/server/src/db/migrations/`:** hand-authored, but also compiled to JS under `dist/` via `build:migrations` for Vitest. Both the `.ts` sources and generated output are required for tests.

**`bruno/`:** Bruno API request collections checked into the repo for manual API testing.

**`data/` (dev) or `/app/data` (Docker):** runtime `dev.db`/`prod.db` + uploads directory. Not committed; created by `config.ts` at boot.

**`plugins/koinsight.koplugin/`:** served as a zipped download by the server so end users can install the plugin from the web UI.
