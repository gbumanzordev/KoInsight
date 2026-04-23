# Architecture

**Analysis Date:** 2026-04-23

## Pattern Overview

**Overall:** npm-workspaces + Turbo monorepo with a three-tier layered architecture (router -> service -> repository) on the backend, a SPA frontend, and a Lua-based KOReader plugin that talks to the backend over HTTP.

**Key Characteristics:**
- Single Express 5 process serves both the JSON API and the built React SPA (one port in production); Vite dev server proxies `/api` to the backend during development.
- SQLite via Knex is the sole datastore. Migrations run automatically on server boot in `apps/server/src/app.ts` before the HTTP server is bound.
- Strict vertical slicing on the server: each domain (`books`, `stats`, `devices`, `annotations`, `kosync`, `koplugin`, `upload`, `ai`, `open-library`, `genres`) owns its router, service, repository, and tests under `apps/server/src/<domain>/`.
- Shared domain types live exclusively in `packages/common/types` and are imported as `@koinsight/common/types/*` from both apps. No types are duplicated across the server/web boundary.
- The KOReader Lua plugin is a separate runtime deployed to end-user e-readers; it contacts the server through a versioned `/api/plugin/*` contract gated by `REQUIRED_PLUGIN_VERSION`.

## Layers

**Router layer (HTTP boundary):**
- Purpose: Parse requests, run auth/lookup middleware, delegate to services/repositories, and shape JSON responses.
- Location: `apps/server/src/<domain>/<domain>-router.ts`
- Contains: Express `Router` instances with per-route handlers. Input validation is ad-hoc (missing-field checks) and Zod where present (`apps/server/package.json` lists `zod`).
- Depends on: Service and repository classes in the same folder, shared middleware (`get-book-by-id-middleware.ts`, `kosync-authenticate-middleware.ts`).
- Used by: `apps/server/src/app.ts` mounts each router at a fixed path.

**Service layer (domain logic):**
- Purpose: Stateless domain logic that composes repositories, derives computed values, and orchestrates multi-step operations (e.g., ingesting a KOReader statistics DB).
- Location: `apps/server/src/<domain>/<domain>-service.ts`
- Contains: Static class methods (see `BooksService` in `apps/server/src/books/books-service.ts` and `UploadService` in `apps/server/src/upload/upload-service.ts`).
- Depends on: Repositories across domains, `@koinsight/common/types`, Ramda, date-fns.
- Used by: Routers and other services (cross-domain calls are allowed from services, not from repositories to other repositories where avoidable).

**Repository layer (persistence):**
- Purpose: All Knex queries and transactions live here. Encapsulates SQL, including hand-written `db.raw(...)` aggregations for `getAllWithData`.
- Location: `apps/server/src/<domain>/<domain>-repository.ts`
- Contains: Static class methods returning typed rows (e.g., `BooksRepository` in `apps/server/src/books/books-repository.ts`, `KosyncRepository`, `StatsRepository`, `AnnotationsRepository`, `DeviceRepository`, `GenreRepository`, `UserRepository`).
- Depends on: The single Knex instance from `apps/server/src/knex.ts` and shared types.
- Used by: Services and routers.

**Shared types package:**
- Purpose: Source of truth for domain models and API payload shapes.
- Location: `packages/common/types/` (barrel at `packages/common/types/index.ts`).
- Consumed via `@koinsight/common/types` from both `apps/server` and `apps/web`.

**Web application layer:**
- Purpose: Render reading statistics UI, configure routing and theming, fetch data with SWR.
- Location: `apps/web/src/`
- Contains: `app.tsx` (providers + `<Routes>`), `index.tsx` (React root), `routes.ts` (route enum and path helpers), `api/` (fetchers), `pages/` (route-level components), `components/` (shared UI), `utils/`.
- Depends on: Mantine UI, React Router 7, SWR, Recharts, `@koinsight/common/types`.

**KOReader plugin layer:**
- Purpose: Extract statistics and annotations from the device and ship them to the server.
- Location: `plugins/koinsight.koplugin/`
- Contains: `main.lua` (menu wiring), `call_api.lua` (HTTP client to `/api/plugin/*`), `db_reader.lua` (reads KOReader's `statistics.sqlite`), `annotation_reader.lua` (parses per-book sidecar files), `upload.lua`, `settings.lua`, `const.lua`, `_meta.lua`.
- Depends on: KOReader's Lua runtime only; no build step.

## Data Flow

**KOReader plugin sync (primary ingestion path):**

1. User triggers sync in KOReader; `plugins/koinsight.koplugin/main.lua` invokes `call_api.lua`.
2. `db_reader.lua` and `annotation_reader.lua` produce `{ books, stats, annotations, device_id, version }`.
3. `POST /api/plugin/import` hits `apps/server/src/koplugin/koplugin-router.ts`, which gates on `REQUIRED_PLUGIN_VERSION` via `rejectOldPluginVersion`.
4. `UploadService.uploadStatisticData` in `apps/server/src/upload/upload-service.ts` opens a Knex transaction, upserts books (`onConflict('md5').ignore()`), registers devices, inserts page stats, and upserts annotations via `AnnotationsRepository`.
5. Response returns `{ message: 'Upload successful' }`; the plugin clears its local staging state.

**Manual statistics.sqlite upload (legacy path):**

1. User drops `statistics.sqlite3` in the web UI; `POST /api/upload` (Multer-backed, `apps/server/src/upload/upload-router.ts`) writes it under `appConfig.upload.path`.
2. `UploadService.openStatisticsDbFile` opens the uploaded file via `better-sqlite3` in read-only mode.
3. `UploadService.extractDataFromStatisticsDb` maps KOReader rows to KoInsight rows and reuses `uploadStatisticData` to persist them with the sentinel `manual-upload` device ID.

**KoSync progress sync (KOReader native protocol):**

1. KOReader's built-in KoSync client hits `/users/auth`, `PUT /syncs/progress`, `GET /syncs/progress/:document` at the server root (not under `/api`).
2. `apps/server/src/kosync/kosync-router.ts` authenticates via `x-auth-user` / `x-auth-key` headers (see `kosync-authenticate-middleware.ts`) backed by `UserRepository` with bcryptjs password hashes.
3. `KosyncRepository.upsert` persists progress rows; `GET` returns the latest per-document progress.

**Web dashboard read path:**

1. `apps/web/src/index.tsx` bootstraps React with `BrowserRouter` and `NuqsAdapter` (URL-state syncing).
2. `apps/web/src/app.tsx` mounts `<Routes>` matching `apps/web/src/routes.ts` (`/books`, `/books/:id`, `/calendar`, `/stats`, `/syncs`).
3. Pages call SWR hooks from `apps/web/src/api/*` (e.g., `use-book-with-data.ts`, `use-page-stats.ts`), which wrap `fetchFromAPI` in `apps/web/src/api/api.ts`.
4. `fetchFromAPI` targets `${VITE_WEB_API_URL ?? ''}/api/<endpoint>`; in production the base is empty because the SPA is served from the same origin as the API.

**State Management:**
- Server: stateless between requests; all state in SQLite.
- Web: SWR cache for server state, `nuqs` for URL-synced filter state, component-local `useState` for UI state. No Redux/Zustand.

## Key Abstractions

**Domain "slice" (router + service + repository trio):**
- Purpose: Encapsulate one bounded context end-to-end.
- Examples: `apps/server/src/books/`, `apps/server/src/stats/`, `apps/server/src/annotations/`, `apps/server/src/devices/`, `apps/server/src/genres/`, `apps/server/src/kosync/`.
- Pattern: Static-method classes (`BooksRepository`, `BooksService`) rather than instance-based DI. Routers export a named `<domain>Router` used by `app.ts`.

**Static-class repository:**
- Purpose: Namespaced bundle of typed Knex queries.
- Examples: `BooksRepository` at `apps/server/src/books/books-repository.ts`, `AnnotationsRepository` at `apps/server/src/annotations/annotations-repository.ts`.
- Pattern: `static async method(args): Promise<Type>` using the shared `db` import. Transactions are expressed inline with `db.transaction(async trx => ...)`.

**Request-augmenting middleware:**
- Purpose: Resolve entities once, attach to `req`, and share between handlers in the same router.
- Examples: `getBookById` in `apps/server/src/books/get-book-by-id-middleware.ts` augments `req.book`; `authenticate` in `apps/server/src/kosync/kosync-authenticate-middleware.ts` augments `req.user`.
- Pattern: Global `declare namespace Express { interface Request { ... } }` type extensions.

**Factory (test/seed data):**
- Purpose: Produce realistic rows with Faker for seeds and repository tests.
- Examples: `apps/server/src/db/factories/book-factory.ts`, `annotation-factory.ts`, `device-factory.ts`, `koreader-annotation-factory.ts`, `page-stat-factory.ts`, `progress-factory.ts`, `user-factory.ts`, `genre-factory.ts`, `book-device-factory.ts`.

**SWR data hook (web):**
- Purpose: Encapsulate endpoint + cache key + response type.
- Examples: `apps/web/src/api/use-book-with-data.ts`, `apps/web/src/api/use-page-stats.ts`.

## Entry Points

**HTTP server:**
- Location: `apps/server/src/app.ts`
- Triggers: `npm --workspace=server run dev` (nodemon) or `node dist/app.js` (production, built via `tsc -b`).
- Responsibilities: Run migrations (`db.migrate.latest({ directory: .../db/migrations })`), build the Express app, register CORS/body/logging middleware, mount routers, serve the built web assets, and install SIGINT/SIGTERM graceful shutdown.

**Router mounts (in `apps/server/src/app.ts`):**
- `app.use('/', kosyncRouter)` - mounted at root so paths like `/users/create`, `/users/auth`, `/syncs/progress/:document` match the KOReader kosync contract verbatim. Do not move under `/api`.
- `app.use('/api/plugin', kopluginRouter)` - `/device`, `/import`, `/health`, `/download` used by the Lua plugin.
- `app.use('/api/devices', devicesRouter)`
- `app.use('/api/books', booksRouter)` - nests `/:bookId/cover` via `coversRouter` from `apps/server/src/books/covers/`.
- `app.use('/api/stats', statsRouter)`
- `app.use('/api/upload', uploadRouter)` - Multer-backed `statistics.sqlite3` upload.
- `app.use('/api/open-library', openLibraryRouter)`
- `app.use('/api/ai', openAiRouter)` - active only when `OPENAI_API_KEY` is set.
- `app.use(express.static(appConfig.webBuildPath))` followed by `app.get(/.*/, ...)` returns `index.html` for unmatched paths (SPA fallback). These must stay last.

**Web SPA:**
- Location: `apps/web/src/index.tsx` -> `apps/web/src/app.tsx`
- Triggers: `vite` (dev) or `vite build` producing `apps/web/dist/`, which the Express server serves.
- Responsibilities: Mount Mantine providers, nuqs adapter, React Router, and the page tree defined by `apps/web/src/routes.ts`.

**KOReader plugin:**
- Location: `plugins/koinsight.koplugin/main.lua`
- Triggers: KOReader menu action.
- Responsibilities: Wire plugin menu, invoke DB/annotation readers, call the server via `call_api.lua` using endpoints listed in `plugins/koinsight.koplugin/const.lua`.

**CLI:**
- `npm --workspace=server run knex migrate:latest|migrate:make|seed:run` - uses `apps/server/src/knexfile.ts` with `DATA_PATH=../../../data`.
- `npm run seed` (root) - runs the server workspace seed command.

## Error Handling

**Strategy:** Per-handler try/catch wrapping the repository/service call; on failure, log with `console.error` and return a JSON error object with an appropriate HTTP status (400 for missing fields, 401 for auth, 404 for not found, 500 for everything else).

**Patterns:**
- Domain errors are signaled by named error classes thrown from repositories and caught in routers; example: `UserExistsError` thrown from `UserRepository.createUser` and mapped to HTTP 402 in `apps/server/src/kosync/kosync-router.ts`.
- Multer and body-parser errors propagate as unhandled responses; there is no global Express error middleware mounted in `apps/server/src/app.ts`.
- Middleware short-circuits with `res.status(...).json(...); return;` rather than calling `next(err)`.
- Frontend `fetchFromAPI` in `apps/web/src/api/api.ts` throws on non-OK responses; SWR surfaces the error to the consuming component.

## Cross-Cutting Concerns

**Logging:**
- HTTP: `morgan('tiny')` registered in `apps/server/src/app.ts`.
- Application: plain `console.debug` / `console.info` / `console.error` calls throughout services and routers. No structured logger.

**Validation:**
- Zod is available (`zod` in `apps/server/package.json`) and preferred for new route boundaries per project conventions, but many existing handlers rely on inline truthiness checks of destructured body fields.
- Plugin version enforcement: `rejectOldPluginVersion` middleware in `apps/server/src/koplugin/koplugin-router.ts` compares `req.body.version` against `REQUIRED_PLUGIN_VERSION = '0.3.0'`.

**Authentication:**
- Kosync/user auth: `authenticate` middleware in `apps/server/src/kosync/kosync-authenticate-middleware.ts` reads `x-auth-user` and `x-auth-key` headers and delegates to `UserRepository.login` (bcryptjs).
- `/api/*` and `/api/plugin/*` routes are unauthenticated; the deployment model assumes a trusted network (self-host).
- CORS is `origin: '*'` in all environments (`apps/server/src/app.ts`), including production.

**Configuration:**
- Centralized in `apps/server/src/config.ts`, reading env vars via `dotenv`. Exposes `appConfig.hostname`, `port`, `env`, `coversPath`, `dataPath`, `webBuildPath`, `upload.*`, `db.dev`, `db.prod`.
- `turbo.json` `globalEnv` declares env vars that invalidate the Turbo cache.

**Database access:**
- Single Knex instance in `apps/server/src/knex.ts` is imported by runtime code, migrations, seeds, and tests. Tests use `:memory:` SQLite per `apps/server/src/knexfile.ts` and consume migrations compiled to `apps/server/test/dist/migrations` by `npm run build:migrations` (separate `tsconfig.migrations.json`).

---

*Architecture analysis: 2026-04-23*
