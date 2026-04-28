import type { Knex } from 'knex';
import { db } from '../knex';
import { openLibraryClient } from '../open-library/open-library-client';

// Phase 7 Plan 04 (REFPAGES-02 + D-09 option b): one-shot backfill that
// populates `book.reference_pages` for already-enriched v1.0 books that
// missed the page count because Phase 4 never read it. Operator-triggered
// via `npm --workspace=server run backfill:reference-pages`.
//
// Predicate (D-08): only books that are enriched, have no page count yet,
// were not manually edited, and have a known work key.
//
// Per-row flow (D-09): work key -> getWorkEditions -> first edition ->
// getEdition -> number_of_pages. Both fetches go through the shared
// rate limiter (1 req/s) inside openLibraryClient.
//
// D-10: errored rows do NOT flip enrichment_status (the row stays
// "enriched", just without page count). The script counts the error and
// continues to the next row. CLI exit is always 0.
//
// D-11: idempotent on re-run. Books populated in a prior run are excluded
// by the source != 'manual' AND reference_pages IS NULL predicate.

export type BackfillSummary = {
  scanned: number;
  populated: number;
  no_pages: number;
  errored: number;
};

type Candidate = { md5: string; openlibrary_work_key: string };

export async function runReferencePagesBackfill(knex: Knex): Promise<BackfillSummary> {
  const summary: BackfillSummary = { scanned: 0, populated: 0, no_pages: 0, errored: 0 };

  const candidates = await knex<{ md5: string; openlibrary_work_key: string }>('book')
    .select('md5', 'openlibrary_work_key')
    .where({ enrichment_status: 'enriched' })
    .whereNull('reference_pages')
    .whereNotNull('openlibrary_work_key')
    .andWhere((qb) => {
      qb.whereNull('reference_pages_source').orWhere('reference_pages_source', '<>', 'manual');
    });

  for (const candidate of candidates as Candidate[]) {
    summary.scanned += 1;
    try {
      const editions = await openLibraryClient.getWorkEditions(candidate.openlibrary_work_key);
      const firstKey = editions.entries[0]?.key;
      if (!firstKey) {
        console.log(
          `backfill:reference-pages: no editions for work ${candidate.openlibrary_work_key} (md5=${candidate.md5})`
        );
        summary.no_pages += 1;
        continue;
      }

      const edition = await openLibraryClient.getEdition(firstKey);
      const pages = edition.number_of_pages;
      if (typeof pages !== 'number' || pages <= 0) {
        console.log(
          `backfill:reference-pages: edition ${firstKey} has no number_of_pages (md5=${candidate.md5})`
        );
        summary.no_pages += 1;
        continue;
      }

      await knex('book').where({ md5: candidate.md5 }).update({
        reference_pages: pages,
        reference_pages_source: 'openlibrary',
      });
      summary.populated += 1;
    } catch (error) {
      // D-10: log + count, do NOT flip enrichment_status, continue.
      console.warn(
        `backfill:reference-pages: error for md5=${candidate.md5} work=${candidate.openlibrary_work_key}:`,
        error instanceof Error ? error.message : error
      );
      summary.errored += 1;
    }
  }

  return summary;
}

// CLI entry: only runs when the file is invoked directly via `tsx`.
// Skipped when imported by tests.
const invokedPath = process.argv[1] ?? '';
if (
  invokedPath.endsWith('backfill-reference-pages.ts') ||
  invokedPath.endsWith('backfill-reference-pages.js')
) {
  void (async () => {
    const summary = await runReferencePagesBackfill(db);
    console.log('backfill:reference-pages complete', summary);
    await db.destroy();
  })();
}
