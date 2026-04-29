import type { Knex } from 'knex';

// Phase 9 Plan 01 (AUTHGC-01 + AUTHGC-02 + AUTHGC-03): shared core function
// for deleting authors that are not referenced by any book_author row.
//
// Predicate (D-06): id NOT IN (SELECT DISTINCT author_id FROM book_author),
// implemented via Knex builder (whereNotIn) to avoid hand-rolled SQL.
//
// Transaction semantics (D-05): the delete path runs the SELECT and DELETE
// inside a single db.transaction so a mid-flight failure rolls back. The
// dry-run path opens no transaction and performs only the SELECT.
//
// Sample (D-06): up to 20 rows ordered by author.id (deterministic across
// runs and engines). Sample is [] when nothing is deleted.
//
// This module is consumed by Plan 02 (HTTP route) and Plan 03 (CLI). It does
// not import the shared `db` instance so callers can inject any Knex.

export type OrphanAuthorGcResult = {
  deleted: number;
  sample: Array<{ id: number; name: string }>;
};

const SAMPLE_CAP = 20;

type AuthorRow = { id: number; name: string };

// SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999. Using
// `whereIn('id', orphanIds)` over the full orphan set would fail on large
// churn. Re-running the `whereNotIn(book_author)` predicate directly inside
// the DELETE keeps the statement O(1) in bind variables and avoids loading
// every id into memory.
export async function deleteOrphanAuthors(
  db: Knex,
  opts: { dryRun: boolean }
): Promise<OrphanAuthorGcResult> {
  if (opts.dryRun) {
    const sample = await db<AuthorRow>('author')
      .select('id', 'name')
      .whereNotIn('id', db('book_author').distinct('author_id'))
      .orderBy('id')
      .limit(SAMPLE_CAP);

    const countRow = await db('author')
      .whereNotIn('id', db('book_author').distinct('author_id'))
      .count<Array<{ count: string | number }>>({ count: '*' })
      .first();

    return {
      deleted: countRow ? Number(countRow.count) : 0,
      sample,
    };
  }

  return db.transaction(async (trx) => {
    const sample = await trx<AuthorRow>('author')
      .select('id', 'name')
      .whereNotIn('id', trx('book_author').distinct('author_id'))
      .orderBy('id')
      .limit(SAMPLE_CAP);

    const deleted = await trx('author')
      .whereNotIn('id', trx('book_author').distinct('author_id'))
      .delete();

    return {
      deleted,
      sample: deleted === 0 ? [] : sample,
    };
  });
}
