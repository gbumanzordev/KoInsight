import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // SCHEMA-01: author entity table
  await knex.schema.createTable('author', (table) => {
    table.increments('id').primary();
    table.string('name').notNullable();
    table.string('openlibrary_key').nullable();
    table.string('wikidata_qid').nullable();
    table.string('nationality', 2).nullable(); // ISO 3166-1 alpha-2
    table.string('nationality_source').nullable().checkIn(['openlibrary', 'manual']);
    table.text('bio').nullable();
    table.timestamps(true, true); // created_at + updated_at with defaults

    table.unique(['name']); // D-08: schema-level UNIQUE(name)
  });

  // D-11: partial unique index on openlibrary_key WHERE openlibrary_key IS NOT NULL.
  // Knex builder does not expose partial indexes; use raw SQL (SQLite supports this).
  await knex.raw(
    'CREATE UNIQUE INDEX author_openlibrary_key_unique ON author (openlibrary_key) WHERE openlibrary_key IS NOT NULL'
  );

  // SCHEMA-02: book_author junction
  await knex.schema.createTable('book_author', (table) => {
    table.increments('id').primary();
    table.string('book_md5', 32).notNullable();
    table.integer('author_id').notNullable();
    table.integer('position').notNullable(); // 0 = primary
    table.string('role').notNullable().defaultTo('author').checkIn(['author', 'editor']);

    table.foreign('book_md5').references('book.md5').onDelete('CASCADE');
    table.foreign('author_id').references('author.id').onDelete('CASCADE');

    // A given (book, position) pair is unique; no two co-authors at the same slot
    table.unique(['book_md5', 'position']);
    // A given (book, author) pair is unique; same author cannot appear twice on a book
    table.unique(['book_md5', 'author_id']);

    // Index for the inverse lookup (author to books) used by Phase 6 reports
    table.index(['author_id', 'book_md5'], 'book_author_author_id_book_md5_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('book_author');
  await knex.raw('DROP INDEX IF EXISTS author_openlibrary_key_unique');
  await knex.schema.dropTableIfExists('author');
}
