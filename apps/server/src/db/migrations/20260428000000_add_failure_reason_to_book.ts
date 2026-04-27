import type { Knex } from 'knex';

// D-01 / D-04: failure_reason persists the structured reason for the
// most recent enrichment failure on the book row (mirrors v1.0 *_source
// provenance pattern). Legacy already-failed rows (the 8 referenced in
// the Phase 8 goal) stay NULL after migration; the inbox UI renders
// them as 'unknown' (gray outline badge per UI-SPEC). Reclassification
// happens naturally on next retry, no backfill task.
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table
      .string('failure_reason')
      .nullable()
      .checkIn(['no_match', 'ambiguous_match', 'network', 'parse_error']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('book', (table) => {
    table.dropColumn('failure_reason');
  });
}
