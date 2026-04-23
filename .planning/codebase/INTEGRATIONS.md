# External Integrations

**Analysis Date:** 2026-04-23

## APIs & External Services

**OpenAI (book insights, optional):**
- Service: OpenAI Chat Completions API.
- SDK: `openai` 6.16.0 (`apps/server/src/ai/open-ai-service.ts`).
- Client init: `new OpenAI({ apiKey, project?, organization? })`, cached at module level.
- Model: `gpt-4o` with `response_format: { type: 'json_object' }`.
- Output: validated with Zod schema `{ genres: string[], summary: string }`.
- Auth env vars: `OPENAI_API_KEY` (required to enable the feature), optional `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`.
- Also declared in `turbo.json` `globalEnv`: `OPENAI_API_URL`, `OPENAI_API_VERSION` (not consumed in current code but reserved for future override).
- Route surface: `GET /api/ai/book-insights?title=...&author=...` (`apps/server/src/ai/open-ai-router.ts`).
- Failure mode: returns `undefined` when `OPENAI_API_KEY` is absent; route returns 500 on any other error.

**Open Library (book covers + search, public, no auth):**
- Hosts: `https://openlibrary.org` and `https://covers.openlibrary.org` (constants in `apps/server/src/open-library/open-library-service.ts`).
- Transport: native `fetch` (no SDK).
- Operations:
  - `OpenLibraryService.searchBooks` → `GET /search.json?q=...&limit=...&lang=eng&fields=key,cover_i`.
  - `OpenLibraryService.queryCoverForKey` → `GET {key}/editions.json`.
  - `OpenLibraryService.fetchCover` → `GET /b/id/{coverId}-{S|M|L}.jpg`.
- Route surface (`apps/server/src/open-library/open-library-router.ts`):
  - `GET /api/open-library/list-covers?searchTerm=...&limit=...`.
  - `GET /api/open-library/cover?coverId=...&bookId=...&size=S|M|L` - downloads cover bytes and writes `${DATA_PATH}/covers/{book.md5}.jpg`.
- Auth: none required; no API key stored.

**KOReader (KOReader Sync / kosync protocol, inbound):**
- KoInsight re-implements the KOReader `kosync` server HTTP contract verbatim.
- Router: `apps/server/src/kosync/kosync-router.ts`, mounted at `/` in `apps/server/src/app.ts` (must remain at root for KOReader compatibility).
- Endpoints:
  - `POST /users/create` → 201 / 402 (user exists).
  - `GET /users/auth` (headers `x-auth-user`, `x-auth-key`).
  - `PUT /syncs/progress` (authenticated upsert of `{document, progress, percentage, device, device_id}`).
  - `GET /syncs/progress/:document` (authenticated read).
  - `GET /syncs/progress` (lists all, currently unauthenticated).
- Auth scheme: custom headers `x-auth-user` + `x-auth-key` verified in `apps/server/src/kosync/kosync-authenticate-middleware.ts`.
- Password storage: bcryptjs, 12 salt rounds (`apps/server/src/kosync/user-repository.ts`).

**KOReader plugin API (custom, inbound from Lua plugin):**
- Router: `apps/server/src/koplugin/koplugin-router.ts`, mounted at `/api/plugin`.
- Endpoints:
  - `POST /api/plugin/device` - registers `{id, model}`.
  - `POST /api/plugin/import` - bulk upload of `{books, stats, annotations, device_id, version}`.
  - `GET /api/plugin/health`.
  - `GET /api/plugin/download` - streams the `plugins/` folder as `koinsight.plugin.zip` via `archiver`.
- Version gate: middleware `rejectOldPluginVersion` requires `version === '0.3.0'` (`REQUIRED_PLUGIN_VERSION`); matches `plugins/koinsight.koplugin/const.lua`.
- Client side: `plugins/koinsight.koplugin/call_api.lua` uses `socket.http` + `ltn12` + `JSON` (KOReader built-ins).
- Server URL is configured per device in the KOReader plugin settings (`plugins/koinsight.koplugin/settings.lua`, key `server_url`).

## Data Storage

**Databases:**
- SQLite via Knex + better-sqlite3.
- Files:
  - Dev: `${DATA_PATH}/dev.sqlite3` (`apps/server/src/config.ts` `appConfig.db.dev`).
  - Prod: `${DATA_PATH}/prod.sqlite3`.
  - Test: `:memory:` (`apps/server/src/knexfile.ts`).
- Connection: one shared instance in `apps/server/src/knex.ts` for runtime/migrations/seeds.
- Migrations: `apps/server/src/db/migrations/` (14 migrations through `20251230000002_add_annotation_total_pages.ts`).
- Seeds: `apps/server/src/db/seeds/` (Faker-backed).
- Uploaded KOReader DB: stored at `${DATA_PATH}/statistics.sqlite3` (config `appConfig.upload.path`), parsed via `sqlite3` driver.

**File Storage:**
- Local filesystem only, under `appConfig.dataPath`:
  - `covers/{book.md5}.jpg` - fetched Open Library covers.
  - `statistics.sqlite3` - last uploaded KOReader DB.
- Multer writes uploads with `MAX_FILE_SIZE_MB` cap (default 100, Express body parsers also raised to 50 MB in `apps/server/src/app.ts`).

**Caching:**
- No external cache service.
- Module-level singleton cache for the OpenAI client (`apps/server/src/ai/open-ai-service.ts`).
- SWR on the web provides client-side response caching.

## Authentication & Identity

**KOReader users (kosync):**
- Custom user table (`User`, migration `20250401091204_create_user_table.ts`).
- Credentials sent as `x-auth-user` / `x-auth-key` HTTP headers.
- Hashing: bcryptjs 12 rounds (`apps/server/src/kosync/user-repository.ts`).
- Applied to: `PUT /syncs/progress`, `GET /syncs/progress/:document` (middleware `authenticate` in `apps/server/src/kosync/kosync-authenticate-middleware.ts`).

**Web / plugin REST API:**
- No authentication on `/api/devices`, `/api/books`, `/api/stats`, `/api/upload`, `/api/open-library`, `/api/ai`, or `/api/plugin/*`.
- CORS is open (`origin: '*'`) in all environments in `apps/server/src/app.ts`.

## Monitoring & Observability

**Error Tracking:**
- None. Errors are logged via `console.error` / `console.warn` only (e.g. `apps/server/src/koplugin/koplugin-router.ts`, `apps/server/src/kosync/kosync-router.ts`).

**Logs:**
- HTTP access log: `morgan('tiny')` to stdout (`apps/server/src/app.ts`).
- Application log: direct `console.*` calls; no structured logger.
- Plugin side: KOReader `logger` module (`logger.dbg`, `logger.err`) in `plugins/koinsight.koplugin/call_api.lua`.

## CI/CD & Deployment

**Hosting:**
- Self-hosted via Docker. `Dockerfile` builds a multi-stage `node:22-alpine` image.
- `compose.yaml` defines a single `koinsight` service, port `3005:3000`, volumes `./.docker-data:/app/data` and `./.env:/app/.env`, `restart: unless-stopped`.

**CI Pipeline:**
- Not detected in the repository tree examined (no `.github/workflows`, no `.gitlab-ci.yml` observed at root).

**Release:**
- `release.sh` script present at repo root (contents not inspected here).
- `CHANGELOG.md` tracks versions; current version `0.2.2` in root and workspace `package.json` files.

## Environment Configuration

**Required env vars (by feature):**
- Always optional (sensible defaults): `HOSTNAME`, `PORT`, `DATA_PATH`, `MAX_FILE_SIZE_MB`, `NODE_ENV`.
- Required for `/api/ai/book-insights`: `OPENAI_API_KEY`.
- Optional OpenAI scoping: `OPENAI_ORG_ID`, `OPENAI_PROJECT_ID`, `OPENAI_API_URL`, `OPENAI_API_VERSION`.
- Required for web dev server customization: `VITE_WEB_HOSTNAME`, `VITE_WEB_PORT`.

**Secrets location:**
- `.env` file at repo root (mounted into container via `compose.yaml`).
- No secret-management service integrated; no `.env` file present currently (existence noted only).
- Passwords hashed at rest in SQLite `User.password_hash`.

## Webhooks & Callbacks

**Incoming:**
- None beyond the kosync and plugin REST endpoints described above. No push-style webhooks from third parties.

**Outgoing:**
- None. The server initiates outbound HTTPS only to Open Library (`openlibrary.org`, `covers.openlibrary.org`) and OpenAI (`api.openai.com` via the SDK).

## KOReader Plugin Link

- Plugin constant `const.VERSION = "0.3.0"` (`plugins/koinsight.koplugin/const.lua`) must equal server constant `REQUIRED_PLUGIN_VERSION` (`apps/server/src/koplugin/koplugin-router.ts`). Bump both together.
- Lua HTTP client (`plugins/koinsight.koplugin/call_api.lua`) expects JSON responses starting with `{`; non-JSON bodies raise an InfoMessage on the device.
- Plugin settings are stored via `LuaSettings` at `${KOReader settings}/koinsight.lua` (`plugins/koinsight.koplugin/settings.lua`).

---

*Integration audit: 2026-04-23*
