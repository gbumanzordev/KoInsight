import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('enrichment_job', (table) => {
    table.increments('id').primary();
    table.string('book_md5', 32).notNullable();
    table
      .string('status')
      .notNullable()
      .defaultTo('pending')
      .checkIn(['pending', 'running', 'succeeded', 'failed']);
    table.integer('attempts').notNullable().defaultTo(0);
    table.text('last_error').nullable();
    table.timestamps(true, true); // created_at + updated_at

    table.foreign('book_md5').references('book.md5').onDelete('CASCADE');

    // Index for the worker's polling query (status='pending' ORDER BY created_at)
    table.index(['status', 'created_at'], 'enrichment_job_status_created_at_idx');
  });

  // SCHEMA-05: partial unique index enforcing "at most one OPEN job per book_md5".
  // Open = status IN ('pending', 'running'). Terminal jobs (succeeded/failed) are history; multiple allowed.
  await knex.raw(
    "CREATE UNIQUE INDEX enrichment_job_book_md5_open_unique ON enrichment_job (book_md5) WHERE status IN ('pending', 'running')"
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS enrichment_job_book_md5_open_unique');
  await knex.schema.dropTableIfExists('enrichment_job');
}
