# Codebase Concerns

**Analysis Date:** 2026-04-23

## Tech Debt

**No ESLint, Prettier-only formatting**
- Files: `.prettierrc`, `apps/server/package.json`, `apps/web/package.json`
- Impact: No lint rules catch unused imports, unsafe `any`, floating promises, React hooks misuse.
- Fix: Add `eslint` + `@typescript-eslint` + `eslint-config-prettier`; wire into Turbo and CI.

**Zod declared but not used at route boundaries**
- Zod only appears in `apps/server/src/ai/open-ai-service.ts` for OpenAI output parsing. Every router hand-rolls validation with truthiness checks.
- Files: `apps/server/src/koplugin/koplugin-router.ts` (lines 30-35, 49-56), `apps/server/src/kosync/kosync-router.ts` (lines 24-29, 87-98), `apps/server/src/books/books-router.ts` (lines 47-51, 70-74, 89-94), `apps/server/src/upload/upload-router.ts`, `apps/server/src/devices/devices-router.ts`, `apps/server/src/open-library/open-library-router.ts`
- Fix: Per-route Zod schemas + `validateBody(schema)` middleware.

**`trx: any` loses type safety inside transactions**
- Files: `apps/server/src/annotations/annotations-repository.ts` (lines 61, 71, 177, 255, 267), `apps/server/src/upload/upload-service.ts` (line 180), `apps/server/src/upload/upload-router.ts` (line 62)
- Fix: Type as `Knex.Transaction` / `Knex.QueryBuilder`; use `ErrorRequestHandler` for Multer.

**Explicit FIXME: `BooksRepository.getAllWithData` loses typesafety**
- File: `apps/server/src/books/books-repository.ts` (lines 82-92, comment at line 83: `// FIXME: book is any, this looses typesafety`)
- Raw SQL `json_group_array` subqueries get `JSON.parse`d without runtime validation.
- Fix: Typed `RawBookRow` + Zod parse after JSON.parse.

**Lua plugin and TS server schemas are duplicated, not shared**
- CLAUDE.md acknowledges: "there is no schema shared between Lua and TypeScript."
- Files: `plugins/koinsight.koplugin/upload.lua` (lines 68-73, 125-131), `plugins/koinsight.koplugin/const.lua`, `plugins/koinsight.koplugin/call_api.lua`, `apps/server/src/koplugin/koplugin-router.ts` (lines 49-73), `apps/server/src/upload/upload-service.ts`
- Drift is caught only in production. `REQUIRED_PLUGIN_VERSION = '0.3.0'` vs `const.VERSION = "0.3.0"` must be hand-synced.
- Fix: Generate a JSON Schema from a Zod schema and validate outgoing Lua payloads in plugin tests.

**Exact-match plugin version check**
- File: `apps/server/src/koplugin/koplugin-router.ts` (lines 14-27)
- `version !== REQUIRED_PLUGIN_VERSION` rejects all versions but one; every bump breaks every deployed plugin.
- Fix: Semver range check, structured error back to plugin.

**Migrations require a separate build step**
- Files: `apps/server/tsconfig.migrations.json`, `apps/server/package.json` (`test` script), `apps/server/src/knexfile.ts`
- Running `vitest` directly against stale `test/dist/migrations` silently skips new migrations.
- Fix: Configure Knex with a TS loader (`tsx`) and migrate directly from source; drop the second tsconfig.

**Annotation soft-delete detection only runs for synced books**
- File: `apps/server/src/upload/upload-service.ts` (lines 148-161, explicit `// FIXME:` at line 155)
- If a book's only annotation is deleted, the plugin sends no entry for that book, so deletion is never detected.
- Fix: Plugin sends an explicit "books touched this sync" list; server reconciles empty arrays as "all deleted".

**Dead / unclear endpoints**
- `apps/server/src/koplugin/koplugin-router.ts` (line 75: `// TODO: implement check in koreader plugin`) - `/health` exists, no client calls it.
- `apps/server/src/open-library/open-library-router.ts` (lines 23-53: `// TODO: change method?`) - GET that writes a file and deletes the old cover.
- Fix: Wire or remove; change GET to POST/PUT.

**Frontend FIXMEs about broken upload refresh**
- Files: `apps/web/src/components/navbar/upload-form.tsx` (line 29: `// FIXME: this doesn't seem to work.`), `apps/web/src/pages/book-page/components/book-upload-cover.tsx` (line 19)
- Fix: Explicit SWR `mutate()` for affected keys.

**Shared `Date` type should be a timestamp**
- File: `packages/common/types/stats-api.ts` (line 6, explicit FIXME)
- `Date` serializes to string over JSON; the type lies.
- Fix: switch to `number` (unix-ms) and format in the UI.

**Test TODOs/flakiness**
- `apps/server/src/books/books-repository.test.ts` (lines 238-239), `apps/server/src/stats/stats-router.test.ts` (line 37), `apps/server/src/stats/stats-service.test.ts` (line 199: `// FIXME: Flaky - Depends on locale`).

## Known Bugs

**Falsy values reject legitimate kosync progress updates**
- File: `apps/server/src/kosync/kosync-router.ts` (line 95: `if (!document || !progress || !percentage || !device || !device_id)`)
- `percentage === 0` or `progress === "0"` returns 400.
- Fix: explicit undefined/null checks or Zod.

**Flaky locale-dependent stats test**
- File: `apps/server/src/stats/stats-service.test.ts` (line 199).
- Fix: pin TZ/locale in `vitest.config.ts` or refactor assertions.

**Annotations deletion regression area**
- Recent commits `24a49ed fix: annotations marked as deleted (fixes #86)` and `d5592a3 Harden sync (#99)` both patched this path; still carries the open FIXME above.
- Files: `apps/server/src/upload/upload-service.ts`, `apps/server/src/annotations/annotations-repository.ts`

## Security Considerations

**CORS wide-open in production**
- File: `apps/server/src/app.ts` (lines 24-27). The `if (appConfig.env === 'development')` check is commented out.
- Fix: scope `origin` to an `ALLOWED_ORIGINS` env var in production.

**Plugin endpoints have no authentication**
- Files: `apps/server/src/koplugin/koplugin-router.ts` (lines 29, 49, 76, 80). All of `/api/plugin/device`, `/import`, `/health`, `/download` are anonymous.
- Anyone on the network can POST arbitrary books/stats/annotations, or DoS with giant bodies.
- Fix: shared-secret header (`x-koinsight-token`) or reuse kosync user/password.

**All other API routes are unauthenticated**
- Files: `apps/server/src/books/books-router.ts`, `apps/server/src/stats/stats-router.ts`, `apps/server/src/devices/devices-router.ts`, `apps/server/src/upload/upload-router.ts`, `apps/server/src/open-library/open-library-router.ts`, `apps/server/src/ai/open-ai-router.ts`
- Anyone reachable to the server can delete books, hide books, change reference pages, upload SQLite DBs, or burn the OpenAI key via `/api/ai/book-insights`.
- Fix: app-wide auth middleware; mount on everything except the kosync spec endpoints.

**`GET /syncs/progress` lists every user's progress**
- File: `apps/server/src/kosync/kosync-router.ts` (lines 154-157). No `authenticate` middleware, no user scoping.
- Fix: require auth and scope to `req.user.id`, or remove (not part of kosync spec).

**50 MB JSON body limit applied globally**
- File: `apps/server/src/app.ts` (lines 20-21). `express.json({ limit: '50mb' })` plus `urlencoded` the same.
- Combined with no auth / no rate limiting, trivial OOM vector.
- Fix: apply 50mb only on the plugin import path; keep the global default small (~1mb). Add `express-rate-limit`.

**Multer fileFilter can be bypassed**
- File: `apps/server/src/upload/upload-router.ts` (lines 16-26). Accepts any `application/octet-stream` or `*.sqlite3`. Fixed destination filename (`statistics.sqlite3`).
- Fix: validate SQLite magic bytes ("SQLite format 3\0"); random per-request filename; ensure cleanup on open failure.

**`archiver.directory(folderPath)` zips from a `__dirname`-relative path**
- File: `apps/server/src/koplugin/koplugin-router.ts` (lines 80-99). `path.join(__dirname, '../../../../', 'plugins')` resolves differently in dev vs Docker.
- Fix: allowlist to `koinsight.koplugin/`; read an absolute path from `appConfig`; build and cache zip at startup.

**`dotenv.config()` unconditional in production**
- File: `apps/server/src/config.ts` (line 1). Will silently pick up any `.env` mounted into the container.
- Fix: gate behind `NODE_ENV !== 'production'`.

**Error swallowed on login**
- File: `apps/server/src/kosync/kosync-router.ts` (line 57: `} catch (error) {}`). Masks DB failures as 401.
- Fix: log and return 500 for unexpected errors.

**No rate limiting on `/users/auth`**
- Brute-force possible, especially against an extracted SQLite file.
- Fix: `express-rate-limit` on `/users/auth` and other write paths.

## Performance Bottlenecks

**Upload path issues per-row INSERTs under `Promise.all`**
- File: `apps/server/src/upload/upload-service.ts` (lines 70-72, 105-133, 136-145). Thousands of concurrent single-row inserts against a single-writer SQLite.
- Fix: `trx.batchInsert('page_stat', safePageStats, 500)` (or multi-row INSERT ... ON CONFLICT).

**`AnnotationsRepository.bulkInsert` loops serially**
- File: `apps/server/src/annotations/annotations-repository.ts` (lines 71-89). `for (const ann...)` with `await` per row.
- Fix: single `insert(annotations).onConflict([...]).merge([...])`.

**`BooksRepository.getAllWithData` is N+1**
- File: `apps/server/src/books/books-repository.ts` (lines 82-99). Per-book stats, annotations, counts.
- Fix: batch fetches by `book_md5 IN (...)`.

**No concurrency guard around uploads**
- File: `apps/server/src/upload/upload-service.ts`. Two simultaneous plugin syncs race on merge and delete-detection reads.
- Fix: per-book mutex or idempotent upserts.

**`morgan('tiny')` logs every request plus a content-length warn line**
- Files: `apps/server/src/app.ts` (line 22), `apps/server/src/koplugin/koplugin-router.ts` (lines 50-51)
- Fix: production log format; gate the extra warn behind debug.

## Fragile Areas

**`apps/server/src/upload/upload-service.ts` is the critical merge path**
- Three overloaded sync paths (manual SQLite upload, plugin stats sync, plugin annotation-only sync) share `uploadStatisticData`. Merge logic encoded as conditional field lists (lines 111-126); `d5592a3 Harden sync` targeted exactly this logic.
- Test coverage: happy paths covered (`upload-service.test.ts`, `upload-service-annotations.test.ts`, `upload-service-soft-delete.test.ts`); edge cases (mixed sync types in one request, partial book_device updates) are thin.

**Annotation soft-delete identifier is `page_ref + '|' + datetime`**
- Files: `apps/server/src/upload/upload-service.ts` (line 189), `apps/server/src/annotations/annotations-repository.ts` (lines 251-275)
- If KOReader ever reformats `datetime`, every existing annotation will be marked deleted on next sync.
- Fix: tolerate format drift, or tiebreak on a text hash.

**Plugin ZIP `__dirname` relative path**
- File: `apps/server/src/koplugin/koplugin-router.ts` (line 81). Breaks if dist layout or CWD changes.
- Fix: absolute `appConfig.pluginsPath`.

**SPA catch-all `app.get(/.*/, ...)`**
- File: `apps/server/src/app.ts` (line 40). Any API router mounted after `express.static` would be shadowed.
- Fix: assert ordering with a smoke test.

**Fixed Multer destination filename**
- Files: `apps/server/src/upload/upload-router.ts` (lines 7-14), `apps/server/src/config.ts` (line 9). Two parallel uploads race on `statistics.sqlite3`.
- Fix: random filename.

**`page_ref: String(ka.page)`**
- File: `apps/server/src/annotations/annotations-repository.ts` (line 225). `page` may be a number or XPath string.
- Fix: normalize at one boundary; type explicitly.

## Scaling Limits

**SQLite single-writer**
- Files: `apps/server/src/knex.ts`, `apps/server/src/knexfile.ts`
- Concurrent syncs from multiple devices serialize on the write lock; large imports block all writes.
- Fix: enable WAL; queue per-device sync; Postgres path via Knex.

**No pagination on `/api/books`**
- File: `apps/server/src/books/books-router.ts` (lines 14-18). Returns all books with aggregates.
- Fix: paginate; lazy-load annotation counts.

**Plugin ZIP rebuilt per request**
- File: `apps/server/src/koplugin/koplugin-router.ts` (lines 80-99)
- Fix: cache zip on first request.

## Dependencies at Risk

**Both `better-sqlite3` (12.6.0) and `sqlite3` (5.1.7) installed**
- File: `apps/server/package.json`. Two SQLite native bindings; double Node-ABI surface in Docker builds.
- Migration: Knex supports `client: 'better-sqlite3'`; drop `sqlite3`.

**Express 5.2.1**
- File: `apps/server/package.json`. Express 5 changed error-propagation and routing; ecosystem occasionally lags.
- Migration: keep a smoke test covering every mounted router.

**Ramda 0.31 + TypeScript**
- Weak types on curried forms silently degrade inference.
- Migration: prefer native array methods or `remeda` for new code.

## Missing Critical Features

- No rate limiting anywhere (no `express-rate-limit` in `package.json`).
- No structured logger (just `morgan tiny` and `console.*`; 37 `console.*` calls across `apps/server/src` excluding tests).
- No generic `/healthz` for orchestrators (the plugin-scoped `/api/plugin/health` requires plugin version header).
- No backup/export endpoint.
- No CSRF protection groundwork for when auth is added.

## Test Coverage Gaps

**Route-level validation tests (High)**
- Sad-path validation untested on most routers.
- Files: `apps/server/src/kosync/kosync-router.ts`, `apps/server/src/devices/devices-router.ts`, `apps/server/src/upload/upload-router.ts`, `apps/server/src/open-library/open-library-router.ts`, `apps/server/src/ai/open-ai-router.ts`

**Concurrency tests (High)**
- No tests for simultaneous plugin syncs, races on annotation deletion, or simultaneous uploads.
- Files: `apps/server/src/upload/upload-service.ts`, `apps/server/src/annotations/annotations-repository.ts`

**Frontend has zero tests (Medium)**
- No `.test.` files under `apps/web/src/`. The two upload-form FIXMEs hint at regressions already present.

**Lua plugin has no tests (Medium)**
- Files: `plugins/koinsight.koplugin/*.lua`
- Fix: a smoke script that round-trips a fake payload through the server.

**OpenAI integration untested (Low)**
- `apps/server/src/ai/open-ai-service.ts` silently swallows JSON parse failures; model hard-coded to `gpt-4o`.

**Covers router untested (Medium)**
- `apps/server/src/books/covers/covers-router.ts` does filesystem writes inside request handlers.
