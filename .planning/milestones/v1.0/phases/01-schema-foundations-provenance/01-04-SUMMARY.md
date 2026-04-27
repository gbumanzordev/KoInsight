---
phase: 01-schema-foundations-provenance
plan: 04
subsystem: db-migrations
tags: [schema, enrichment, sqlite, knex, partial-unique-index]
requires:
  - book.md5 column (existing, from 20250412161907)
provides:
  - enrichment_job table (SCHEMA-05)
  - enrichment_job_book_md5_open_unique partial index (SCHEMA-05 invariant)
  - enrichment_job_status_created_at_idx (worker polling index)
affects:
  - Phase 4 enrichment worker (consumes this table; can rely on INSERT failing on duplicate open jobs)
tech-stack:
  added: []
  patterns:
    - "Partial unique index via knex.raw (Knex builder has no WHERE clause on indexes)"
    - ".checkIn([...]) for status enum enforcement at DB layer"
    - "timestamps(true, true) for created_at/updated_at with defaults"
key-files:
  created:
    - apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts
  modified: []
decisions:
  - "status defaults to 'pending' so worker enqueue path can INSERT (book_md5) only"
  - "last_error is TEXT (no length cap) to accommodate stack traces"
  - "Partial unique scoped to open states only; terminal (succeeded/failed) rows accumulate as history, enabling re-enrichment"
  - "ON DELETE CASCADE on book_md5 FK: removing a book drops its job rows"
metrics:
  duration_minutes: 2
  completed_date: 2026-04-23
  tasks_completed: 1
  files_changed: 1
---

# Phase 1 Plan 04: Migration 2 — enrichment_job Table Summary

One-liner: enrichment_job table with status CHECK constraint and a partial unique index that enforces "at most one open job per book_md5" at the DB layer.

## What Was Built

Migration `20260423221500_create_enrichment_job.ts`:

- `enrichment_job` table with columns: `id` (PK), `book_md5` (32-char, FK to `book.md5` ON DELETE CASCADE), `status` (CHECK IN pending/running/succeeded/failed, default 'pending'), `attempts` (int, default 0), `last_error` (nullable text), `created_at`, `updated_at`.
- Composite index `enrichment_job_status_created_at_idx` on `(status, created_at)` for the Phase 4 worker's polling query.
- Partial unique index `enrichment_job_book_md5_open_unique` on `book_md5` WHERE `status IN ('pending','running')` — created via `knex.raw` because Knex's builder does not expose partial indexes.

## Verification Results

- `npm --workspace=server run knex migrate:latest` against a fresh DB: 17 migrations applied, exit 0.
- Smoke test 1 (duplicate open rejection): inserted a book with md5 `aaaa...` (32 chars), then one `(book_md5, status='pending')` row; the second identical insert failed with `SQLITE_CONSTRAINT: UNIQUE constraint failed` — invariant enforced.
- Smoke test 2 (terminal rows not blocked): inserted two `(book_md5, status='failed')` rows for the same book; both accepted — history semantics preserved.
- SCHEMA-07 greps: `fetch(|axios|https://` empty, `\.forEach|for \(.*book\b|while \(` empty.
- `prettier --check`: clean.

## Commits

- `bd71f6a` feat(01-04): create enrichment_job table with partial unique index

## Deviations from Plan

None substantive. The plan's verify snippet referenced `data/dev.db`; the project's actual dev DB path is `data/dev.sqlite3` (per `apps/server/src/config.ts`). Used the correct path when running the smoke-check. No code change required.

## Known Stubs

None. Pure DDL migration; no runtime code paths touched.

## Threat Mitigations Applied

- T-01-07 (Tampering on status): `checkIn(['pending','running','succeeded','failed'])` enforces the union at the DB layer.
- T-01-08 (DoS via duplicate open jobs): partial unique index rejects a second open row for the same `book_md5`; Phase 4 enqueue can rely on this at the DB layer rather than in application code.

## Self-Check: PASSED

- File exists: apps/server/src/db/migrations/20260423221500_create_enrichment_job.ts — FOUND
- Commit exists: bd71f6a — FOUND
- Migration runs clean on fresh DB — verified
- Partial unique index rejects duplicate open jobs — verified
- Terminal rows not blocked by unique index — verified
