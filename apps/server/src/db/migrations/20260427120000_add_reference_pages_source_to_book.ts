import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    // D-01: NULL = "never touched by provenance-aware write" (mirrors D-14 from Phase 1).
    // D-02: no retroactive backfill of this column. Existing rows with non-null
    // reference_pages keep reference_pages_source = NULL, which makes them
    // enrichment-writable under the universal D-20 semantics.
    table.string('reference_pages_source').nullable().checkIn(['openlibrary', 'manual']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.dropColumn('reference_pages_source');
  });
}
