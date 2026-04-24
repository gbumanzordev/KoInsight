import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('enrichment_job', (table) => {
    // D-13: nullable timestamp for retry scheduling. SQLite stores as TEXT (ISO-8601),
    // which preserves correct lexicographic ordering for the worker's polling query.
    table.timestamp('next_attempt_at').nullable();
    // Composite index supporting "WHERE status = ? AND next_attempt_at <= ?" polling.
    table.index(['status', 'next_attempt_at'], 'enrichment_job_status_next_attempt_at_idx');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('enrichment_job', (table) => {
    table.dropIndex(['status', 'next_attempt_at'], 'enrichment_job_status_next_attempt_at_idx');
    table.dropColumn('next_attempt_at');
  });
}
