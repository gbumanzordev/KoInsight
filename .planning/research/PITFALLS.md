# Pitfalls Research

**Domain:** OpenLibrary-based book metadata enrichment for a self-hosted reading analytics dashboard (KoInsight)
**Researched:** 2026-04-23
**Confidence:** HIGH for OpenLibrary/SQLite quirks (official issues, docs, data dumps); MEDIUM for UX/report correctness (synthesized from general practice); HIGH for Internet Archive outage history (news sources).

Phase labels used below map to the expected milestone phases:
`schema` = schema + data migration phase; `enrichment` = OpenLibrary resolver/service phase; `backfill` = one-time backfill job phase; `report` = yearly report phase; `edit-ui` = manual edit UI phase; `ops` = deploy/ops concerns.

---

## a) OpenLibrary API quirks and data-quality landmines

### Pitfall A1: Wrong author matches on common names (OL picks the wrong `OL...A`)

**Severity:** HIGH

**What goes wrong:**
A search for "John Smith" or "Haruki Murakami" returns multiple author records. OL's own search backend will sometimes resolve the wrong one because author disambiguation in OL is known to be inconsistent across endpoints. Nationality lookups then get silently attached to the wrong human.

**Warning signs:**
- Backfill produces clusters of books where the author bio/nationality flipped suddenly.
- A single author has >1 `openlibrary_key` across your DB.
- The first book for an author resolves nationality=US but the second resolves nationality=UK for the same name.

**Prevention:**
- Never resolve an author from the raw string alone. Always resolve via a book/edition/work first, then dereference the `authors[].key` returned by the Work. This at least ties the author to the book the user actually read.
- Record the resolution context (ISBN, edition key, work key) alongside the author key so you can re-run when the ambiguity resolves.
- For multi-book matches on the same author string, require the same `OL...A` to be returned on >=2 works before committing a nationality. Low-confidence matches go to a review queue.

**Phase to address:** `enrichment`

**Citation:** [OpenLibrary Issue #10851 — Inconsistent Author field between Search / Query / Works / Books APIs](https://github.com/internetarchive/openlibrary/issues/10851)

---

### Pitfall A2: Subjects live on Work, not Edition (and you'll hit the wrong endpoint)

**Severity:** HIGH

**What goes wrong:**
OL follows FRBR: the Work (`OL...W`) is the "Platonic" book; Editions (`OL...M`) are printings. Subjects, author links, and first-publish-year live on the Work. If the resolver fetches `/books/OLxxxM.json` (edition) or `/isbn/<isbn>.json`, the JSON typically has no useful subjects, and your genre pipeline returns empty for everything.

**Warning signs:**
- Books that should have subjects (popular novels) come back with `subjects: []` or `undefined`.
- Edition JSON looks small (~10 fields); Work JSON looks large.
- All books get enriched with title/cover/year but zero genres.

**Prevention:**
- Resolution order must be: ISBN -> Edition -> `works[0].key` -> Work. Read subjects/authors/first_publish_year from the Work, not the Edition.
- Treat Edition as a source only for: title variant, language, publish_date, cover, page_count.
- Integration test: assert a Work response contains `subjects` before trusting any resolver.

**Phase to address:** `enrichment`

**Citation:** [OpenLibrary Read API](https://openlibrary.org/dev/docs/api/read), [OpenLibrary Search API](https://openlibrary.org/dev/docs/api/search)

---

### Pitfall A3: Subject noise — "Accessible book", "Protected DAISY", "In library", "New York Times bestseller"

**Severity:** HIGH

**What goes wrong:**
OL subjects are crowdsourced plus imported from LCSH plus marketing tags. A real book can have 40+ subjects mixing: real genres (`Science Fiction`), format labels (`Accessible book`, `Protected DAISY`, `Large type books`, `In library`), marketing (`New York Times bestseller`), library workflow (`Open Library Staff Picks`), and LCSH fragments (`Fiction, general`, `Juvenile fiction`). Treating them as genres produces a yearly report that shows the user's top genre is "Protected DAISY".

**Warning signs:**
- Whitelist mapping produces genre="Accessible book" or "In library".
- Same subject with different casings/spellings mapped to different whitelist entries.
- A Sci-Fi novel's top genre is "Fiction, general".

**Prevention:**
- Hard-coded denylist of format/accessibility/library-workflow subjects applied BEFORE whitelist mapping.
- Case-fold, trim, and normalize whitespace/hyphens on the subject string before mapping.
- Mapping rules are exact-match or regex on the normalized string, never substring (`"Fiction"` should not match `"Juvenile fiction"` accidentally).

**Phase to address:** `enrichment` (mapping rules), `schema` (store both raw subjects and mapped genres so re-mapping doesn't require re-fetching)

**Citations:** [OpenLibrary: Using Subjects](https://openlibrary.org/tour/subjects), [OL Protected DAISY subject page](https://openlibrary.org/subjects/protected_daisy), [OL Accessible book subject page](https://openlibrary.org/subjects/accessible_book)

---

### Pitfall A4: Missing/ambiguous nationality in author bios ("less than 2%" have bios)

**Severity:** HIGH (this is the feature's core promise)

**What goes wrong:**
Per the skeptric analysis of the OL data dump: less than 2% of author records have a bio, only 22% have a `birth_date`, and 4% have `alternate_names`. The `bio` field, when present, is free-form prose, not structured. "Nationality" is not a first-class field. Strings like "American-British novelist", "born in Belgium, lived mostly in France", or "Nigerian-born, UK-based" have no canonical parse.

**Warning signs:**
- >50% of enriched books have `author.nationality = NULL`.
- Yearly report nationality chart is dominated by "Unknown".
- A single author has conflicting nationality values across re-enrichments.

**Prevention:**
- Do not scrape nationality from `bio` heuristically. Prefer `remote_ids.wikidata` (7% of authors have it per skeptric) and query Wikidata `P27` (country of citizenship) which is structured.
- Where Wikidata is missing, fall back to `birth_place`/`country` if populated, else leave NULL and surface in the "needs manual enrichment" queue. Report UI must explicitly display "Unknown: N%" rather than rebalancing the chart.
- Support multi-valued nationality (array, not string) from day one; collapse to "primary" only at report time if needed. Expect "American-British" to be a real case.

**Phase to address:** `enrichment` (strategy), `edit-ui` (manual override), `report` (Unknown bucket)

**Citations:** [skeptric: What's in Open Library Data](https://skeptric.com/openlibrary-exploration/), [OL Author API](https://openlibrary.org/dev/docs/api/authors)

---

### Pitfall A5: Stale/vandalized records (crowdsourced data, no TTL in your cache)

**Severity:** MEDIUM

**What goes wrong:**
OL is wiki-like. Records get vandalized, merged, split. A Work you cached at enrichment time may be deleted/merged upstream, so its key stops resolving or points to a redirect. If you cache forever, your library freezes on an old snapshot that no longer exists upstream.

**Warning signs:**
- Re-fetching a known work key returns 404 or a different title.
- User-reported "wrong cover / wrong book" tickets on books that used to be correct.

**Prevention:**
- Store a `last_enriched_at` timestamp per book. Re-enrich at most every N days for books the user has annotated, and on-demand from the edit UI.
- Follow `location` redirects when resolving a cached OL key; update the stored key if it changes.
- The manual edit UI should have a "Re-fetch from OpenLibrary" button scoped to a single book.

**Phase to address:** `enrichment`, `edit-ui`

**Citation:** [OpenLibrary Guidelines](https://openlibrary.org/community/guidelines)

---

### Pitfall A6: The October 2024 Internet Archive outage is not a theoretical risk

**Severity:** HIGH for backfill, MEDIUM steady-state

**What goes wrong:**
Internet Archive (and OpenLibrary with it) was offline or read-only for most of October 2024 due to a data breach + DDoS campaign. OL was unavailable for roughly two weeks, came back read-only on Oct 21, and write APIs were disabled longer. A deploy-time backfill during that window would have either wedged server boot or silently marked every book as "unmatched".

**Warning signs:**
- Sudden spike in 5xx from `openlibrary.org`.
- Resolver 0% hit rate across all books.
- [status.openlibrary.org](https://openlibrary.org/status) shows degraded.

**Prevention:**
- Backfill MUST NOT block server boot. Run it as a detached worker (setImmediate / separate process / cron-like tick) with a feature flag to disable it entirely.
- Treat "N consecutive failures" as an OL-outage circuit breaker: pause backfill, log once, retry with exponential backoff capped at hours.
- On-sync enrichment must be fire-and-forget so kosync/plugin sync doesn't fail just because OL is down. Queue failed enrichments for retry.
- Never mark a book as "enrichment failed permanently" on a 5xx; only on a 404 confirmed by a second lookup path.

**Phase to address:** `backfill`, `enrichment`, `ops`

**Citations:** [Internet Archive Services Update 2024-10-21](https://blog.archive.org/2024/10/21/internet-archive-services-update-2024-10-21/), [BleepingComputer: IA data breach](https://www.bleepingcomputer.com/news/security/internet-archive-hacked-data-breach-impacts-31-million-users/), [OL status page](https://openlibrary.org/status)

---

### Pitfall A7: Rate limit is informal and tightened in 2025

**Severity:** MEDIUM

**What goes wrong:**
OL historically had no documented rate limit, but 2024/2025 saw a stated policy plus 429s observed in the wild, including to logged-in librarian accounts on simple requests. January 2025 shipped a breaking change to `/search.json` reducing default fields. Unannotated bulk backfill requests (no User-Agent, high concurrency) are the fastest way to get blocked.

**Warning signs:**
- 429 responses.
- Sudden drop in success rate mid-backfill.
- Response times balloon (OL throttling via slowdown rather than rejection).

**Prevention:**
- Always send `User-Agent: KoInsight/<version> (<maintainer contact>)`. OL explicitly asks for this.
- Hard-cap concurrent OL requests to 1-2 during backfill; 5/sec is the proposed threshold in OL's own issue.
- Prefer the bulk `/search.json?q=...&fields=...` with explicit `fields` over N per-book lookups; always pin the `fields` list since defaults changed in Jan 2025.
- Consider consuming the monthly [OL data dumps](https://openlibrary.org/developers/dumps) for backfill instead of hammering the live API. For "tens to low thousands of books" this probably isn't necessary, but it's the escape hatch if rate limits bite.

**Phase to address:** `enrichment`, `backfill`

**Citations:** [OL Issue #8534 — Rate Limiting Policy](https://github.com/internetarchive/openlibrary/issues/8534), [OL Issue #10585 — Understanding rate limits](https://github.com/internetarchive/openlibrary/issues/10585), [OL Issue #11611 — 429 on simple requests](https://github.com/internetarchive/openlibrary/issues/11611), [OL Blog: Search.json performance tuning Jan 2025](https://blog.openlibrary.org/2025/01/16/api-search-json-performance-tuning/)

---

### Pitfall A8: International titles — OL indexes Works, original-language titles don't match

**Severity:** MEDIUM

**What goes wrong:**
OL's Solr indexes at the Work level. A Japanese user whose KOReader sidecar has `雪国` (Snow Country) will search OL and either get no hit or the wrong work. Russian titles with Cyrillic (`Мастер и Маргарита`) may not match the English edition the user has. Transliteration variants ("Dostoyevsky" vs "Dostoevsky" vs "Достоевский") collide.

**Warning signs:**
- Non-ASCII title books have high "unmatched" rate.
- CJK titles silently match to a totally different Latin-titled work (Solr's tokenizer fell back).

**Prevention:**
- Always try ISBN lookup first; ISBN bypasses the title search entirely. KOReader sidecar often has the ISBN.
- Fall back to `title + author + language:xxx` with `lang` filter, not just title.
- Accept that unmatched rate will be higher for non-English books, and make the edit UI first-class for those cases. The backfill report should surface unmatch rate by language.

**Phase to address:** `enrichment`, `edit-ui`

**Citations:** [OL Searching the Open Library](https://openlibrary.org/about/helpSearch), [OL blog: Open Library in Every Language](https://blog.openlibrary.org/2021/11/05/open-library-in-every-language/)

---

## b) Author normalization pitfalls

### Pitfall B1: "Lastname, Firstname" vs "Firstname Lastname" vs "F. Lastname"

**Severity:** HIGH

**What goes wrong:**
KOReader sidecars, OL editions, and OL authors all use different conventions. `"Murakami, Haruki"` and `"Haruki Murakami"` and `"H. Murakami"` should collapse to one author row; naive string-equality keeps them as three. Meanwhile splitting on `", "` breaks on `"Smith, Jr."` and on Chinese names where family name comes first without a comma.

**Warning signs:**
- Same real author appears multiple times in the `author` table.
- Author count explodes after backfill (e.g., 3000 authors for 800 books).
- Report shows "Haruki Murakami" and "Murakami, Haruki" as different people.

**Prevention:**
- Don't normalize by string munging alone. Treat the OL author key (`OL...A`) as the identity, and use string matching only as a last resort.
- When string matching is unavoidable, normalize both sides: lowercase, strip diacritics (but keep a display copy), collapse whitespace, parse `"Last, First"` to `"First Last"`, but only when exactly one comma and no trailing suffix (`Jr.`, `Sr.`, `III`).
- Store `display_name` (raw) and `normalized_name` (munged) separately. Dedup on (openlibrary_key OR normalized_name).

**Phase to address:** `schema`, `enrichment`

**Citation:** [PMC: What's in a name? The problem of authors' names in research articles](https://pmc.ncbi.nlm.nih.gov/articles/PMC4910268/)

---

### Pitfall B2: Translators, illustrators, editors misattributed as authors

**Severity:** HIGH

**What goes wrong:**
Edition records on OL have a `contributors` array and sometimes jam translator names into `authors` or the edition's free-text `by_statement`. The result: a user reading translated fiction sees "Jay Rubin" (translator) as a Japanese author, blowing up the nationality breakdown.

**Warning signs:**
- Books with `language != original_language` have extra authors.
- Translator's name appears repeatedly across many unrelated books.
- Author nationality distribution skews sharply toward English-speaking countries for a user who reads a lot of translated fiction.

**Prevention:**
- Pull authors from the Work, not the Edition. The Work's author list is the original-language author(s).
- If you must read the Edition, inspect `contributors[].role` and exclude `Translator`, `Illustrator`, `Editor`, `Foreword`, `Introduction`, `Afterword`.
- Cross-check: if an Edition's author list is a strict superset of the Work's, assume the extras are contributors and drop them.

**Phase to address:** `enrichment`

---

### Pitfall B3: Co-author strings like `"Smith, John and Jane Doe"` or `"John Smith; Jane Doe"`

**Severity:** MEDIUM

**What goes wrong:**
KOReader's single string author field can concatenate co-authors with various delimiters (`;`, `&`, ` and `, ` / `, `,`). Splitting too eagerly shatters names like "Smith, Jr." into two authors; splitting too conservatively treats "Smith & Doe" as one person named "Smith & Doe".

**Warning signs:**
- Author rows with `&`, `and`, `;` in the name.
- Books that should have 2 authors show 1, or vice versa.

**Prevention:**
- For existing rows, don't pre-split. Resolve the book via ISBN/title to OL first; use OL's Work.authors[] as the truth. Only fall back to splitting the raw string when OL match fails.
- When splitting is necessary, apply in order: `;`, ` & `, ` and ` (with word boundaries), then reject any fragment containing trailing `Jr.`/`Sr.`/`III`/`Ph.D.`.
- Require manual confirmation via edit UI for any split that produces >3 authors.

**Phase to address:** `schema` (junction table supports N authors from day 1), `enrichment`

---

### Pitfall B4: Pseudonyms, corporate authors, "Various", "Anonymous"

**Severity:** MEDIUM

**What goes wrong:**
Anthologies list `author = "Various"`. Corporate publications list `author = "U.S. Department of State"`. Pseudonyms (Richard Bachman = Stephen King) resolve to different OL keys. Nationality of "Various" is meaningless; nationality of "U.S. Department of State" is trivially "US" but isn't a person.

**Warning signs:**
- Author named "Various", "Anonymous", "Staff", or ending in "Inc.", "Ltd.", "Department", "Committee".
- One author with hundreds of unrelated books (pseudonym or collective).

**Prevention:**
- Add `author.kind` column: `person | pseudonym | corporate | collective | unknown`. Only `person` and resolved pseudonyms count in nationality reports.
- Detect corporate heuristically (regex on trailing `Inc|Ltd|LLC|Corp|Department|Committee|Press|Foundation`) and flag.
- For known pseudonyms, allow a manual "same person as" link in the edit UI. Don't auto-merge.

**Phase to address:** `schema`, `edit-ui`, `report` (filter non-persons out of nationality chart)

---

### Pitfall B5: Duplicate author rows created by the backfill

**Severity:** HIGH

**What goes wrong:**
Backfill processes books in parallel. Two workers hit the same new author at the same time; both INSERT; now you have two author rows and two `book_author` edges pointing at different ones. SQLite has no `ON CONFLICT DO NOTHING RETURNING id` in older versions; a naive `insertOrIgnore` followed by `select` is a race.

**Warning signs:**
- `author` table has duplicates with identical `openlibrary_key`.
- `book_author` foreign keys split evenly between two author rows for the same person.

**Prevention:**
- UNIQUE constraint on `author.openlibrary_key` (nullable but unique when present). Partial index or trigger to allow multiple NULLs.
- Use SQLite's `INSERT ... ON CONFLICT(openlibrary_key) DO UPDATE SET ... RETURNING id` (available in better-sqlite3 with modern SQLite) for atomic upsert.
- Serialize author writes (single-writer mutex) if upsert isn't viable; SQLite is single-writer anyway so the bottleneck is moot.

**Phase to address:** `schema` (constraints), `enrichment` (upsert), `backfill` (concurrency)

---

## c) Genre / taxonomy pitfalls

### Pitfall C1: Whitelist drift — nobody maintains it

**Severity:** MEDIUM

**What goes wrong:**
The ~50-100 entry curated whitelist is hand-written once, then reality drifts: new subjects appear in OL, typos/variants aren't matched, and the user-facing "top genres" chart is stable only because the whitelist froze. Six months in, 40% of books have zero whitelisted genres.

**Warning signs:**
- Monotonically increasing `unmapped_subjects_count` metric.
- Coverage rate (books with >=1 whitelisted genre) drops over time.
- Top "unmapped subjects" list has obvious real genres in it.

**Prevention:**
- Store the whitelist + mapping rules as data in the DB (or a seeded JSON file the user can edit), not hard-coded. Version the whitelist; tag each `book_genre` row with the whitelist version that produced it.
- Expose an admin view: "most common unmapped subjects, sorted by book count" so the maintainer can triage additions.
- Re-map (not re-fetch) whenever the whitelist version bumps; this is cheap because raw subjects are stored.

**Phase to address:** `schema` (store raw subjects + whitelist version), `edit-ui` (admin view)

---

### Pitfall C2: Overlapping categories cause double-counting

**Severity:** MEDIUM

**What goes wrong:**
A book gets mapped to "Fiction", "Literary Fiction", AND "Contemporary Fiction" because all three match. The yearly pie chart adds up to 180% or the user's "most read genre" is a meaningless parent category ("Fiction") that covers almost everything.

**Warning signs:**
- Sum of genre percentages in a year > 100% (expected with multi-label, but if it's 200%+ it's a hierarchy issue).
- Top genre for every user every year is "Fiction".

**Prevention:**
- Define the whitelist as a flat set with explicit parent/child relations, and pick ONE display level for the chart (typically child-only, fall back to parent if no child matched).
- Mutual-exclusion rules: "Literary Fiction" implies remove "Fiction" from that book's tags.
- Decide up front: is the yearly report "primary genre per book" (1 per book) or "all genres per book" (multi-label)? They need different queries. The user's question "what's my genre breakdown" is ambiguous; pick primary for the default chart and show multi-label in a secondary view.

**Phase to address:** `schema` (genre hierarchy), `report`

---

### Pitfall C3: Format/workflow labels sneaking past the whitelist

**Severity:** HIGH (already covered by A3, but worth restating as a taxonomy concern)

**What goes wrong:**
Same as A3 but from the taxonomy side: if the whitelist is built by grep'ing top subjects from OL, "Accessible book" and "Protected DAISY" are in the top 20 globally and will look like real genres to a casual curator.

**Prevention:** See A3. Additionally, document the denylist as a separate explicit list in code, not an absence from the whitelist.

**Phase to address:** `enrichment`

---

### Pitfall C4: Non-English books with foreign-language subjects

**Severity:** MEDIUM

**What goes wrong:**
French books on OL often have French subjects (`Roman`, `Littérature française`). Japanese books have Japanese subjects. Spanish library imports have LCSH-es subjects. Whitelist is English-only, so these books get zero genre coverage.

**Warning signs:**
- "% with at least one genre" is near 100% for English-language books and near 0% for `language != 'eng'`.
- Top unmapped subjects list is dominated by non-Latin script or French/Spanish terms.

**Prevention:**
- For the scope of this milestone (single maintainer, low thousands of books), acknowledge the gap: document that non-English enrichment is best-effort.
- Build whitelist mapping with language-tagged synonyms where cheap: `Roman -> Fiction`, `Littérature -> Literature`, a small hardcoded set for the top 5 non-English languages in the user's library.
- Report UI: show per-language coverage so the user can see the gap rather than silently under-reporting.

**Phase to address:** `enrichment`, `report`

---

## d) Schema migration pitfalls (SQLite + Knex)

### Pitfall D1: SQLite's DROP COLUMN / ALTER is a table-rebuild under the hood

**Severity:** HIGH

**What goes wrong:**
Knex emulates `dropColumn`/`alterColumn` on SQLite by creating a copy of the table, copying rows, dropping the original, and renaming. This has documented failure modes: if foreign keys point at the table, ON CASCADE DELETE fires during the drop and wipes dependent rows. Composite FKs, generated columns, and `AUTOINCREMENT` all have edge cases. Disabling FKs inside a transaction is a no-op on SQLite, which means Knex throws in recent versions rather than silently eating data.

**Warning signs:**
- Migration test wipes `book_author` when altering `book`.
- Migration fails with "Disabling/enabling foreign keys within a transaction is not supported in SQLite".
- Row counts drop after a migration that should be non-destructive.

**Prevention:**
- For any `ALTER` on a table with inbound FKs, write the migration with `config.transaction = false` and manage FK pragma manually: `PRAGMA foreign_keys = OFF; BEGIN; ... COMMIT; PRAGMA foreign_keys = ON;`.
- Prefer additive migrations: ADD new columns/tables, backfill, then deprecate old ones in a later release. Don't DROP on the same migration that renames.
- The `book.authors` string column: keep it, add `book_author` junction alongside, populate the junction in code, then drop the string column in a later migration after a release cycle of observation.

**Phase to address:** `schema`

**Citations:** [Knex Issue #4155 — FKs prevent table-altering migrations on SQLite](https://github.com/knex/knex/issues/4155), [Knex Issue #5367 — adding a column dropped original table](https://github.com/knex/knex/issues/5367), [SQLite ALTER TABLE docs](https://sqlite.org/lang_altertable.html), [Knex migrations guide](https://knexjs.org/guide/migrations.html)

---

### Pitfall D2: Data backfill inside the schema migration blocks server boot

**Severity:** HIGH

**What goes wrong:**
KoInsight runs Knex migrations on server startup (`apps/server/src/app.ts`). If a migration does `UPDATE book SET ...` across the whole table, or worse, calls OpenLibrary, the server takes minutes to come up (or forever during the Oct 2024 IA outage). Docker healthcheck fails, restarts, the migration is half-done, next boot is worse.

**Warning signs:**
- Server startup time grows linearly with book count.
- Migration contains network I/O or loops over all rows.
- Docker container repeatedly restarts after deploy.

**Prevention:**
- Schema migrations: structure only. Create tables, add columns, add indexes. No data enrichment. No network.
- Data backfill: a SEPARATE, idempotent job fired AFTER boot, off the request path. Persist progress (`backfill_progress` table) so interruption doesn't restart from zero.
- If a migration MUST touch data (e.g., splitting the `authors` string into a junction table for existing rows), do the minimum deterministic split synchronously and flag rows as `needs_enrichment=true` for the async worker to finish.

**Phase to address:** `schema`, `backfill`, `ops`

---

### Pitfall D3: Foreign key cascade surprises with `book_author` / `book_genre`

**Severity:** MEDIUM

**What goes wrong:**
`ON DELETE CASCADE` on `book_author(book_id)` is usually what you want (delete a book, cleanup junction). But `ON DELETE CASCADE` on `book_author(author_id)` means "delete an author (e.g., during dedupe merge) and silently remove all book-author links". Your merge-duplicate-authors feature then loses book attributions.

Also: Knex's SQLite `onDelete('CASCADE')` has a history of bugs where the clause was generated as literal `undefined` or didn't persist correctly.

**Warning signs:**
- Deleting a duplicate author removes the surviving author's book links too.
- `book_author` rows disappear unexpectedly.
- `PRAGMA foreign_key_check` returns rows pointing to nothing.

**Prevention:**
- `book_author.book_id` -> `ON DELETE CASCADE`. `book_author.author_id` -> `ON DELETE RESTRICT`. Author deletion must be explicit (re-point junction rows first, then delete).
- Audit generated SQL of every FK migration in test (`sqlite_master` inspection) to confirm the cascade clauses are actually set.
- Always enable `PRAGMA foreign_keys = ON` on the better-sqlite3 connection; SQLite defaults to OFF per-connection and silently accepts orphan rows otherwise.

**Phase to address:** `schema`

**Citations:** [Knex Issue #166 — sqlite `onDelete('CASCADE')` not working](https://github.com/knex/knex/issues/166), [Knex Issue #4250 — `undefined` ON DELETE](https://github.com/knex/knex/issues/4250)

---

### Pitfall D4: `UNIQUE` on nullable `openlibrary_key` misbehaves

**Severity:** MEDIUM

**What goes wrong:**
You want `UNIQUE(author.openlibrary_key)` for dedup, but many authors won't have an OL key (manually created, match failed). SQLite treats each NULL as distinct so UNIQUE works, but a naive upsert `ON CONFLICT(openlibrary_key)` doesn't fire for NULL keys and creates duplicates of "Anonymous" / "Various".

**Prevention:**
- UNIQUE on `openlibrary_key` is fine; do NOT rely on it for dedup of NULL-key authors.
- For NULL-key authors, dedup on `(normalized_name, kind)` via a partial unique index: `CREATE UNIQUE INDEX author_noolkey ON author(normalized_name, kind) WHERE openlibrary_key IS NULL`.
- Upsert strategy: if OL key present, conflict on key; else conflict on `(normalized_name, kind)`.

**Phase to address:** `schema`

---

## e) Backfill execution pitfalls

### Pitfall E1: No progress persistence — crash restarts from scratch

**Severity:** HIGH

**What goes wrong:**
A backfill that iterates `SELECT * FROM book WHERE enriched_at IS NULL` and calls OL for each will, on crash (OOM, deploy, OL 5xx storm), restart from a different page or redo work it already did. Worse: if the worker doesn't commit per-book, partially-enriched books get rolled back.

**Warning signs:**
- Backfill restarts after deploy and re-hits OL for the first N books.
- `enriched_at` column is populated in bursts, not monotonically.
- Memory grows linearly during the run (accumulator never flushed — see CockroachDB PR #147511 for an example of this exact bug in a production backfill).

**Prevention:**
- Use `enriched_at IS NULL` as the progress marker. Commit each book's enrichment in its own transaction. Crash = at most one book lost in flight.
- Expose a `backfill_status` table: `{total, processed, failed, last_run_at}` for the UI.
- Idempotency: enriching the same book twice must converge to the same result, not duplicate author/genre rows.

**Phase to address:** `backfill`

**Citation:** [CockroachDB PR #147511 — memory leak in index backfill progress tracking](https://github.com/cockroachdb/cockroach/pull/147511)

---

### Pitfall E2: Unbounded concurrency hammers OpenLibrary, gets you rate-limited

**Severity:** HIGH

**What goes wrong:**
`Promise.all(books.map(enrichOne))` fires 1000 concurrent OL requests. OL's nascent rate limiter (see A7) drops you; you log 1000 errors and mark 1000 books as failed.

**Prevention:**
- Pool concurrency to 1-2 workers for backfill, 1 for on-sync enrichment. `p-limit` or a simple queue.
- Pace between requests (~250-500ms) even within the limit, to stay under 5/sec across workers.
- Per-host throttling, not per-worker: if you ever add a second provider, the OL budget is shared across request types (author lookup, work lookup, cover).

**Phase to address:** `backfill`, `enrichment`

**Citation:** [OL Issue #8534 — Rate Limiting Policy](https://github.com/internetarchive/openlibrary/issues/8534)

---

### Pitfall E3: Backfill blocks the Node event loop / steals DB writes from sync

**Severity:** HIGH

**What goes wrong:**
Node is single-threaded. A backfill that parses 50MB JSON responses or runs heavy Ramda transforms starves the HTTP server during active reading sessions. SQLite is single-writer; a backfill transaction holds a write lock and KOReader's `/api/plugin/bulk-sync` times out.

**Warning signs:**
- Kosync sync requests time out while backfill is running.
- `/api/plugin/*` p99 latency correlates with backfill activity.
- Event loop lag metric (or naive `setInterval` jitter) spikes.

**Prevention:**
- Yield explicitly between books: `await setImmediate()` between each enrichment step.
- Keep DB transactions small and short-lived. Never open a transaction before an OL HTTP call; fetch first, transact second.
- Rate-limit backfill to pause entirely during user activity (simple: last-sync-at < 1min ago = pause).
- If pressure is real, move backfill to a worker thread or child process. For this project's scale (tens to low thousands of books), event-loop yielding is probably enough.

**Phase to address:** `backfill`, `ops`

---

### Pitfall E4: Poison pill — one book always fails, backfill never terminates

**Severity:** MEDIUM

**What goes wrong:**
A book with a malformed ISBN, or that triggers a specific OL bug, throws every time. A retry loop without a dead-letter bucket keeps re-trying forever. The `% complete` metric stays at 99.9%.

**Prevention:**
- Per-book `enrichment_attempts` counter; after N (e.g., 3) failures, mark the book `enrichment_status = 'failed'` with the last error and skip in normal backfill.
- Expose failed books in the edit UI so the user can fix the ISBN manually.
- Backfill termination condition is `WHERE enrichment_status = 'pending'`, not "until no errors".

**Phase to address:** `backfill`, `edit-ui`

---

### Pitfall E5: Silent success on junk match (worse than failing)

**Severity:** HIGH

**What goes wrong:**
OL search for "Dune" returns three different works. The resolver picks the first. It happens to be a 1984 film novelization, not Frank Herbert's novel. Book gets enriched with wrong author, wrong year, wrong genres. User sees "thriller" in their 2025 report and doesn't know why.

**Warning signs:**
- Books with obviously wrong covers after backfill.
- Author's name in the KOReader sidecar doesn't match any `book_author` row for that book.

**Prevention:**
- Match-score the resolver output: title similarity (fuzzy), author overlap, language match. If score < threshold, mark `enrichment_status = 'low_confidence'` and SKIP writing genre/nationality (only write cover/year which are cheap to roll back).
- Cross-check: KOReader sidecar author string must overlap (token-level, case-insensitive) with at least one OL Work author before committing.
- Expose confidence in the edit UI: low-confidence matches get a yellow banner "We're not sure this is the right book".

**Phase to address:** `enrichment`, `edit-ui`

---

## f) Report correctness pitfalls

### Pitfall F1: Year boundary + timezone — "what did I read in 2025?"

**Severity:** HIGH

**What goes wrong:**
`page_stat` timestamps are stored (likely) as UTC unix seconds per KOReader convention. Bucketing by `strftime('%Y', start_time, 'unixepoch')` gives UTC year. A user in UTC+9 finishing a book at 10 PM local on 2025-12-31 has their reading session in UTC 2026. Their 2025 report is missing the last two hours of the year; their 2026 report includes reading they did on NYE.

Also: "books read in 2025" can mean (a) any reading session in 2025, (b) finished in 2025, or (c) started in 2025. Each gives a different answer.

**Warning signs:**
- Sum of yearly genres != total books (book spans years).
- User asks "why is this 2024 book in my 2025 report?"

**Prevention:**
- Define "read in year Y" explicitly: recommend "any reading session in Y" for the chart, "finished in Y" for the "books completed" count. Document both in the UI.
- Convert timestamps to the user's local timezone before bucketing. SQLite: `strftime('%Y', datetime(start_time, 'unixepoch', 'localtime'))` depends on server TZ; better to pass the user's TZ as a parameter and compute the year in JS using `Intl.DateTimeFormat`.
- For cross-year books, decide whether to attribute to "year most read in" or "year finished in"; be consistent.

**Phase to address:** `report`

**Citation:** [Empirical Study of Date and Time Bugs in Open Source](https://rohan.padhye.org/files/datetimebugs-msr25.pdf)

---

### Pitfall F2: Partial reads counted as full reads

**Severity:** MEDIUM

**What goes wrong:**
The user opens 40 books, finishes 12. The yearly report says "You read 40 books! Top genre: Romance!" but 28 of those were 5-minute sniffs of random things. The genre breakdown is dominated by books the user didn't actually read.

**Warning signs:**
- "Books read" count is implausibly high.
- Top genres don't match the user's self-perception.

**Prevention:**
- Define a "counts as read" threshold: e.g., `progress >= 0.9` OR `total_read_time > 1h` OR explicit "finished" flag from KOReader. Make it configurable in the UI.
- Provide two charts: "books started" vs "books finished". Default the headline number to "finished".
- Weight genre/nationality aggregates by time spent or pages read, not count of books. A finished 800-page Tolstoy should count more than a 2-minute poke at a PDF.

**Phase to address:** `report`

---

### Pitfall F3: Co-authored books inflate nationality counts

**Severity:** MEDIUM

**What goes wrong:**
A book by Gaiman + Pratchett counts once toward "British authors" for each co-author. The user's 10 Good Omens-style books become 20 nationality-rows. Worse: a book co-authored by a US author and a UK author adds 1 to each nationality even though the user read one book.

The PROJECT.md explicitly defers the "fractional credit" decision, so the pitfall is picking a default silently.

**Prevention:**
- Pick a default and document it in the UI tooltip: "primary author" (first author in the `book_author` junction, with explicit `is_primary` flag) is the simplest and matches common user mental models.
- Offer a toggle: "count by primary author" vs "count by all contributors". Both are legitimate.
- Never use "fractional credit" (0.5 + 0.5) silently — users will notice non-integer counts.

**Phase to address:** `schema` (book_author.is_primary or order), `report`

---

### Pitfall F4: Missing data skews denominators

**Severity:** HIGH

**What goes wrong:**
Report: "60% of your authors are American". Footnote missing: "out of 40% of books where we know the nationality". Reality could be anywhere from 24% to 84% of the library.

**Warning signs:**
- Percentage charts sum to 100% while `Unknown` coverage is >20%.
- Report looks confident when data is actually sparse.

**Prevention:**
- Always include an explicit "Unknown" bucket in the chart or the legend, sized proportionally. Never normalize it out.
- Show coverage alongside: "Based on 60 of 100 books where author nationality is known". Link to the edit UI to improve coverage.
- For each report card, define the minimum sample size below which the chart is suppressed in favor of "not enough data yet".

**Phase to address:** `report`

---

### Pitfall F5: Backfill retroactively reclassifies historical reports

**Severity:** MEDIUM

**What goes wrong:**
User views 2024 report on Jan 1, 2025. Backfill runs and finds nationality data it didn't have before. User re-views 2024 report a week later — numbers changed. Year-over-year comparisons also change underneath the user.

**Warning signs:**
- Same year's report gives different numbers on different days.
- "Historical trend" chart wobbles with each backfill pass.

**Prevention:**
- Reports are live queries by default (correct answer wins). But clearly communicate recency: "As of [timestamp], based on current enrichment coverage."
- Do NOT snapshot report numbers into the DB; that creates a second source of truth that diverges.
- For YoY trends, overlay a "coverage" line so the user can see that a 2022 bump is actually a coverage bump, not a behavior bump.

**Phase to address:** `report`

---

## g) UX pitfalls for the manual edit UI

### Pitfall G1: Auto-enrichment overwrites user edits

**Severity:** HIGH

**What goes wrong:**
User manually sets a book's nationality to "Irish" because OL had it wrong. Next sync triggers re-enrichment; the service overwrites the field with OL's "British". User rage-quits.

**Prevention:**
- Per-field provenance: every metadata column has an implicit `_source` of `{openlibrary, manual, null}`. Enrichment only writes fields where `_source != 'manual'`.
- Implement as a single `book_field_overrides` table `(book_id, field_name, value, set_at)` rather than adding a `_source` column per field — easier to query "show me all manual overrides".
- Global rule: manual wins. Always. The only way to undo a manual override is explicit user action ("Reset to OpenLibrary").

**Phase to address:** `schema`, `edit-ui`, `enrichment`

**Citation:** [Atlan: metadata enrichment skips assets with existing values](https://docs.atlan.com/product/capabilities/governance/context-agents-studio/faq/metadata-enrichment)

---

### Pitfall G2: User can't tell where a field came from

**Severity:** MEDIUM

**What goes wrong:**
User looks at a book: title, author, genres, nationality, year. All look plausible. But three of them are OL matches on a low-confidence edition, one is user-edited, one is defaulted. User has no way to tell which is trustworthy without audit-log spelunking.

**Prevention:**
- Inline provenance chips next to each field: `[OL]`, `[Manual]`, `[Unknown]`, and a confidence level (high/low) for OL fields.
- Hover to see: source URL (OL work link), timestamp, which resolver strategy matched.
- Model after Alma's "AI stars" / 588 Source of Description Note pattern.

**Phase to address:** `edit-ui`

**Citation:** [Ex Libris Alma: The AI Metadata Assistant](https://knowledge.exlibrisgroup.com/Alma/Product_Documentation/010Alma_Online_Help_(English)/Metadata_Management/005Introduction_to_Metadata_Management/The_AI_Metadata_Assistant_in_the_Metadata_Editor)

---

### Pitfall G3: No undo / no history

**Severity:** MEDIUM

**What goes wrong:**
User fat-fingers an author name, saves, realizes the mistake. The original OL-sourced value is gone. User now has to re-trigger enrichment and hope it picks the same OL work.

**Prevention:**
- Soft-replace, don't overwrite: keep the prior OL value in `book_field_overrides` so "Reset to OpenLibrary" works without a network round-trip.
- Keep a short audit log per book (`book_edit_log`) with last N changes, enough for undo within a session. Full history is overkill for this project.
- "Reset field to OpenLibrary" button next to every manually-edited field.

**Phase to address:** `edit-ui`, `schema`

---

### Pitfall G4: Bulk operations missing — user can't fix 200 books one by one

**Severity:** MEDIUM

**What goes wrong:**
After backfill, 200 books have `enrichment_status = 'failed'`. Manual edit UI only supports one book at a time. User gives up.

**Prevention:**
- Provide a filterable list view: "unmatched books", "low-confidence matches", "missing nationality", with bulk "retry enrichment" and "hide from reports" actions.
- For authors: a merge-duplicates view showing likely-same authors grouped by normalized name.

**Phase to address:** `edit-ui`

---

## h) Privacy / self-hosting pitfalls

### Pitfall H1: Outbound HTTP from a firewalled self-hosted instance

**Severity:** MEDIUM

**What goes wrong:**
User runs KoInsight on a NAS/LAN with no outbound internet. Deploy-time backfill hangs indefinitely waiting for `openlibrary.org`. Docker container is unhealthy. User has no idea why.

**Prevention:**
- Detect outbound failure fast: 5s connection timeout, a single HEAD to `openlibrary.org` on first run. If it fails, log a clear warning and disable enrichment (don't crash).
- Config flag `ENRICHMENT_ENABLED=false` that fully disables OL calls. Document it in README.
- Graceful degradation: the dashboard still works with unenriched data; the reports show "enrichment disabled, only title/author available" rather than erroring.

**Phase to address:** `ops`, `enrichment`

---

### Pitfall H2: Leaking titles to a third party via search URLs

**Severity:** LOW-MEDIUM (depends on user's threat model)

**What goes wrong:**
Every OL search like `https://openlibrary.org/search.json?q=Lolita` logs the user's reading interests on OL's server. Users who self-host specifically to avoid Goodreads/Amazon tracking may be surprised.

**Prevention:**
- Document clearly in the README: "Enrichment sends book titles/ISBNs to openlibrary.org. Titles may be logged by Internet Archive. Disable with `ENRICHMENT_ENABLED=false`."
- Prefer ISBN lookup (`/isbn/<isbn>.json`) over title search when possible — an ISBN is less identifying than a title.
- Offer an opt-in "enrichment via data dump" mode that downloads the monthly OL dump once and runs locally. Out of scope for MVP but worth documenting as future work.

**Phase to address:** `ops` (documentation), `enrichment`

**Citation:** [OpenLibrary Data Dumps](https://openlibrary.org/developers/dumps)

---

### Pitfall H3: Storing nationality is personal data about third parties (GDPR-adjacent)

**Severity:** LOW (practical), MEDIUM (legal framing)

**What goes wrong:**
The app stores "author X is Russian" in a local DB. The author is a living person. Under GDPR, nationality is potentially special-category data. For a single-user self-hosted app this is almost certainly fine (household exemption, personal use), but making the data user-editable means the user can enter arbitrary claims ("This author is a Nazi") and the app now hosts defamation.

**Prevention:**
- Label nationality clearly as "best-effort metadata from public sources"; don't present it as authoritative.
- Manual override field is free-text but validated against a closed list of country codes (ISO 3166-1 alpha-2) to constrain what users can assert.
- Don't build an author-browsing UI in this milestone (already out of scope per PROJECT.md) — fewer surfaces for author-specific claims.
- For any future hosted/multi-user version, revisit: need a takedown policy and a DPA.

**Phase to address:** `schema` (ISO code column), `edit-ui` (closed-list input), `ops` (README privacy note)

---

### Pitfall H4: User-Agent string leaking maintainer email on every request

**Severity:** LOW

**What goes wrong:**
OL asks for `User-Agent: AppName/version (contact)`. If the template hardcodes the KoInsight maintainer's email, every self-hosted instance worldwide sends that email to OL with every request. OL's logs, plus the maintainer getting blamed for a self-hosted user's rate-limit abuse.

**Prevention:**
- `User-Agent: KoInsight/<version> (+https://github.com/<repo>)` — link to the project, not a personal email.
- Allow the admin to override User-Agent via env var if they want their own contact.

**Phase to address:** `enrichment`, `ops`

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep `book.authors` string AND add `book_author` junction | Avoids a breaking migration to the plugin sync contract | Two sources of truth; every read query must decide which wins | Acceptable during migration window (1-2 releases); must delete the string column eventually |
| Hardcode whitelist in code | Ships faster than building an admin UI | Every whitelist tweak requires a deploy; no per-instance customization | Acceptable for v1 if whitelist is checked into the repo and bumps a version number |
| Run backfill synchronously on boot | One less moving part (no worker) | Server boot ties up for minutes; Docker healthcheck flaps; OL outage = dead deploy | Never acceptable for >100 books |
| Scrape nationality from bio free-text with regex | Gets data where Wikidata is empty | Wrong answers become "canonical" in the DB; user doesn't know to distrust them | Acceptable only if flagged as `low_confidence` and hidden behind a "show inferred" toggle |
| Drop unmatched books from the report entirely | Clean-looking percentages | Hides coverage gaps; user doesn't know the report is lying | Never — always show "Unknown" bucket |
| Skip manual edit UI in v1 | Ship enrichment faster | Any OL miss is permanent user frustration; PROJECT.md already flagged this | Never — user explicitly requires it |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| OpenLibrary Search API | Relying on default `fields` in `/search.json` | Pin `&fields=key,title,author_key,author_name,first_publish_year,subject,language` explicitly; defaults changed in Jan 2025 |
| OpenLibrary Works | Reading subjects from Edition JSON | Always dereference to `/works/<key>.json` for subjects/authors |
| OpenLibrary Authors | Assuming one author = one `OL...A` key | Check `remote_ids.wikidata` for canonical identity; one real person may have multiple OL records |
| OpenLibrary ISBN lookup | Treating `/isbn/<isbn>.json` as "the book" | It returns an Edition; follow `.works[0].key` for the actual metadata |
| OpenLibrary covers | Fetching covers inline during enrichment | Fetch covers lazily on request; they're a separate service with its own flakiness |
| Knex on SQLite | Using transactions around `alterTable`/`dropColumn` with FKs | `transaction: false`, manage `PRAGMA foreign_keys` manually, build table-rebuild migrations by hand |
| better-sqlite3 | Forgetting to enable FK pragma | Run `PRAGMA foreign_keys = ON` at connection open; SQLite defaults OFF per-connection |
| KOReader plugin contract | Changing the `book.authors` payload shape | Plugin sends what it sends; server must accept the string and internally split, forever |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| N+1 OL requests during backfill | Backfill takes hours; many small HTTP calls | Batch via `/search.json?q=isbn:(X OR Y OR Z)` or consume data dump | >500 books |
| Backfill + sync contending for SQLite write lock | Plugin sync times out during backfill window | Pause backfill during active sync; keep backfill txns <100ms | >1 active user or any concurrent sync |
| Loading all books + all authors into memory for report | Memory balloons; slow first load | Aggregate in SQL, not in Node; paginated/aggregate queries only | >5000 books |
| Re-rendering entire Recharts with every filter change | UI jank on year selector change | Memoize aggregate query results per year in SWR; compute once server-side | >1000 books with many genres |
| Fetching full Work JSON when only subjects needed | Bandwidth/CPU waste | Use `/works/X.json?fields=subjects,authors` (supported) | Always |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Not validating OL response shape with Zod before DB write | Malformed/adversarial OL data corrupts DB | Zod schema for every OL response; reject unknown shapes rather than coerce |
| CORS still `origin: '*'` on new metadata/report routes | Any site the user visits can hit their self-hosted API | Already flagged in CLAUDE.md as a tech-debt item; new endpoints inherit the problem. At minimum, require authenticated cookie |
| Free-text nationality field | User-entered defamatory claims persisted | Constrain manual nationality input to ISO 3166-1 alpha-2 codes |
| Uploading user bookshelf data to OL log | Privacy leak for self-hosters | Document in README; provide `ENRICHMENT_ENABLED=false` |
| Hardcoded maintainer email in User-Agent | Maintainer accountable for downstream abuse | Use project URL in User-Agent, not personal email |
| SSRF via user-supplied OL key in edit UI | User (or attacker) forces server to fetch arbitrary URLs | Validate keys match `^OL[0-9]+[WAM]$`; construct URLs server-side, never trust client-supplied URLs |

## UX Pitfalls (summary table)

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent re-enrichment overwriting edits | User loses trust, abandons manual fixes | Per-field provenance, manual wins |
| No confidence indicator on enrichment | User can't distinguish truth from guess | Confidence chip per field, visible in list and detail views |
| "Unknown" rebalanced out of reports | User draws wrong conclusions | Always show Unknown, always show coverage |
| Year selector defaults to UTC year | Off-by-one books at year boundaries | Use user's local TZ; document "reading counts for year Y" rule |
| One-at-a-time edit UI for hundreds of unmatched books | User gives up on fixing coverage | Bulk actions: retry, merge authors, override nationality |
| No way to tell why a book is in "2025 report" | User confusion ("I read this in 2024?") | Hoverable tooltip showing the reading session timestamps |

## "Looks Done But Isn't" Checklist

- [ ] **Enrichment service:** Works on `ISBN -> Edition -> Work` path — verify non-ISBN books (KOReader sidecar without ISBN) also resolve via title+author search
- [ ] **Backfill:** Completes on the maintainer's library — verify it also completes when 20% of books fail (poison-pill tolerant) and when OL is offline (circuit-broken, not wedged)
- [ ] **Genre mapping:** Whitelist covers common books — verify denylist filters `Accessible book`, `Protected DAISY`, `In library`, `Large type books` on every mapped book
- [ ] **Author dedup:** Works for clean data — verify `"Murakami, Haruki"` + `"Haruki Murakami"` + `"村上春樹"` collapse to one author when they share an OL key
- [ ] **Schema migration:** Runs clean on fresh DB — verify it also runs clean on a production-sized DB with existing books and page_stats (row counts unchanged after migration)
- [ ] **Reports:** Render for the current year — verify they render for a year with zero data (no crash), for a year with one book (no div-by-zero), and across DST transitions
- [ ] **Manual edit UI:** Single-field edit saves — verify re-enrichment doesn't clobber it on the next sync
- [ ] **Privacy:** OpenLibrary calls work — verify `ENRICHMENT_ENABLED=false` fully disables outbound calls; grep the codebase for any OL call that bypasses the flag
- [ ] **Provenance:** Edit UI shows `[OL]` / `[Manual]` chips — verify the chip is accurate after every state transition (fresh enrich, manual edit, reset-to-OL, re-enrich)
- [ ] **Timezone:** Year selector works for maintainer's TZ — verify a book read 23:00 local on Dec 31 in UTC+9 appears in the right year
- [ ] **Unknown bucket:** Present in nationality chart — verify it's present in genre, publication year, and any other aggregate chart too

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong author matches committed to DB | MEDIUM | Add `low_confidence` flag retroactively; run re-resolver with stricter match score; surface affected books in edit UI |
| Duplicate author rows from backfill race | MEDIUM | Admin query: group by `normalized_name`, present merge UI; repoint `book_author` FKs; delete losers |
| Whitelist missed a whole category | LOW | Update whitelist, bump version, re-map in place (raw subjects were stored); no OL re-fetch needed |
| Schema migration corrupted `book_author` via FK cascade | HIGH | Restore from DB backup; re-run migration with `transaction: false` and manual pragma; ops should enforce pre-migration backup |
| Backfill got rate-limited, 500 books marked failed | LOW | Reset `enrichment_status = 'pending' WHERE last_error LIKE '%429%'`; resume with tighter concurrency |
| Report showed wrong year due to TZ bug | LOW | Patch bucketing query; report is a live view so next load is correct; no data migration needed |
| Manual edits overwritten by enrichment | HIGH (if undetected), MEDIUM (if caught early) | If `book_edit_log` exists, replay manual edits. If not, ask user to redo. Ship provenance table before this ships. |
| OL outage during production backfill | LOW | Circuit breaker trips, backfill pauses; resume automatically when OL is back. No data loss if idempotent. |

## Pitfall-to-Phase Mapping

| Pitfall | Primary Phase | Verification |
|---------|---------------|--------------|
| A1 Wrong author matches | enrichment | Integration test: common-name author resolves same `OL...A` across 2+ books before committing nationality |
| A2 Work vs Edition subjects | enrichment | Unit test: Edition JSON fixture has empty subjects, Work JSON has them; resolver reads from Work |
| A3 Subject noise | enrichment | Test fixture with "Protected DAISY" + real genre; assert only real genre makes it through |
| A4 Nationality missing/ambiguous | enrichment + report | Coverage metric visible; "Unknown" bucket rendered in chart |
| A5 Stale records | enrichment | `last_enriched_at` persisted; re-fetch button in UI |
| A6 OL outage | backfill + ops | Kill-switch env var; circuit breaker test with mocked 5xx storm |
| A7 Rate limits | enrichment + backfill | User-Agent header verified; concurrency cap enforced; 429 test triggers backoff |
| A8 International titles | enrichment | Non-English fixture in test; per-language coverage in report |
| B1 Name normalization | schema + enrichment | Dedup test: 3 name variants + same OL key -> 1 row |
| B2 Translators misattributed | enrichment | Fixture: edition with translator; Work authors != Edition authors; assert Work wins |
| B3 Co-author strings | schema + enrichment | Junction table supports N; splitter test covers `;`, `&`, `and`, `Jr.` |
| B4 Pseudonyms/corporate | schema + edit-ui | `author.kind` column; non-persons excluded from nationality chart |
| B5 Duplicate author rows | schema + backfill | UNIQUE constraint; upsert atomic test under concurrency |
| C1 Whitelist drift | schema + edit-ui | Admin view of unmapped subjects; whitelist versioned |
| C2 Overlapping genres | schema + report | Hierarchy defined; primary-genre rule documented |
| C3 Format labels sneaking | enrichment | Denylist as explicit list; test coverage |
| C4 Non-English subjects | enrichment + report | Per-language coverage visible in report |
| D1 SQLite ALTER limits | schema | Migration test on seeded DB; row counts preserved |
| D2 Migration blocks boot | schema + backfill + ops | Migrations contain no network calls; backfill runs async |
| D3 FK cascade surprises | schema | Generated SQL audited; FK direction correct (RESTRICT for author_id) |
| D4 UNIQUE on nullable key | schema | Partial unique index; NULL-key dedup test |
| E1 No progress persistence | backfill | Kill test: interrupt backfill, resume, assert no double-work |
| E2 Unbounded concurrency | backfill + enrichment | Concurrency cap enforced; monitor `p-limit` queue depth |
| E3 Event loop starvation | backfill + ops | Sync latency unchanged during backfill (integration test) |
| E4 Poison pill | backfill + edit-ui | Max-attempts counter; failed bucket visible |
| E5 Silent junk match | enrichment + edit-ui | Match-score threshold; low-confidence surfaced in UI |
| F1 Year boundary/TZ | report | TZ parameter in query; test at year boundary |
| F2 Partial reads | report | "Finished" threshold configurable; two charts |
| F3 Co-author nationality inflation | schema + report | `is_primary` on book_author; documented counting rule |
| F4 Missing data skews % | report | Unknown bucket mandatory; coverage shown |
| F5 Retroactive reclassification | report | Coverage overlay on YoY trend |
| G1 Auto-enrich overwrites edits | schema + edit-ui + enrichment | Provenance table; manual-wins rule enforced in enricher |
| G2 Can't tell field source | edit-ui | Provenance chips on every field |
| G3 No undo | edit-ui + schema | `book_edit_log`; reset button per field |
| G4 No bulk ops | edit-ui | Filterable list + bulk actions |
| H1 Firewalled instances | ops + enrichment | Kill-switch; graceful degradation on outbound failure |
| H2 Title leakage | ops | README privacy note; prefer ISBN lookups |
| H3 Personal data | schema + edit-ui | ISO country codes only; no free-text nationality |
| H4 User-Agent leaking email | enrichment + ops | Project URL in UA, not email |

## Sources

- [OpenLibrary Issue #10851 — Inconsistent Author field across APIs](https://github.com/internetarchive/openlibrary/issues/10851)
- [OpenLibrary Issue #8144 — Author info missing from API](https://github.com/internetarchive/openlibrary/issues/8144)
- [OpenLibrary Issue #8534 — Rate Limiting Policy](https://github.com/internetarchive/openlibrary/issues/8534)
- [OpenLibrary Issue #10585 — Understanding API Rate Limits and Scaling](https://github.com/internetarchive/openlibrary/issues/10585)
- [OpenLibrary Issue #11611 — Rate limits calculated incorrectly](https://github.com/internetarchive/openlibrary/issues/11611)
- [OpenLibrary Issue #11587 — Search API errors](https://github.com/internetarchive/openlibrary/issues/11587)
- [OpenLibrary Blog: API Search.json Performance Tuning (Jan 2025)](https://blog.openlibrary.org/2025/01/16/api-search-json-performance-tuning/)
- [OpenLibrary Blog: Open Library in Every Language](https://blog.openlibrary.org/2021/11/05/open-library-in-every-language/)
- [OpenLibrary Read API](https://openlibrary.org/dev/docs/api/read)
- [OpenLibrary Search API](https://openlibrary.org/dev/docs/api/search)
- [OpenLibrary Authors API](https://openlibrary.org/dev/docs/api/authors)
- [OpenLibrary Using Subjects](https://openlibrary.org/tour/subjects)
- [OpenLibrary Subjects: Protected DAISY](https://openlibrary.org/subjects/protected_daisy)
- [OpenLibrary Subjects: Accessible book](https://openlibrary.org/subjects/accessible_book)
- [OpenLibrary Developer APIs](https://openlibrary.org/developers/api)
- [OpenLibrary Data Dumps](https://openlibrary.org/developers/dumps)
- [OpenLibrary Community Guidelines](https://openlibrary.org/community/guidelines)
- [OpenLibrary Server Status](https://openlibrary.org/status)
- [skeptric: What's in Open Library Data (dump analysis)](https://skeptric.com/openlibrary-exploration/)
- [Internet Archive Services Update 2024-10-21](https://blog.archive.org/2024/10/21/internet-archive-services-update-2024-10-21/)
- [BleepingComputer: Internet Archive hacked, data breach impacts 31M users](https://www.bleepingcomputer.com/news/security/internet-archive-hacked-data-breach-impacts-31-million-users/)
- [NPR: Internet Archive hack affects 31 million users](https://www.npr.org/2024/10/20/nx-s1-5159000/internet-archive-hack-leak-wayback-machine)
- [Knex Issue #4155 — FKs prevent table-altering migrations on SQLite](https://github.com/knex/knex/issues/4155)
- [Knex Issue #5367 — adding a column dropped original table](https://github.com/knex/knex/issues/5367)
- [Knex Issue #5172 — sqlite now supports dropping column](https://github.com/knex/knex/issues/5172)
- [Knex Issue #166 — sqlite onDelete CASCADE not working](https://github.com/knex/knex/issues/166)
- [Knex Issue #4250 — undefined ON DELETE](https://github.com/knex/knex/issues/4250)
- [Knex Issue #5787 — SQLite ALTER copies generated columns](https://github.com/knex/knex/issues/5787)
- [Knex Migrations Guide](https://knexjs.org/guide/migrations.html)
- [SQLite ALTER TABLE reference](https://sqlite.org/lang_altertable.html)
- [SYNKEE: Safely Modify SQLite Table Columns with Production Data](https://synkee.com.sg/blog/safely-modify-sqlite-table-columns-with-production-data/)
- [CockroachDB PR #147511 — memory leak in index backfill progress](https://github.com/cockroachdb/cockroach/pull/147511)
- [Empirical Study of Date and Time Bugs in Open-Source (MSR 2025)](https://rohan.padhye.org/files/datetimebugs-msr25.pdf)
- [PMC: What's in a name? Author name problems in research](https://pmc.ncbi.nlm.nih.gov/articles/PMC4910268/)
- [PMC: Scientific author names, errors, corrections, identity profiles](https://pmc.ncbi.nlm.nih.gov/articles/PMC4910270/)
- [Ex Libris Alma: The AI Metadata Assistant (provenance patterns)](https://knowledge.exlibrisgroup.com/Alma/Product_Documentation/010Alma_Online_Help_(English)/Metadata_Management/005Introduction_to_Metadata_Management/The_AI_Metadata_Assistant_in_the_Metadata_Editor)
- [Atlan: Metadata enrichment skips existing values](https://docs.atlan.com/product/capabilities/governance/context-agents-studio/faq/metadata-enrichment)

---
*Pitfalls research for: KoInsight book metadata enrichment + yearly reports milestone*
*Researched: 2026-04-23*
