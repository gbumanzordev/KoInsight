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
// Sample (D-06): the first 20 captured rows by query order are returned;
// sample is [] when nothing is deleted.
//
// This module is consumed by Plan 02 (HTTP route) and Plan 03 (CLI). It does
// not import the shared `db` instance so callers can inject any Knex.

export type OrphanAuthorGcResult = {
  deleted: number;
  sample: Array<{ id: number; name: string }>;
};

const SAMPLE_CAP = 20;

export async function deleteOrphanAuthors(
  db: Knex,
  opts: { dryRun: boolean }
): Promise<OrphanAuthorGcResult> {
  if (opts.dryRun) {
    const orphans = await db<{ id: number; name: string }>('author')
      .select('id', 'name')
      .whereNotIn('id', db('book_author').distinct('author_id'));

    return {
      deleted: orphans.length,
      sample: orphans.slice(0, SAMPLE_CAP),
    };
  }

  return db.transaction(async (trx) => {
    const orphans = await trx<{ id: number; name: string }>('author')
      .select('id', 'name')
      .whereNotIn('id', trx('book_author').distinct('author_id'));

    if (orphans.length === 0) {
      return { deleted: 0, sample: [] };
    }

    await trx('author')
      .whereIn(
        'id',
        orphans.map((o) => o.id)
      )
      .delete();

    return {
      deleted: orphans.length,
      sample: orphans.slice(0, SAMPLE_CAP),
    };
  });
}
