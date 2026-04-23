# Testing

**Analysis Date:** 2026-04-23

## Framework
- **Runner:** Vitest 4.0.16 (`apps/server/package.json` `devDependencies`). Config: `apps/server/vitest.config.ts`.
- **Coverage:** `@vitest/coverage-v8` 4.0.16, provider `v8`, reporters `text`, `html`, `lcov`, output `./test/coverage`, `include: ['src/**/*.ts']`, `exclude: ['src/db/migrations', 'src/db/seeds']`.
- **Globals:** `globals: true` in the Vitest config, so `describe`, `it`, `expect`, `beforeAll`, `beforeEach`, `afterAll` are available without importing. Some newer tests explicitly import from `vitest` (e.g., `apps/server/src/annotations/annotations-repository-soft-delete.test.ts:1`); either style is accepted.
- **HTTP assertion:** `supertest` 7.1.4 + `@types/supertest` 6.0.3.
- **Fake data:** `@faker-js/faker` 10.2.0.
- **Environment:** `environment: 'node'`.
- **Test glob:** `include: ['**/*.test.ts']` (tests are colocated beside source files).
- **No web tests:** `apps/web/` has zero `*.test.*` / `*.spec.*` files and no Vitest/Jest config. Tests are server-only today.

## Commands (run from repo root unless noted)

```bash
npm --workspace=server test                       # build migrations, then vitest run
npm --workspace=server run test:watch             # build migrations, then vitest (watch)
npm --workspace=server run test:coverage          # build migrations, then vitest run --coverage
npm run test:coverage                             # Turbo, runs across all workspaces
npm --workspace=server exec vitest run path/to/file.test.ts   # single file
npm --workspace=server exec vitest run -t "part of name"       # single test by name
```

All three scripts in `apps/server/package.json` chain `npm run build:migrations && vitest ...`. When running Vitest directly (e.g., `vitest run <file>`), rerun `npm --workspace=server run build:migrations` first if migrations changed; stale compiled migrations under `apps/server/test/dist/migrations/` cause Knex to silently miss them.

## Migration build step
- **Why:** the Vitest setup in `apps/server/test/setup/test-setup.ts` calls `db.migrate.latest()`. Knex needs compiled JS migrations at runtime (not the TS sources) because the Vitest ts-loader does not emit them where Knex looks.
- **How:** `npm --workspace=server run build:migrations` runs `tsc -p tsconfig.migrations.json`, which compiles only `src/db/migrations/**/*.ts` (`apps/server/tsconfig.migrations.json`) into `apps/server/test/dist/migrations/`.
- **When:** any time a migration file is added or edited. Skipping this step is the most common cause of "table does not exist" test errors.

## Test setup (`apps/server/test/setup/test-setup.ts`)
- `beforeAll` runs `db.migrate.latest()` once per test run.
- `beforeEach` toggles `PRAGMA foreign_keys = OFF`, truncates every table (`annotation`, `book`, `book_device`, `book_genre`, `device`, `genre`, `page_stat`, `user`), then re-enables foreign keys. When adding a new table that tests depend on, add it to this truncate list.
- `afterAll` calls `db.destroy()`.
- A single shared Knex instance is used: `apps/server/src/knex.ts` exports `db`, the same one used by runtime, migrations, seeds, factories, and tests.

## Database used in tests
The tests hit the same SQLite file configured by `appConfig.env` (`apps/server/src/config.ts`) via `apps/server/src/knexfile.ts`. `DATA_PATH` governs the location. `better-sqlite3` is the driver. The test run operates on a real SQLite DB, not an in-memory fake, and relies on `beforeEach` truncation for isolation.

## Test file organization
- Colocated: `apps/server/src/books/books-router.ts` → `apps/server/src/books/books-router.test.ts`; same for `-service` and `-repository`.
- Multiple focused test files per subject are fine: `books-service.test.ts` and `books-service-annotations.test.ts`; `upload-service-soft-delete.test.ts` and `upload-service-annotations.test.ts`.
- Utility tests live next to the util: `apps/server/src/utils/ranges.test.ts`, `apps/server/src/utils/strings.test.ts`.

Known test files:
- `apps/server/src/books/books-repository.test.ts`
- `apps/server/src/books/books-router.test.ts`
- `apps/server/src/books/books-service.test.ts`
- `apps/server/src/books/books-service-annotations.test.ts`
- `apps/server/src/annotations/annotations-repository.test.ts`
- `apps/server/src/annotations/annotations-repository-soft-delete.test.ts`
- `apps/server/src/stats/stats-repository.test.ts`
- `apps/server/src/stats/stats-router.test.ts`
- `apps/server/src/stats/stats-service.test.ts`
- `apps/server/src/devices/device-repository.test.ts`
- `apps/server/src/devices/devices-router.test.ts`
- `apps/server/src/genres/genre-repository.test.ts`
- `apps/server/src/koplugin/koplugin-router.test.ts`
- `apps/server/src/upload/upload-service-annotations.test.ts`
- `apps/server/src/upload/upload-service-soft-delete.test.ts`
- `apps/server/src/utils/ranges.test.ts`
- `apps/server/src/utils/strings.test.ts`

## Test suite structure
**Router tests** (`apps/server/src/books/books-router.test.ts`, `apps/server/src/koplugin/koplugin-router.test.ts`):
- Construct an Express app per suite and mount only the router under test.
- Drive with `supertest`.

```ts
const app = express();
app.use(express.json());
app.use('/books', booksRouter);

const response = await request(app).get('/books');
expect(response.status).toBe(200);
expect(response.body).toEqual(expect.objectContaining({ title: 'Book 1' }));
```

**Repository tests** (`apps/server/src/books/books-repository.test.ts`) and **service tests** (`apps/server/src/stats/stats-service.test.ts`): seed via factories, call the static method, assert on the DB or return value. `describe` blocks are often passed a symbol (the class or method itself) to keep labels in sync with identifiers:

```ts
describe(BooksRepository, () => {
  describe('getAll', () => { /* ... */ });
});

describe(StatsService, () => {
  describe(StatsService.getPerMonthReadingTime, () => { /* ... */ });
});
```

**Utility tests** (`apps/server/src/utils/strings.test.ts`, `apps/server/src/utils/ranges.test.ts`): minimal, pure input/output assertions:

```ts
describe(generateMd5Hash, () => {
  it('generates the same hash for the same string', () => {
    expect(generateMd5Hash('test')).toEqual(generateMd5Hash('test'));
  });
});
```

## Factories (fixtures)
Factories live under `apps/server/src/db/factories/` and export a `fakeX` / `createX` pair:
- `fakeX(overrides)` returns a plain object built with `@faker-js/faker` plus overrides.
- `createX(db, ...context, overrides)` inserts via Knex and returns the persisted row (`returning('*')`).

Available factories: `annotation-factory.ts`, `book-device-factory.ts`, `book-factory.ts`, `device-factory.ts`, `genre-factory.ts`, `koreader-annotation-factory.ts`, `page-stat-factory.ts`, `progress-factory.ts`, `user-factory.ts`.

Example (`apps/server/src/db/factories/book-factory.ts`):

```ts
export function fakeBook(overrides: Partial<FakeBook> = {}): FakeBook {
  return {
    title: faker.book.title(),
    md5: faker.string.alphanumeric(32),
    reference_pages: faker.number.int({ min: 50, max: 1000 }),
    authors: faker.book.author(),
    series: faker.book.series(),
    language: faker.location.language().alpha2,
    soft_deleted: false,
    ...overrides,
  };
}

export async function createBook(db: Knex, overrides: Partial<FakeBook> = {}): Promise<Book> {
  const bookData = fakeBook(overrides);
  const [book] = await db<Book>('book').insert(bookData).returning('*');
  return book;
}
```

Related factories compose the dependency chain: `createPageStat` takes a `Book`, `BookDevice`, and `Device` (`apps/server/src/db/factories/page-stat-factory.ts`), mirroring foreign-key relationships. Follow this pattern when adding new tables.

## Mocking
- `grep` across `apps/server/src` returns zero `vi.mock` / `vi.fn` / `vi.spyOn` usages. The codebase does **not** mock Knex or domain services. Tests rely on the real SQLite DB truncated per test.
- Prefer integration-style tests over mocks. Only reach for `vi.mock` when hitting a genuinely external dependency (e.g., OpenAI in `apps/server/src/ai/open-ai-service.ts`).

## Async patterns
All tests are `async`. `Promise.all` combined with `ramda.range` is the standard way to seed batches (example in `apps/server/src/stats/stats-service.test.ts`):

```ts
const stats = await Promise.all(
  range(0, 6).map(async (i) =>
    createPageStat(db, book, bookDevice, device, { start_time: month1, duration: 10, page: i })
  )
);
```

## Coverage
- Run `npm --workspace=server run test:coverage`. HTML report at `apps/server/test/coverage/index.html`; `lcov.info` at `apps/server/test/coverage/lcov.info`.
- Excluded from coverage: `src/db/migrations`, `src/db/seeds` (see `apps/server/vitest.config.ts`).
- No enforced threshold in Vitest config.

## Flaky / skipped tests
- `apps/server/src/stats/stats-service.test.ts:200` has an `it.skip(...)` for `StatsService.perDayOfTheWeek` with a comment `FIXME: Flaky, Depends on locale`. When working on that service, fix the locale dependency rather than re-enabling blindly.

## Web
No web tests exist. If introducing them, add Vitest + `@testing-library/react` to `apps/web`, wire a `vitest.config.ts` there, and add `test` scripts to `apps/web/package.json` and `turbo.json`.
