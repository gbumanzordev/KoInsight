import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    // SCHEMA-04: enrichment_status with CHECK; default 'pending' so existing rows backfill (D-13).
    table
      .string('enrichment_status')
      .notNullable()
      .defaultTo('pending')
      .checkIn(['pending', 'running', 'enriched', 'failed', 'skipped']);

    // SCHEMA-04: nullable enrichment fields, no default, no backfill (D-16).
    table.string('openlibrary_work_key').nullable();
    table.smallint('publication_year').nullable();
    table.string('original_language', 2).nullable(); // ISO 639-1

    // D-14: four *_source columns, NULL = "never touched by provenance-aware write".
    // CHECK constraint on the non-null domain {openlibrary, manual}.
    table.string('authors_source').nullable().checkIn(['openlibrary', 'manual']);
    table.string('genres_source').nullable().checkIn(['openlibrary', 'manual']);
    table.string('publication_year_source').nullable().checkIn(['openlibrary', 'manual']);
    table.string('original_language_source').nullable().checkIn(['openlibrary', 'manual']);

    // SCHEMA-03 invariant: book.authors is NOT touched here. The column already exists
    // from create_book_table; we leave it as the denormalized display cache that the
    // KOReader plugin populates. No alter, no rename, no drop.
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.dropColumn('original_language_source');
    table.dropColumn('publication_year_source');
    table.dropColumn('genres_source');
    table.dropColumn('authors_source');
    table.dropColumn('original_language');
    table.dropColumn('publication_year');
    table.dropColumn('openlibrary_work_key');
    table.dropColumn('enrichment_status');
  });
}
