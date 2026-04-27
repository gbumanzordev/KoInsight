import type { Knex } from 'knex';
// Rule 3 deviation from plan 02-03 acceptance: the planned import path
// '@koinsight/common/genres' cannot be resolved by Node's CJS require at runtime.
// The compiled migration is CommonJS (tsconfig.migrations.json) but @koinsight/common
// is `"type": "module"` with no package.json `exports` map and no emitted index.js
// at its root. CJS resolution of 'genres' subpath has nothing to land on.
// Using the explicit compiled-dist subpath works for CJS require without touching
// the shared package boundary. See 02-03-SUMMARY.md §Deviations.
import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';

// SCHEMA-06 seed. Per CONTEXT D-18 and D-20: INSERT OR IGNORE over the literal
// CANONICAL_GENRES list. Re-running the migration (after rollback or via direct
// up() invocation) is a no-op at the SQL level because the `name` UNIQUE constraint
// triggers ON CONFLICT DO NOTHING for every row already present. This preserves:
//   - user-edited genre rows (they are never deleted or renamed)
//   - existing book_genre FKs (the referenced genre.id values are never recycled)
//
// Not a data migration over book: this only writes to `genre` and obeys SCHEMA-07
// (no network, no per-book iteration).
export async function up(knex: Knex): Promise<void> {
  const rows = CANONICAL_GENRES.map((name) => ({ name }));
  await knex('genre').insert(rows).onConflict('name').ignore();
}

// Non-destructive down. CONTEXT D-20 explicitly forbids DELETE+INSERT here because
// user-added book_genre rows may reference these genre ids. If a developer needs to
// roll this seed back they must do so manually (e.g., DELETE FROM genre WHERE name IN
// (...) AND NOT EXISTS (SELECT 1 FROM book_genre WHERE book_genre.genre_id = genre.id)).
export async function down(_knex: Knex): Promise<void> {
  // Intentional no-op.
}
