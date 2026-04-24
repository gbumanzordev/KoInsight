import type { Knex } from 'knex';

// Phase 5 Plan 01 (research A1): Phase 1's extend_book_columns migration added
// the enrichment_status column with a CHECK constraint but did NOT create an
// index on it. Plan 03 (enrichment router) needs efficient GROUP BY status and
// WHERE status='failed' queries. This migration is structure-only (no data,
// no network) preserving the SCHEMA-07 invariant.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.index(['enrichment_status'], 'idx_book_enrichment_status');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.dropIndex(['enrichment_status'], 'idx_book_enrichment_status');
  });
}
