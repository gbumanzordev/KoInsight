# Stack Research — Book Metadata Enrichment + Yearly Reports Milestone

**Domain:** Metadata enrichment against a public REST API (OpenLibrary) + SQLite schema evolution + chart reporting, inside an existing CJS Express 5 / Knex / React 18 / Mantine 8 codebase.
**Researched:** 2026-04-23
**Overall confidence:** HIGH

> Scope: this milestone ONLY. The base stack (Express 5, Knex 3, better-sqlite3, React 18, Mantine 8, SWR, Recharts, Zod, Ramda, Vitest) is locked per `.planning/codebase/STACK.md` and is not re-evaluated here. Everything below is an additive delta or an opinion on how to use what is already installed.

---

## Critical environmental constraints (read first)

Two facts drive every recommendation below. Missing either will produce a broken PR.

1. **Server is CommonJS.** `apps/server/tsconfig.json` sets `"module": "commonjs"`, `"target": "ES2020"`. The server runs as `node dist/app.js` without `--experimental-vm-modules` or any ESM loader. **ESM-only packages cannot be `require()`d.** This rules out modern `p-queue` (>=7), `p-limit` (>=4), `node-fetch` (>=3), `got` (>=12), `ky`. Use only CJS-compatible libraries or older pinned versions. Confidence: HIGH (verified in `apps/server/tsconfig.json` and `apps/server/package.json`).
2. **No form library is installed on the web.** `apps/web/package.json` has no `react-hook-form`, no `@mantine/form`, no `formik`. Existing forms (e.g., the KoSync login flow) rely on controlled `useState` + Mantine inputs. Adding a form library is a deliberate new dependency; do it intentionally or not at all.

---

## Recommended Stack (deltas for this milestone)

### Server additions

| Package | Version | Purpose | Why / Rationale | Confidence |
|---|---|---|---|---|
| `bottleneck` | `^2.19.5` | Rate-limit OpenLibrary HTTP calls to <=3 req/s global, with reservoir refill and retry-aware scheduling | CJS-compatible (`main: lib/index.js`), battle-tested, purpose-built for HTTP rate limits. The ESM-only alternatives (`p-queue` 9.x, `p-limit` 7.x) will not `require()` from our CJS build. Supports `minTime`, `maxConcurrent`, priority, and built-in retry via `Bottleneck.BottleneckError` | HIGH |
| `p-queue@6.6.2` *(alternative, only if bottleneck rejected)* | `6.6.2` | General-purpose async queue with concurrency | Last CJS-compatible version (6.x). Use only if the team prefers its `add()`/`onIdle()` API. Do not install 7.x+, they are ESM-only. | HIGH |
| `zod` *(already installed 4.3.5)* | existing | Parse OpenLibrary JSON responses at the boundary | The project convention (`CONVENTIONS.md`) mandates Zod at external API boundaries. OpenLibrary responses have many optional fields and our `open-library-service.ts` currently parses them as `any`. Fix that when extending it. | HIGH |

Deliberately **NOT added on the server**:

- **BullMQ / BeeQueue / Agenda** — require Redis. The app is single-process SQLite; a new infra service violates the milestone constraint.
- **node-cron / cron** — overkill. Backfill is a one-shot job triggered on boot. A simple `setImmediate` + Bottleneck scheduler inside `app.ts` covers it.
- **axios / got / ky / node-fetch** — Node 22 has native `fetch`. `open-library-service.ts` already uses it. Adding an HTTP client is extra surface area for zero benefit.
- **ioredis / redis** — same reason as BullMQ.
- **worker_threads / piscina** — no CPU-bound work. Enrichment is I/O-bound HTTP.
- **typeorm / prisma / drizzle** — we use Knex; do not introduce a second ORM.
- **`@openlibrary/api-client` or similar** — **no official OpenLibrary TypeScript client exists.** I searched npm; the closest packages (`openlibrary`, `open-library-search`) are abandoned (last publish 2017-2020) and not worth depending on. Hand-roll `fetch` calls behind a typed service. Confidence: HIGH.

### Web additions

| Package | Version | Purpose | Why / Rationale | Confidence |
|---|---|---|---|---|
| `@mantine/form` | `8.3.12` (matches other `@mantine/*`) | Form state for the manual metadata edit UI (title, authors, genres, publication year, nationality) | First-party Mantine hook (`useForm`) with built-in Zod integration via `mantine-form-zod-resolver`. Zero additional design decisions: it ships with the same Mantine version we already pin. Alternative was react-hook-form, but introducing it means wiring a separate `<Controller>` layer around every Mantine input; `@mantine/form` speaks Mantine natively. | HIGH |
| `mantine-form-zod-resolver` | `^1.3.0` | Bridges `@mantine/form` validation to existing Zod schemas reused from the server | Lets the same Zod schema validate in the web form and on the Express route boundary, avoiding double-authored validation logic. | HIGH |

Deliberately **NOT added on the web**:

- **react-hook-form** — not currently used; adding it creates a third paradigm (useState forms + Mantine form + RHF). The manual edit UI is one to three forms total; `@mantine/form` is the lowest-coupling fit.
- **Formik** — stagnant, larger bundle, no first-party Mantine integration.
- **Chart.js / Victory / nivo / ECharts** — Recharts 2.15.0 and `@mantine/charts` 8.3.12 are both already installed. Use them.
- **lodash / lodash-es** — Ramda is the project convention for FP utilities.

---

## Question-by-question answers

### (a) OpenLibrary API consumption

**Endpoints to use per enrichment field** (verified against `https://openlibrary.org/developers/api` and live JSON responses at `openlibrary.org/works/*.json` and `/authors/*.json`):

| Field we need | Endpoint | Notes |
|---|---|---|
| Resolve a book from title+author | `GET /search.json?title=...&author=...&limit=1&fields=key,cover_i,author_key,author_name,first_publish_year,language,subject,edition_key` | Prefer `fields=` to avoid paying for wildcard. Search returns work-level results with `key` like `/works/OL12345W`. |
| Work detail (subjects, description, authors) | `GET /works/{OLID}.json` | Returns `subjects`, `subject_places`, `subject_people`, `subject_times`, `authors[].author.key`, `description`. **Does NOT reliably return `first_publish_date` or `language`** for every work — those are edition-level. Confidence: HIGH (verified against live JSON). |
| Edition detail (publication year, language) | `GET /works/{OLID}/editions.json?limit=1` or `GET /books/{EDITION_OLID}.json` | Use when you need `publish_date` / `languages[].key = /languages/eng`. Prefer the `first_publish_year` from `search.json` when available; it collapses edition variance. |
| Author detail (bio) | `GET /authors/{OLID}.json` | Returns `name`, `personal_name`, `birth_date`, `death_date`, `bio` (string or `{ type, value }`). **There is NO `nationality` or `birth_place` field.** Nationality must be extracted from the `bio` prose (e.g., "is a British novelist ..."). This is a pragmatic limitation of OpenLibrary, not our pipeline. See PITFALLS. Confidence: HIGH (verified on OL23919A / J.K. Rowling). |
| Subjects index | `GET /subjects/{subject}.json` | Not needed for per-book enrichment — only useful if we want to enumerate books for a subject. Skip for this milestone. |
| Covers | `GET https://covers.openlibrary.org/b/id/{cover_i}-{S|M|L}.jpg` | Already implemented in `open-library-service.ts`; no change. |

**No official TypeScript client exists.** Hand-roll `fetch` with Zod parsers. Extend the existing `apps/server/src/open-library/open-library-service.ts` with `getWork(olid)`, `getEdition(olid)`, `getAuthor(olid)`, `searchBook({title, author})`. Keep the module pure (no DB writes); let a separate `enrichment-service.ts` compose it with the `book-author` persistence layer.

**Headers / User-Agent (REQUIRED):**

```
User-Agent: KoInsight/<version> (+https://github.com/gerazov/KoInsight; contact@<maintainer>)
```

The OpenLibrary developer docs explicitly state that identified requests (with a descriptive User-Agent containing contact info) get **3 req/s** vs. **1 req/s** unidentified. We MUST set this header on every request; the current `open-library-service.ts` does not, and the milestone backfill will hit 429s without it. Source: `https://openlibrary.org/developers/api` (fetched 2026-04-23). Confidence: HIGH.

**Rate limits (verified 2026-04-23 from openlibrary.org/developers/api):**

- Unidentified: **1 req/s**
- Identified (User-Agent with contact info): **3 req/s**
- No published per-day cap, but docs "explicitly discourage bulk harvesting"; they steer heavy users to the monthly data dumps.
- The search endpoint is more expensive than direct ID lookups; they warn against wildcard `fields=*`.

**Batch pattern:** there isn't one for arbitrary books. `search.json` can page with `offset`/`limit`, but you can't POST a list of ISBNs and get a batch response. For hundreds-of-books backfill, OpenLibrary recommends downloading a monthly data dump and joining locally. For our scale (hundreds to low thousands of books per self-hosted instance), sequential rate-limited `search.json` calls are the right pattern. Confidence: HIGH.

**Implementation sketch (CJS, no new HTTP client):**

```ts
// apps/server/src/open-library/open-library-client.ts
import Bottleneck from 'bottleneck';
import { z } from 'zod';

const UA = `KoInsight/${process.env.npm_package_version ?? 'dev'} (+https://github.com/gerazov/KoInsight)`;

// 3 req/s identified; leave headroom -> minTime 400ms.
const limiter = new Bottleneck({ minTime: 400, maxConcurrent: 2 });

export const olFetch = limiter.wrap(async <T>(path: string, schema: z.ZodType<T>): Promise<T> => {
  const res = await fetch(`https://openlibrary.org${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (res.status === 429) throw new Error('OpenLibrary rate limited');
  if (!res.ok) throw new Error(`OpenLibrary ${res.status}`);
  return schema.parse(await res.json());
});
```

### (b) Background job / queue for one-time backfill

**Recommendation: Bottleneck + a tiny `backfill-service.ts` module, kicked off with `setImmediate` from `app.ts` after the HTTP listener is bound.**

Pattern (follows the existing static-class service convention):

```ts
// apps/server/src/enrichment/backfill-service.ts
export class BackfillService {
  static async run(): Promise<void> {
    const books = await BooksRepository.findUnenriched(); // new query
    for (const book of books) {
      try {
        await EnrichmentService.enrichBook(book); // uses olFetch() -> bottleneck
      } catch (err) {
        console.error('[backfill] failed for', book.md5, err);
      }
    }
    console.info('[backfill] done', books.length);
  }
}

// apps/server/src/app.ts  (after app.listen)
setImmediate(() => {
  BackfillService.run().catch((e) => console.error('[backfill] fatal', e));
});
```

Why this pattern, not alternatives:

| Option | Verdict | Reason |
|---|---|---|
| **Bottleneck in-process queue** | **Chosen** | CJS-compatible; rate-limit logic and concurrency live in one object; natural fit for a sequential for-loop over DB rows. |
| Cron (`node-cron`) | Rejected | Backfill is idempotent-on-success and one-shot. Cron is for repeating jobs; our "job" is "enrich any `needs_enrichment=true` row, on boot." |
| `worker_threads` / `piscina` | Rejected | Not CPU-bound. Threads add pickling and complexity. |
| `setInterval` polling loop | Rejected | Bottleneck's reservoir gives precise pacing without our own timer math. |
| BullMQ / Agenda / pg-boss | Rejected (milestone constraint) | Require Redis or Postgres. |
| Sidecar process | Rejected | Violates "single Express process serves API + SPA" architecture (see `codebase/ARCHITECTURE.md`). |

**Retry + resume semantics:** store a `book.enrichment_status` column (`pending | ok | not_found | error`) and a `book.enrichment_attempted_at` timestamp. Backfill query = `WHERE enrichment_status IN ('pending','error') AND (enrichment_attempted_at IS NULL OR enrichment_attempted_at < now() - 24h)`. Survives server restarts; users' bad OpenLibrary matches can be re-kicked by setting the row back to `pending`. Confidence: HIGH.

**Ongoing enrichment (new books from KOReader sync):** the `UploadService.uploadStatisticData` transaction marks newly-inserted books as `enrichment_status='pending'`. The same `BackfillService.run()` will pick them up on the next server restart, OR we can `setImmediate(() => EnrichmentService.enrichBook(book))` after the transaction commits (non-blocking). Prefer the latter for responsiveness; the bootstrap backfill becomes the safety net.

### (c) Data migration: denormalized `book.authors` string -> `author` + `book_author`

**Idiomatic Knex pattern:**

1. `migrate:make add_author_entity_tables` — create `author (id, name, openlibrary_key, bio, nationality, birth_year, death_year, created_at, updated_at)` with a **case-insensitive unique index** on `name` (SQLite: `CREATE UNIQUE INDEX ... (name COLLATE NOCASE)`), and `book_author (book_md5, author_id, position)` with a composite PK. Keep `book.authors` (the string column) unchanged for now.

2. `migrate:make backfill_author_entities` — **data-only migration**. Inside `up()`, open a transaction, select distinct non-null `authors` strings, split on `,`/`;`/`&`/` and ` with whitespace-trimming and case-normalization, upsert each name into `author`, then insert `book_author` rows linking each book to its parsed authors in declared order. **Do NOT drop `book.authors` in the same migration.** Keep it as the fallback source of truth until the next release cuts over reads to the join.

3. `migrate:make drop_book_authors_column` (separate, *next milestone* or post-verification) — only after enrichment has had a pass and you trust the join table.

**Reversibility:** each `down()` is explicit. For step 2, `down` truncates `book_author` and the rows in `author` that have no `openlibrary_key` set (i.e., only the ones this migration created, not any populated by the enrichment backfill that ran between steps 2 and 3). This is subtle; document it in a comment. Confidence: HIGH.

**Ambiguous cases:**

- **Two authors, same name, different people** (e.g., the two "David Peace"s): the migration CANNOT disambiguate on name alone. Pick one row (the canonical name-match) and accept over-collapse at migration time. Then let the enrichment backfill differentiate them later by assigning distinct `openlibrary_key` values, **and** add a follow-up correction path: when an OL lookup resolves `book_A` to author `OL111A` but the pre-existing `author` row already has `openlibrary_key=OL222A` attached to `book_B`, the enrichment service creates a new `author` row for the new key and updates `book_author` for that book. The uniqueness constraint must therefore be on `(openlibrary_key)` (when non-null) rather than `(name)` long-term; keep `name` unique only for the unenriched-seed rows. Confidence: MEDIUM (design judgement).
- **Name split heuristics**: OpenLibrary writes authors as free text like `"J. R. R. Tolkien, Christopher Tolkien"` and sometimes `"Tolkien, J. R. R."` (Last-first). For KOReader data specifically, authors come from EPUB metadata which uses `&` or `,` as separators — it's rarely a "Lastname, Firstname" case. Split on `[,;&]` and on `\s+(and|with)\s+`. Log every split result at debug level during the migration so we can audit.

**Pattern reference for the data migration body** (Knex + better-sqlite3):

```ts
export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    const books = await trx('book').select('md5', 'authors').whereNotNull('authors');
    const nameCache = new Map<string, number>(); // normalized name -> author.id
    for (const { md5, authors } of books) {
      const names = splitAuthors(authors);
      for (let i = 0; i < names.length; i++) {
        const key = names[i].toLowerCase();
        let authorId = nameCache.get(key);
        if (!authorId) {
          const [row] = await trx('author').insert({ name: names[i] }).onConflict('name').merge().returning('id');
          authorId = row.id;
          nameCache.set(key, authorId);
        }
        await trx('book_author').insert({ book_md5: md5, author_id: authorId, position: i }).onConflict().ignore();
      }
    }
  });
}
```

Note: `onConflict().merge()` on SQLite works in Knex 3.x, but the test DB is `:memory:` — run the migration against a realistic seed in CI (the repo has factories for this).

### (d) Genre mapping / normalization

**Recommendation: hand-curate. No off-the-shelf canonical genre package is worth depending on.**

Surveyed:

- **BISAC** — the industry-standard commercial taxonomy. Licensed by BISG. Using it requires a license fee and publishes like "FIC009000". Explicitly out-of-scope per `PROJECT.md`. Confidence: HIGH (BISG licensing page).
- **BookBrainz genres** — open data under CC0, but the taxonomy is sparse and duplicates OpenLibrary's subject tags in many cases. Not ergonomic for our "~50-100 canonical genres" target. Confidence: MEDIUM.
- **ISBNdb / Goodreads genre hierarchies** — Goodreads is unlicensed scrape. ISBNdb requires a paid API key. Both out-of-scope.
- **npm packages** — no credible maintained TS package exists for "canonical literary genres." The only hits (`book-genres`, `literary-genres`) are single-author toys with <200 weekly downloads and no updates since 2021.

**Pattern in code:** a TS module `apps/server/src/genres/canonical-genres.ts` that exports both the whitelist (as a const array of `{ id, name, aliases }`) and a `mapOpenLibrarySubjects(subjects: string[]): CanonicalGenreId[]` function. Keep the mapping as pure in-memory data; persist via existing `genre` + `book_genre` tables (already scaffolded).

Suggested shape:

```ts
export const CANONICAL_GENRES = [
  { id: 'fantasy', name: 'Fantasy', aliases: ['fantasy fiction', 'high fantasy', 'sword and sorcery', 'epic fantasy'] },
  { id: 'sci-fi',  name: 'Science Fiction', aliases: ['science fiction', 'sf', 'dystopian fiction', 'space opera'] },
  // ...
] as const satisfies readonly { id: string; name: string; aliases: readonly string[] }[];

// case-insensitive, substring-aware subject -> canonical id
// OpenLibrary subjects are title-cased and often redundant ("Fantasy", "Fantasy fiction", "Fantasy fiction, English")
```

Seed the canonical table from this module in a migration. Keep the authoritative list in TypeScript (not in SQL) so pull requests that tweak the whitelist are reviewable as code, and the DB `genre` table is just the projection. Confidence: HIGH.

**Matching heuristic:** lowercase both sides, then match `subject.includes(alias) || alias.includes(subject)`. Score by number of word overlaps and pick top-N. Avoid regex golf; a 200-line lookup table is the most maintainable solution. Keep a `subject_unmapped` log output during backfill so the maintainer can expand the whitelist iteratively.

### (e) Mantine form for the manual-edit UI

**Use `@mantine/form` + `mantine-form-zod-resolver`.** Rationale already covered above (no form lib installed today; `@mantine/form` is first-party and matches the 8.3.12 version pin).

Pattern sketch for the metadata edit form:

```tsx
import { useForm } from '@mantine/form';
import { zodResolver } from 'mantine-form-zod-resolver';
import { TagsInput, TextInput, NumberInput, MultiSelect } from '@mantine/core';
// Reuse the SAME Zod schema the PATCH /api/books/:id route uses for validation.
import { BookEditSchema } from '@koinsight/common/schemas/book-edit';

const form = useForm({
  validate: zodResolver(BookEditSchema),
  initialValues: { title: book.title, authors: bookAuthorsAsStrings, genres: genreIds, publication_year: book.publication_year ?? null },
});

// Authors = free-text tags (new authors will be created by the server on save)
<TagsInput {...form.getInputProps('authors')} label="Authors" />

// Genres = MultiSelect bound to the canonical whitelist
<MultiSelect data={canonicalGenreOptions} {...form.getInputProps('genres')} label="Genres" />
```

Notes:

- Put the Zod schema in `packages/common/schemas/` (a new subfolder; the package currently only has `types/`). This makes the same schema reachable from both server (validation) and web (form resolver) per the "no duplicated types" rule in `CONVENTIONS.md`. Confidence: HIGH.
- `TagsInput` (Mantine 8) is the right primitive for author entry; `MultiSelect` for the fixed genre whitelist. Both ship with the already-installed `@mantine/core`.

### (f) Recharts for yearly aggregate reports

**Use Recharts 2.15.0 (already installed).** Both Recharts and `@mantine/charts` 8.3.12 are present; `@mantine/charts` is a thin Mantine-styled wrapper around Recharts. **For the yearly report charts, prefer `@mantine/charts`** because: (i) it matches the dashboard's existing visual language, (ii) it's already a direct dep on the web app, (iii) escape hatches to Recharts components (`<BarChart>`, `<Cell>`, custom tooltips) are available when needed. Confidence: HIGH.

**Chart choices:**

| Report | Chart | Component |
|---|---|---|
| Genre breakdown per year | Horizontal bar, top-N + "Other" | `BarChart` (Mantine) with `orientation="vertical"` |
| Author nationality breakdown | Bar or donut, top-N + "Other" | `DonutChart` or `BarChart` (Mantine) |
| Publication-year distribution | Histogram | `BarChart` with binned buckets (pre-aggregate server-side) |

**Long-tail / binning gotchas (important):**

- **Recharts does NOT auto-bin.** It renders exactly the data rows you pass. For pub-year distribution, aggregate into decade buckets (`1900s`, `1910s`, ...) server-side in SQL (`CAST(publication_year/10 AS INTEGER)*10`). Do not try to bin in React. Confidence: HIGH.
- **"Other" bucket for long tails**: a user who read 60 books across 40 genres will drown a pie chart. Collapse genres with <5% share (or below rank 8) into "Other" server-side. Same for nationalities.
- **Pie/Donut readability**: Recharts/Mantine `DonutChart` degrades badly past ~7 slices. Prefer horizontal bar for anything with a long tail; reserve donut for nationality when top-5 cover >80% of titles.
- **Empty years**: if a user has data in 2022, 2024 but not 2023, DO render `2023: 0` in the year selector so trendlines don't visually skip. Generate the year range from `MIN(start_time)..MAX(start_time)` server-side and outer-join.
- **Sorting**: Recharts respects array order. Sort server-side (descending by count) before returning; do not rely on `recharts` to sort.
- **Responsive sizing**: wrap charts in `<Box h={360}>` — Recharts inside Mantine grids collapses to `height: 0` without an explicit height on the parent. Known footgun; see the existing `apps/web/src/pages/stats/*` for how the repo already handles it.

---

## Installation

```bash
# Server
npm --workspace=server install bottleneck@^2.19.5

# Web
npm --workspace=web install @mantine/form@8.3.12 mantine-form-zod-resolver@^1.3.0

# (No new dev dependencies needed. Vitest/Zod/TS already cover the testing surface.)
```

---

## What NOT to add (explicit anti-recommendations)

| Avoid | Why | Use instead |
|---|---|---|
| BullMQ / ioredis | Adds a Redis service to a self-hosted SQLite app | Bottleneck in-process |
| p-queue >=7, p-limit >=4, ky, got >=12, node-fetch >=3 | ESM-only; cannot `require()` from our CJS server build | Native `fetch` (Node 22) + Bottleneck |
| Any npm OpenLibrary client (`openlibrary`, `open-library-search`) | All abandoned since 2017-2020, tiny usage, outdated schemas | Hand-rolled fetch wrapped with Zod parsers |
| axios / got | HTTP client for a codebase that already uses native `fetch` | Native `fetch` |
| node-cron / cron | Built for repeating schedules; our backfill is a boot-time one-shot | `setImmediate(() => BackfillService.run())` after `app.listen` |
| react-hook-form / Formik | Not installed; a third form paradigm in an app that barely has forms | `@mantine/form` |
| BISAC / ISBNdb / Goodreads genre taxonomies | Licensed or scrape-only; explicitly out of scope per `PROJECT.md` | Hand-curated `CANONICAL_GENRES` TS module |
| `book-genres` / `literary-genres` npm packages | Unmaintained since 2021, <200 weekly dl, toy quality | Hand-curated list |
| Chart.js / Victory / nivo | Recharts + @mantine/charts already installed; second chart lib is bundle bloat | `@mantine/charts` (Mantine styling) with Recharts escape hatches |
| Prisma / Drizzle / TypeORM | Knex is the persistence layer | Knex migrations (SQL-first) |
| `openai` for metadata enrichment | Explicitly deferred in `PROJECT.md` (out of scope) | OpenLibrary only |

---

## Version compatibility notes

| Concern | Detail | Confidence |
|---|---|---|
| Bottleneck + CJS server | `bottleneck@2.19.5` ships a CJS `main: lib/index.js`. Verified via `npm view bottleneck main`. Works with `require()` under our `tsconfig.json` (`module: commonjs`). | HIGH |
| `@mantine/form` version pin | Must match the other `@mantine/*` packages at `8.3.12`. Minor-version skew inside Mantine 8 is generally safe, but matching is the low-risk choice. | HIGH |
| `mantine-form-zod-resolver` + Zod 4.x | Zod 4 had a breaking change to error format vs. Zod 3. Verify `mantine-form-zod-resolver@^1.3.0` supports Zod 4 before install; if not, pin to `^1.2.0` against Zod 3 pattern or adjust resolver manually. **Flag for verification at install time.** | MEDIUM |
| Knex 3.1.0 + SQLite `onConflict().merge()` | Supported; already used in `UploadService.uploadStatisticData`. Safe for the author-seed migration. | HIGH |
| Native `fetch` + `User-Agent` header | Node 22's `undici` fetch honors custom `User-Agent`. Confirmed. | HIGH |
| OpenLibrary 3 req/s under Bottleneck | `minTime: 400` (2.5 req/s) gives 16% headroom for retries. Don't push to `minTime: 333` (3 req/s exact); one bad clock will trip 429s. | HIGH |

---

## Sources

- `https://openlibrary.org/developers/api` — fetched 2026-04-23; verified rate limits (1 req/s default, 3 req/s with identifying User-Agent), endpoint index, and batch-discouragement policy. **HIGH confidence.**
- `https://openlibrary.org/dev/docs/api/search` — fetched 2026-04-23; verified `fields=` parameter and `search.json` shape. **HIGH confidence.**
- `https://openlibrary.org/works/OL45804W.json` — fetched live 2026-04-23; confirmed `subjects`, `subject_places`, `subject_people`, `subject_times`, `authors[]`. Confirmed `first_publish_date` is NOT reliably present on works. **HIGH confidence.**
- `https://openlibrary.org/authors/OL23919A.json` — fetched live 2026-04-23; confirmed NO nationality / birth_place fields on author JSON. **HIGH confidence.** (Drives the "parse nationality from bio prose" design.)
- `npm view bottleneck main` / `npm view p-queue version` / `npm view p-limit version type` — confirmed bottleneck 2.19.5 is CJS (`lib/index.js`); p-queue 9.x and p-limit 7.x are ESM (`type: module`), and 6.x/3.x are the last CJS-compatible majors. **HIGH confidence.**
- `apps/server/tsconfig.json` + `apps/server/package.json` — confirmed CJS build target. **HIGH confidence.**
- `apps/web/package.json` — confirmed no form library installed. **HIGH confidence.**
- `.planning/codebase/STACK.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/CONVENTIONS.md` — reviewed for layering/naming conventions to ensure new modules fit. **HIGH confidence.**
- `mantine-form-zod-resolver` Zod 4 compatibility: **MEDIUM confidence** — verify at install time; fallback plan noted.

---

*Stack research for: book metadata enrichment + yearly reports milestone*
*Researched: 2026-04-23*
