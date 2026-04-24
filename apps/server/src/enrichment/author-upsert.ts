import type { Knex } from 'knex';

// Phase 5 Plan 01: extracted from applier.ts so the new books-service
// applyManualEdit path can reuse the OL-key-then-name-match upsert. The
// `source` parameter generalizes the previously hard-coded 'openlibrary'
// literal so manual edits stamp nationality_source='manual' and trigger the
// per-author manual-wins gate (D-04 in CONTEXT.md, D-19 step 1+2 in Phase 4).

export interface EnrichedAuthor {
  name: string;
  openlibrary_key: string | null;
  nationality: string | null; // ISO 3166-1 alpha-2 or null
}

export type AuthorSource = 'openlibrary' | 'manual';

export function normalizeAuthorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function upsertAuthor(
  trx: Knex.Transaction,
  a: EnrichedAuthor,
  source: AuthorSource = 'openlibrary'
): Promise<number> {
  // D-19 step 1: match by OL key.
  if (a.openlibrary_key) {
    const existing = await trx('author').where({ openlibrary_key: a.openlibrary_key }).first();
    if (existing) {
      // D-20 at the author level: only touch nationality when the existing
      // source is NULL or 'openlibrary'. Manual overrides stick.
      if (existing.nationality_source === null || existing.nationality_source === 'openlibrary') {
        await trx('author').where({ id: existing.id }).update({
          nationality: a.nationality,
          nationality_source: source,
        });
      }
      return existing.id;
    }
  }

  // D-19 step 2: match by normalized name with NULL OL key.
  const normKey = normalizeAuthorName(a.name);
  const byName = await trx('author')
    .whereRaw('LOWER(TRIM(name)) = ?', [normKey])
    .whereNull('openlibrary_key')
    .first();
  if (byName) {
    const update: Record<string, unknown> = {
      openlibrary_key: a.openlibrary_key,
    };
    if (byName.nationality_source === null || byName.nationality_source === 'openlibrary') {
      update.nationality = a.nationality;
      update.nationality_source = source;
    }
    await trx('author').where({ id: byName.id }).update(update);
    return byName.id;
  }

  // D-19 step 3: insert new row. Per WD-04, even NULL nationality is stamped
  // with the calling source because we attempted the lookup.
  const [inserted] = await trx('author')
    .insert({
      name: a.name,
      openlibrary_key: a.openlibrary_key,
      nationality: a.nationality,
      nationality_source: source,
    })
    .returning('id');
  return typeof inserted === 'object' ? inserted.id : inserted;
}
