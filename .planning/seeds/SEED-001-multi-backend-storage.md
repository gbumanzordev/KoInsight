---
id: SEED-001
status: dormant
planted: 2026-04-29
planted_during: v1.1 Enrichment Polish & Cleanup (after Phase 9 ship)
trigger_when: v1.1 milestone archived (Phase 10 Repo Polish complete)
scope: Large
---

# SEED-001: v1.2 Multi-backend storage (Turso → Postgres)

## Why This Matters

KoInsight today is local-first by design: one SQLite file under `DATA_PATH`, single Express container, one port, single user. That shape is great for self-hosters with a NAS or VPS, but it caps what the project can be: a personal-only dashboard, not a hostable alternative someone could spin up for a community of readers.

Two cheap moves unlock the broader posture without sacrificing the local-first experience:

1. **Turso/libSQL as the primary store.** libSQL is SQLite-compatible at the SQL level, so the existing Knex queries port unchanged. Turso adds embedded replicas (local-fast reads + cloud sync) and a real hosted tier. Solo self-host stays single-file-fast; a hosted instance becomes a real option.
2. **Postgres as a second supported backend.** Behind the same Knex layer, with `pg-mem` or testcontainers for the test suite. Unlocks Fly Postgres / Supabase / Neon / Railway as deploy targets and removes the SQLite-only ceiling for any future multi-tenant work.

The KOReader plugin upload format is locked to SQLite (the device produces `statistics.sqlite`), so `better-sqlite3` stays a dependency for `upload-service.ts` parsing — but it's decoupled from the primary store.

## When to Surface

**Trigger:** v1.1 milestone archived (Phase 10 Repo Polish complete and `/gsd-complete-milestone` run).

This seed should be presented during `/gsd-new-milestone` when the new milestone scope mentions any of:

- "deploy", "hosting", "SaaS", "multi-user", "cloud"
- "Turso", "libSQL", "Postgres", "Postgresql", "database backend"
- "v1.2" or any milestone framed around opening KoInsight to non-self-hosters

If the next milestone is purely UI/UX or feature work, this seed should stay dormant.

## Scope Estimate

**Large** — Two-phase milestone, ~1.5 weeks total:

### Phase A — Turso/libSQL primary store (~1-2 days)

Knex client swap is the bulk of the work. Specific changes:

- Replace `client: 'better-sqlite3'` with `@libsql/knex-libsql` in `apps/server/src/knexfile.ts`.
- Add `LIBSQL_URL` / `LIBSQL_AUTH_TOKEN` to `apps/server/src/config.ts` and `turbo.json` `globalEnv`.
- Audit the 3 migrations that use `knex.raw` for partial UNIQUE indexes — libSQL accepts SQLite syntax, expected to be drop-in:
  - `apps/server/src/db/migrations/20251230000001_add_annotation_soft_delete.ts`
  - `apps/server/src/db/migrations/20260423221400_create_author_and_book_author.ts`
  - `apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts`
- `INSERT OR IGNORE` in `20260424090000_seed_canonical_genres.ts` — already SQLite-compatible.
- `strftime('%Y', start_time, 'unixepoch')` in `apps/server/src/reports/reports-repository.ts:28` — works on libSQL unchanged.
- Test setup `PRAGMA foreign_keys = OFF` in `apps/server/test/setup/test-setup.ts` — works on libSQL.
- Keep `better-sqlite3` only for `apps/server/src/upload/upload-service.ts` parsing the KOReader-uploaded `statistics.sqlite`.
- Document embedded-replica mode for solo self-host (`local.db` syncs to Turso cloud).

### Phase B — Postgres backend (~1 week)

Behind the same Knex layer, gated by a `DB_DIALECT=pg|sqlite|libsql` config switch.

- Port `strftime('%Y', start_time, 'unixepoch')` to `EXTRACT(YEAR FROM to_timestamp(start_time))` via a small dialect adapter in `reports-repository.ts`.
- Audit partial UNIQUE index syntax — Postgres uses `CREATE UNIQUE INDEX ... WHERE ...` (close to SQLite); rewrite the 3 raw-SQL migrations to dispatch on dialect.
- `ON CONFLICT DO NOTHING` already portable.
- Boolean coercion audit: SQLite stores 0/1, PG stores `true`/`false`. Knex coerces via `.boolean()` columns — sweep for explicit `=== 1` / `=== 0` comparisons.
- Test infra: replace shared `:memory:` SQLite with `pg-mem` per-worker schemas, OR per-worker testcontainer Postgres. Default to `pg-mem` for speed (run sqlite + pg suites in CI).
- `SET session_replication_role = 'replica'` replacement for `PRAGMA foreign_keys = OFF` in `test-setup.ts`.

## Breadcrumbs

Files that will be touched (all confirmed to exist as of 2026-04-29):

**Config / wiring:**

- `apps/server/src/knexfile.ts` — single client switch
- `apps/server/src/knex.ts` — db singleton
- `apps/server/src/config.ts` — `LIBSQL_URL`, `LIBSQL_AUTH_TOKEN`, `DB_DIALECT`
- `turbo.json` — globalEnv

**Dialect-sensitive code:**

- `apps/server/src/reports/reports-repository.ts:28` — `strftime` call
- `apps/server/src/db/migrations/20251230000001_add_annotation_soft_delete.ts` — raw partial index
- `apps/server/src/db/migrations/20260423221400_create_author_and_book_author.ts` — raw partial index
- `apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts` — raw partial index
- `apps/server/src/db/migrations/20260424090000_seed_canonical_genres.ts` — `INSERT OR IGNORE`
- `apps/server/src/enrichment/service.ts` — `ON CONFLICT DO NOTHING` (already portable)
- `apps/server/src/enrichment/backfill.ts` — `ON CONFLICT DO NOTHING` (already portable)

**Tests:**

- `apps/server/test/setup/test-setup.ts` — `PRAGMA foreign_keys`, `truncate` strategy
- `apps/server/vitest.config.ts` — may need per-worker DB isolation for pg-mem
- `apps/server/src/db/migrations/__tests__/phase-06-schema.test.ts` — uses libSQL/SQLite-specific `PRAGMA index_list`

**Stays SQLite-only (intentional):**

- `apps/server/src/upload/upload-service.ts` — parses KOReader's `statistics.sqlite` upload via `better-sqlite3`. Don't decouple this; the upload format is locked by the KOReader plugin.

## Notes

- Discussion that produced this seed: post-PR-#3 conversation on 2026-04-29 about deployment targets. User asked "how hard would it be to turn this into a broader alternative that hosts in turso/postgres?" Estimate given: Turso ~1-2 days, Postgres ~1-2 weeks.
- v1.1 (Enrichment Polish & Cleanup) had Phases 7-10 with Phase 10 (Repo Polish, POLISH-02 + POLISH-03) still pending at planting time. Do not surface this seed before Phase 10 ships.
- If the user picks Turso-only and skips Postgres, Phase B can be reframed as a separate v1.3 seed rather than blocking the v1.2 milestone close.
- Open question for the v1.2 spec: does the hosted SaaS shape require multi-user / row-level tenancy, or stay single-user-per-instance? That answer determines whether v1.2 is purely a backend swap or a deeper rewrite.
