# Conventions

**Analysis Date:** 2026-04-23

## Tooling
- **Formatting:** Prettier 3.6.2 only, config at `.prettierrc`. No ESLint, no Biome, no root-level format script. Run `npx prettier --write .` at the repo root.
- **TypeScript:** 5.9.3 everywhere. Server uses CommonJS (`apps/server/tsconfig.json`: `"module": "commonjs"`, `strict: true`, `noImplicitAny: true`, `isolatedModules: true`). Web is ESM (`"type": "module"` in `apps/web/package.json`).
- **Lua:** StyLua (`stylua.toml`, 2-space, 100 cols) for `plugins/koinsight.koplugin/`.

## Prettier settings (`.prettierrc`)
`printWidth: 100`, `tabWidth: 2`, `useTabs: false`, `semi: true`, `singleQuote: true`, `jsxSingleQuote: false`, `trailingComma: "es5"`, `bracketSpacing: true`, `arrowParens: "always"`, `endOfLine: "lf"`.

## Naming
- **Files:** kebab-case. Examples: `apps/server/src/books/books-router.ts`, `apps/server/src/books/books-repository.ts`, `apps/server/src/books/books-service.ts`, `apps/server/src/books/get-book-by-id-middleware.ts`, `apps/server/src/kosync/kosync-authenticate-middleware.ts`.
- **Tests:** sibling `<name>.test.ts` (e.g., `apps/server/src/books/books-router.test.ts`).
- **Factories:** `apps/server/src/db/factories/*-factory.ts` with a `fakeX` / `createX` pair (see `apps/server/src/db/factories/book-factory.ts`, `apps/server/src/db/factories/page-stat-factory.ts`).
- **Classes:** PascalCase static namespaces: `BooksRepository`, `BooksService`, `StatsService`, `UploadService`, `AnnotationsRepository`, `UserRepository`, `KosyncRepository`, `DeviceRepository`, `GenreRepository`.
- **Custom errors:** `UserExistsError` in `apps/server/src/kosync/user-repository.ts`, checked via `instanceof`.
- **Hooks (web):** `useBooks`, `useBookWithData`, `usePageStats` (`apps/web/src/api/books.ts`, `apps/web/src/api/use-book-with-data.ts`).
- **Router export alias:** `export { router as booksRouter }` (repeated in `books-router.ts`, `koplugin-router.ts`, `kosync-router.ts`). Maintain this pattern.
- **DB columns:** snake_case (`book_md5`, `start_time`, `total_read_time`, `reference_pages`, `soft_deleted`). Shared types in `packages/common/types` mirror columns; API responses expose snake_case, do NOT rename between layers.
- **Constants:** SCREAMING_SNAKE_CASE: `REQUIRED_PLUGIN_VERSION` in `apps/server/src/koplugin/koplugin-router.ts`; `API_URL`, `SERVER_URL` in `apps/web/src/api/api.ts`.

## Server module layout
Each feature under `apps/server/src/<feature>/` has up to four sibling files:
1. `<feature>-router.ts` - Express router + validation + HTTP.
2. `<feature>-service.ts` - business logic (static methods, pure where possible).
3. `<feature>-repository.ts` - Knex queries (only layer importing `../knex`).
4. `<feature>-*-middleware.ts` - per-feature middleware.

Examples: `apps/server/src/books/`, `apps/server/src/stats/`, `apps/server/src/annotations/`, `apps/server/src/kosync/`.

## Import grouping (observed in `apps/server/src/books/books-repository.ts`)
1. Third-party (`express`, `ramda`, `zod`, `date-fns`, `knex`).
2. `@koinsight/common/types` (workspace package, only path alias in use).
3. Relative imports (`../annotations/...`, then `./books-service`).

Do not duplicate types between apps. Place shared types in `packages/common/types`.

## Validation
- **Library:** Zod 4.3.5 (server `dependencies`). Prefer Zod schemas at route boundaries and for parsing external API responses.
- **Current use:** `apps/server/src/ai/open-ai-service.ts` defines `const BookInsights = z.object({ genres: z.array(z.string()), summary: z.string() })` and calls `BookInsights.parse(data)`.
- **Legacy:** many routers still use ad-hoc `if (!field)` checks (`apps/server/src/books/books-router.ts`, `apps/server/src/koplugin/koplugin-router.ts`, `apps/server/src/kosync/kosync-router.ts`). Migrate to Zod when touching them; do not add new hand-rolled validation.

## Functional style
- **Ramda 0.31.1** in both apps. Examples: `sum(bookDevices.map(...))` in `apps/server/src/books/books-repository.ts`, `range(0, 10).map(...)` in `apps/server/src/stats/stats-service.test.ts`.
- **date-fns 4.1.0** for date math (`startOfDay`, `subDays`). Do not introduce Moment or Luxon.
- Mix of Ramda and native array methods is acceptable. `BooksService.getReadPerDay` and `BooksService.withData` use native `reduce` (`apps/server/src/books/books-service.ts`).

## Error handling
Route pattern (from `apps/server/src/books/books-router.ts`):

```ts
try {
  await BooksRepository.delete(book);
  res.status(200).json({ message: 'Book deleted' });
} catch (error) {
  console.error(error);
  res.status(500).json({ error: 'Failed to delete book' });
}
```

- Validation failure: `400` with `{ error: 'Missing required fields' }` or specific message.
- Custom domain errors: subclass `Error`, check with `instanceof` (see `UserExistsError` in `apps/server/src/kosync/user-repository.ts`, handled in `apps/server/src/kosync/kosync-router.ts` returning `402`).
- Response shapes: success returns resource or `{ message: '...' }`; errors always `{ error: '...' }`.

## Logging
- `morgan('tiny')` for request logs (`apps/server/src/app.ts`).
- Ad-hoc `console.*`: `console.log` (lifecycle), `console.info` (startup banner), `console.debug` (payload traces in `apps/server/src/koplugin/koplugin-router.ts`), `console.warn` (large Content-Length), `console.error` (caught exceptions).
- No Pino/Winston configured. Match this style.

## Function / service design
- Services: `static` methods on a namespace class, take domain types from `@koinsight/common/types`, return typed Promises. Keep pure where possible, delegate I/O to repositories. `BooksService.withData` is the only I/O method in `apps/server/src/books/books-service.ts`.
- Repositories: `static` methods returning Knex queries or awaited results; only layer touching `../knex`.
- Explicit return types on all repository/service methods.

## Comments
- JSDoc route summaries: `apps/server/src/books/books-router.ts`.
- Third-party API contracts transcribed verbatim in `apps/server/src/kosync/kosync-router.ts` doc comments.
- Searchable debt tags: `// FIXME:` (e.g., `apps/server/src/books/books-repository.ts:83`), `// TODO:`, `// HACK:`.

## Web conventions
- React 18 + Mantine 8 + Vite 7 + SWR 2.
- All server calls via `fetchFromAPI<T>` in `apps/web/src/api/api.ts`.
- One file per resource under `apps/web/src/api/` (`books.ts`, `devices.ts`, `kosync.ts`, `open-library.ts`, `upload-db-file.ts`, plus `use-book-with-data.ts`, `use-page-stats.ts`).
- `react-router` 7; route table in `apps/web/src/routes.ts`; pages in `apps/web/src/pages/<page-name>/`.
- CSS Modules (`*.module.css`) colocated next to the component (e.g., `apps/web/src/pages/books-page/books-cards.module.css` + `books-cards.tsx`). No Tailwind. `clsx` for conditional classes.
- `nuqs` for URL-backed query state.
- `@tabler/icons-react` only for icons.

## Modules
- Prefer named exports. No barrel (`index.ts`) files in server; same for web.
- Shared types go in `packages/common/types`, imported as `@koinsight/common/types` or `@koinsight/common/types/<file>`.

## Plugin coupling
When adding/changing a route the KOReader plugin calls, update `plugins/koinsight.koplugin/call_api.lua` and `plugins/koinsight.koplugin/const.lua` in the same change, and bump `REQUIRED_PLUGIN_VERSION` in `apps/server/src/koplugin/koplugin-router.ts` if the wire format changes. The version gate in `rejectOldPluginVersion` is the only enforcement.
