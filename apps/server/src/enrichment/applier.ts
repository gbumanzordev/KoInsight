import type { Knex } from 'knex';
import { mapOpenLibrarySubjects } from '@koinsight/common/dist/genres/map.js';
import { truncateError } from './retry';

// Phase 4 Plan 04: transactional writer.
// D-18 all-or-nothing apply, D-19 author upsert three-step, D-20 per-field
// provenance guards, SC-3 idempotency, SC-4 manual-wins, SC-5 terminal failure.
// No HTTP in this file; see phase-04-no-direct-http.test.ts.

export interface EnrichedAuthor {
  name: string;
  openlibrary_key: string | null;
  nationality: string | null; // ISO 3166-1 alpha-2 or null
}

export interface EnrichedBundle {
  workKey: string;
  publicationYear: number | null;
  originalLanguage: string | null; // ISO 639-1 or null
  authors: EnrichedAuthor[];
  subjects: string[];
}

type FieldSource = 'openlibrary' | 'manual' | null;

interface BookSourceRow {
  authors_source: FieldSource;
  genres_source: FieldSource;
  publication_year_source: FieldSource;
  original_language_source: FieldSource;
}

function normalizeAuthorName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function upsertAuthor(trx: Knex.Transaction, a: EnrichedAuthor): Promise<number> {
  // D-19 step 1: match by OL key.
  if (a.openlibrary_key) {
    const existing = await trx('author').where({ openlibrary_key: a.openlibrary_key }).first();
    if (existing) {
      // Mirror D-20 at the author level: only touch nationality when the
      // source is NULL or 'openlibrary'. Manual overrides stick.
      if (existing.nationality_source === null || existing.nationality_source === 'openlibrary') {
        await trx('author').where({ id: existing.id }).update({
          nationality: a.nationality,
          nationality_source: 'openlibrary',
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
    await trx('author').where({ id: byName.id }).update({
      openlibrary_key: a.openlibrary_key,
      nationality: a.nationality,
      nationality_source: 'openlibrary',
    });
    return byName.id;
  }

  // D-19 step 3: insert new row. Per WD-04, even NULL nationality is stamped
  // with source='openlibrary' because we attempted the lookup.
  const [inserted] = await trx('author')
    .insert({
      name: a.name,
      openlibrary_key: a.openlibrary_key,
      nationality: a.nationality,
      nationality_source: 'openlibrary',
    })
    .returning('id');
  return typeof inserted === 'object' ? inserted.id : inserted;
}

export async function applyEnrichment(
  knex: Knex,
  bookMd5: string,
  jobId: number,
  bundle: EnrichedBundle
): Promise<void> {
  await knex.transaction(async (trx) => {
    const book = (await trx('book')
      .where({ md5: bookMd5 })
      .select(
        'authors_source',
        'genres_source',
        'publication_year_source',
        'original_language_source'
      )
      .first()) as BookSourceRow | undefined;
    if (!book) {
      throw new Error(`applyEnrichment: book ${bookMd5} not found`);
    }

    // D-19 author upsert in bundle order.
    const authorIds: number[] = [];
    for (const a of bundle.authors) {
      const id = await upsertAuthor(trx, a);
      authorIds.push(id);
    }

    // D-18 step 2: book_author rewrite, column-level manual gate.
    if (book.authors_source !== 'manual') {
      await trx('book_author').where({ book_md5: bookMd5 }).delete();
      if (authorIds.length > 0) {
        await trx('book_author').insert(
          authorIds.map((author_id, position) => ({
            book_md5: bookMd5,
            author_id,
            position,
            role: 'author',
          }))
        );
      }
    }

    // D-18 step 3: book_genre rewrite via mapOpenLibrarySubjects.
    if (book.genres_source !== 'manual') {
      const canonicalNames = mapOpenLibrarySubjects(bundle.subjects);
      const genreRows =
        canonicalNames.length > 0
          ? await trx('genre').whereIn('name', canonicalNames).select('id')
          : [];
      await trx('book_genre').where({ book_md5: bookMd5 }).delete();
      if (genreRows.length > 0) {
        await trx('book_genre').insert(
          genreRows.map((g) => ({ book_md5: bookMd5, genre_id: g.id }))
        );
      }
    }

    // D-18 step 4: per-column book update with provenance guards (D-20).
    // openlibrary_work_key has no *_source column per 01-VERIFICATION; treat
    // as always-writable (provenance-free identifier).
    const updates: Record<string, unknown> = {
      openlibrary_work_key: bundle.workKey,
      enrichment_status: 'enriched',
    };
    if (book.publication_year_source !== 'manual') {
      updates.publication_year = bundle.publicationYear;
      updates.publication_year_source = 'openlibrary';
    }
    if (book.original_language_source !== 'manual') {
      updates.original_language = bundle.originalLanguage;
      updates.original_language_source = 'openlibrary';
    }
    if (book.authors_source !== 'manual') {
      updates.authors_source = 'openlibrary';
    }
    if (book.genres_source !== 'manual') {
      updates.genres_source = 'openlibrary';
    }
    await trx('book').where({ md5: bookMd5 }).update(updates);

    // D-18 step 6: flip the claimed job to succeeded.
    await trx('enrichment_job')
      .where({ id: jobId })
      .update({ status: 'succeeded', updated_at: trx.fn.now() });
  });
}

export async function markTerminalFailure(
  knex: Knex,
  jobId: number,
  bookMd5: string,
  error: unknown
): Promise<void> {
  const rawMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : String(error);
  const lastError = truncateError(rawMessage);

  await knex.transaction(async (trx) => {
    await trx('enrichment_job').where({ id: jobId }).update({
      status: 'failed',
      last_error: lastError,
      updated_at: trx.fn.now(),
    });
    await trx('book').where({ md5: bookMd5 }).update({ enrichment_status: 'failed' });
  });
}
