import type { Knex } from 'knex';

// Phase 6 Plan 01 (REPORT-04 + CONTEXT D-10): the yearly report aggregates
// page_stat by start_time bucketed into year boundaries. A non-unique covering
// index on page_stat(start_time) makes the year-range scan cheap without any
// summary tables (per D-10: aggregations run on demand via SQL).
//
// Note: book_author(author_id, book_md5) is NOT recreated here. Phase 1's
// migration 20260423221400_create_author_and_book_author already adds that
// composite index (per RESEARCH and CONTEXT). This migration only adds the
// page_stat index.
//
// Structure-only per SCHEMA-07: no data, no network, no row iteration.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('page_stat', (table) => {
    table.index(['start_time'], 'idx_page_stat_start_time');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('page_stat', (table) => {
    table.dropIndex(['start_time'], 'idx_page_stat_start_time');
  });
}
