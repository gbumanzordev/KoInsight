import { beforeEach, describe, expect, it } from 'vitest';
import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';
import { createBook } from '../../db/factories/book-factory';
import { applyEnrichment, type EnrichedBundle } from '../../enrichment/applier';
import { db } from '../../knex';
import { applyManualEdit } from '../books-service';

// Phase 5 Plan 01 SC-2: end-to-end manual-wins stickiness.
// After a PATCH-equivalent applyManualEdit, a fresh applyEnrichment run must
// NOT overwrite any manual field. The Phase 4 applier's D-20 provenance guard
// is the enforcement mechanism; this test proves the two halves (Phase 5
// writer + Phase 4 applier) integrate correctly.

const MD5 = 'a'.repeat(32);

async function seedGenres(): Promise<void> {
  await db('genre')
    .insert(CANONICAL_GENRES.map((name) => ({ name })))
    .onConflict('name')
    .ignore();
}

async function openJob(bookMd5: string): Promise<number> {
  const [row] = await db('enrichment_job')
    .insert({ book_md5: bookMd5, status: 'running' })
    .returning('id');
  return typeof row === 'object' ? row.id : row;
}

describe('manual-edit stickiness (SC-2)', () => {
  beforeEach(async () => {
    await seedGenres();
  });

  it('applyManualEdit stamps *_source=manual for every touched field', async () => {
    const book = await createBook(db, { md5: MD5, enrichment_status: 'pending' });

    await applyManualEdit(book, {
      authors: [{ name: 'Manual Author', openlibrary_key: null, nationality: null }],
      genres: ['Science Fiction'],
      publication_year: 1953,
      original_language: 'en',
    });

    const fresh = await db('book').where({ md5: MD5 }).first();
    expect(fresh.authors_source).toBe('manual');
    expect(fresh.genres_source).toBe('manual');
    expect(fresh.publication_year_source).toBe('manual');
    expect(fresh.original_language_source).toBe('manual');
    expect(fresh.publication_year).toBe(1953);
    expect(fresh.original_language).toBe('en');
    expect(fresh.authors).toBe('Manual Author');
  });

  it('applyEnrichment does NOT overwrite manual fields after applyManualEdit', async () => {
    const book = await createBook(db, { md5: MD5, enrichment_status: 'pending' });

    // Step 1: user edits every field manually.
    await applyManualEdit(book, {
      authors: [{ name: 'Manual Author', openlibrary_key: null, nationality: null }],
      genres: ['Science Fiction'],
      publication_year: 1953,
      original_language: 'en',
    });

    // Step 2: Phase 4 applier runs with a totally different bundle.
    const jobId = await openJob(MD5);
    const bundle: EnrichedBundle = {
      workKey: '/works/OL999W',
      publicationYear: 1999,
      originalLanguage: 'fr',
      authors: [
        { name: 'Other Author', openlibrary_key: '/authors/OL1A', nationality: 'FR' },
      ],
      subjects: ['Fantasy'],
      referencePages: null,
    };
    await applyEnrichment(db, MD5, jobId, bundle);

    // Step 3: every manual value stuck.
    const fresh = await db('book').where({ md5: MD5 }).first();
    expect(fresh.publication_year).toBe(1953);
    expect(fresh.publication_year_source).toBe('manual');
    expect(fresh.original_language).toBe('en');
    expect(fresh.original_language_source).toBe('manual');
    expect(fresh.authors_source).toBe('manual');
    expect(fresh.genres_source).toBe('manual');

    // book_author rows: manual author only (the applier's authors_source='manual'
    // gate skipped the rewrite path).
    const baRows = await db('book_author as ba')
      .join('author as a', 'ba.author_id', 'a.id')
      .where({ book_md5: MD5 })
      .select('a.name');
    expect(baRows).toHaveLength(1);
    expect(baRows[0].name).toBe('Manual Author');

    // book_genre rows: manual genre only.
    const bgRows = await db('book_genre as bg')
      .join('genre as g', 'bg.genre_id', 'g.id')
      .where({ book_md5: MD5 })
      .select('g.name');
    expect(bgRows).toHaveLength(1);
    expect(bgRows[0].name).toBe('Science Fiction');
  });
});
