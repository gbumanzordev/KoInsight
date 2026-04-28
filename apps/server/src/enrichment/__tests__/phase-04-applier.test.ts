import { beforeEach, describe, expect, it } from 'vitest';
import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { applyEnrichment, markTerminalFailure, type EnrichedBundle } from '../applier';

// Phase 4 Plan 04 Task 1: transactional applier + terminal-failure flip.
// Covers D-18 (single transaction), D-19 (author upsert three-step), D-20
// (per-field provenance guards), SC-3 (idempotency), SC-4 (manual-wins),
// SC-5 (terminal failure dual-row write).

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

function enderBundle(overrides: Partial<EnrichedBundle> = {}): EnrichedBundle {
  return {
    workKey: '/works/OL45804W',
    publicationYear: 1985,
    originalLanguage: 'en',
    authors: [
      {
        name: 'Orson Scott Card',
        openlibrary_key: '/authors/OL23919A',
        nationality: 'US',
      },
    ],
    subjects: ['Science Fiction', 'Space Opera', 'Juvenile fiction'],
    referencePages: null,
    ...overrides,
  };
}

describe('applyEnrichment', () => {
  beforeEach(async () => {
    await seedGenres();
  });

  it('writes book_author, book_genre, book columns, flips job + book status (clear-match)', async () => {
    await createBook(db, { md5: MD5, title: "Ender's Game", enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle());

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('enriched');
    expect(book.openlibrary_work_key).toBe('/works/OL45804W');
    expect(book.publication_year).toBe(1985);
    expect(book.original_language).toBe('en');
    expect(book.authors_source).toBe('openlibrary');
    expect(book.genres_source).toBe('openlibrary');
    expect(book.publication_year_source).toBe('openlibrary');
    expect(book.original_language_source).toBe('openlibrary');

    const baRows = await db('book_author').where({ book_md5: MD5 }).orderBy('position');
    expect(baRows).toHaveLength(1);
    expect(baRows[0].position).toBe(0);
    expect(baRows[0].role).toBe('author');

    const bgRows = await db('book_genre as bg')
      .join('genre as g', 'bg.genre_id', 'g.id')
      .where({ book_md5: MD5 })
      .select('g.name');
    const names = bgRows.map((r) => r.name).sort();
    expect(names).toContain('Science Fiction');
    expect(names).toContain('Space Opera');

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('succeeded');
  });

  it('is idempotent: second apply with same bundle yields identical state (SC-3)', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle());

    const snap1 = {
      book: await db('book').where({ md5: MD5 }).first(),
      ba: await db('book_author').where({ book_md5: MD5 }).orderBy('position'),
      bg: await db('book_genre').where({ book_md5: MD5 }).orderBy('genre_id'),
    };

    // Re-open the job (first apply flipped it to 'succeeded')
    await db('enrichment_job').where({ id: jobId }).update({ status: 'running' });
    await applyEnrichment(db, MD5, jobId, enderBundle());

    const snap2 = {
      book: await db('book').where({ md5: MD5 }).first(),
      ba: await db('book_author').where({ book_md5: MD5 }).orderBy('position'),
      bg: await db('book_genre').where({ book_md5: MD5 }).orderBy('genre_id'),
    };

    expect(snap2.book).toEqual(snap1.book);
    expect(
      snap2.ba.map((r) => ({ author_id: r.author_id, position: r.position, role: r.role }))
    ).toEqual(
      snap1.ba.map((r) => ({ author_id: r.author_id, position: r.position, role: r.role }))
    );
    expect(snap2.bg.map((r) => r.genre_id)).toEqual(snap1.bg.map((r) => r.genre_id));
  });

  it('manual-wins for genres (SC-4): existing book_genre and genres_source=manual stay untouched', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending', genres_source: 'manual' });
    const [fantasy] = await db('genre').where({ name: 'Fantasy' }).select('id');
    await db('book_genre').insert({ book_md5: MD5, genre_id: fantasy.id });
    const jobId = await openJob(MD5);

    // Bundle maps to Science Fiction + Space Opera, NOT Fantasy.
    await applyEnrichment(db, MD5, jobId, enderBundle());

    const rows = await db('book_genre').where({ book_md5: MD5 });
    expect(rows).toHaveLength(1);
    expect(rows[0].genre_id).toBe(fantasy.id);

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.genres_source).toBe('manual');
  });

  it('manual-wins for authors: existing book_author rows + authors_source=manual stay untouched', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending', authors_source: 'manual' });
    const [a1] = await db('author').insert({ name: 'Alice' }).returning('id');
    const [a2] = await db('author').insert({ name: 'Bob' }).returning('id');
    const a1Id = typeof a1 === 'object' ? a1.id : a1;
    const a2Id = typeof a2 === 'object' ? a2.id : a2;
    await db('book_author').insert([
      { book_md5: MD5, author_id: a1Id, position: 0, role: 'author' },
      { book_md5: MD5, author_id: a2Id, position: 1, role: 'author' },
    ]);
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle());

    const rows = await db('book_author').where({ book_md5: MD5 }).orderBy('position');
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.author_id)).toEqual([a1Id, a2Id]);

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.authors_source).toBe('manual');
  });

  it('manual-wins for publication_year: manual source blocks overwrite', async () => {
    await createBook(db, {
      md5: MD5,
      enrichment_status: 'pending',
      publication_year: 1985,
      publication_year_source: 'manual',
    });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ publicationYear: 2020 }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.publication_year).toBe(1985);
    expect(book.publication_year_source).toBe('manual');
  });

  it('openlibrary source is overwritable', async () => {
    await createBook(db, {
      md5: MD5,
      enrichment_status: 'pending',
      publication_year: 1985,
      publication_year_source: 'openlibrary',
    });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ publicationYear: 2020 }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.publication_year).toBe(2020);
    expect(book.publication_year_source).toBe('openlibrary');
  });

  it('NULL source is writable', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ publicationYear: 2020 }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.publication_year).toBe(2020);
    expect(book.publication_year_source).toBe('openlibrary');
  });

  it('author dedup by openlibrary_key (D-19 step 1): reuses existing author row', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const [existing] = await db('author')
      .insert({
        name: 'O. S. Card',
        openlibrary_key: '/authors/OL23919A',
        nationality_source: 'openlibrary',
      })
      .returning('id');
    const existingId = typeof existing === 'object' ? existing.id : existing;
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle());

    const authors = await db('author').select('*');
    expect(authors).toHaveLength(1);
    expect(authors[0].id).toBe(existingId);

    const ba = await db('book_author').where({ book_md5: MD5 });
    expect(ba[0].author_id).toBe(existingId);
  });

  it('author dedup by normalized name (D-19 step 2): reuses row and stamps OL key', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const [existing] = await db('author')
      .insert({ name: 'Orson Scott Card', openlibrary_key: null })
      .returning('id');
    const existingId = typeof existing === 'object' ? existing.id : existing;
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle());

    const authors = await db('author').select('*');
    expect(authors).toHaveLength(1);
    expect(authors[0].id).toBe(existingId);
    expect(authors[0].openlibrary_key).toBe('/authors/OL23919A');
    expect(authors[0].nationality).toBe('US');
    expect(authors[0].nationality_source).toBe('openlibrary');
  });

  it('author dedup by normalized name (D-19 step 2): manual nationality wins (SC-4)', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const [existing] = await db('author')
      .insert({
        name: 'Orson Scott Card',
        openlibrary_key: null,
        nationality: 'FR',
        nationality_source: 'manual',
      })
      .returning('id');
    const existingId = typeof existing === 'object' ? existing.id : existing;
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle());

    const authors = await db('author').select('*');
    expect(authors).toHaveLength(1);
    expect(authors[0].id).toBe(existingId);
    // OL key is always stamped (provenance-free identifier per WD-04).
    expect(authors[0].openlibrary_key).toBe('/authors/OL23919A');
    // Nationality stays manual.
    expect(authors[0].nationality).toBe('FR');
    expect(authors[0].nationality_source).toBe('manual');
  });

  it('author dedup creates new row when both checks miss (D-19 step 3)', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle());

    const authors = await db('author').select('*');
    expect(authors).toHaveLength(1);
    expect(authors[0].name).toBe('Orson Scott Card');
    expect(authors[0].openlibrary_key).toBe('/authors/OL23919A');
    expect(authors[0].nationality).toBe('US');
    expect(authors[0].nationality_source).toBe('openlibrary');
  });

  it('transaction rollback: throw inside apply leaves DB untouched', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    // Force failure: pass a bundle referencing a non-existent book md5.
    await expect(applyEnrichment(db, 'z'.repeat(32), jobId, enderBundle())).rejects.toThrow();

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('pending');
    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('running');
    const ba = await db('book_author').where({ book_md5: MD5 });
    expect(ba).toHaveLength(0);
  });

  it('stamps authors_source=openlibrary even when bundle has zero authors (explicit write path)', async () => {
    // Edge case: sanity check that the source column is stamped when we DID pass through
    // the open-library write path. Zero-author bundles are degenerate but possible.
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ authors: [] }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.authors_source).toBe('openlibrary');
    const ba = await db('book_author').where({ book_md5: MD5 });
    expect(ba).toHaveLength(0);
  });
});

describe('markTerminalFailure', () => {
  it('flips job.status=failed and book.enrichment_status=failed in one transaction (SC-5)', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    await markTerminalFailure(db, jobId, MD5, new Error('no-match after top-3'), 'no_match');

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('failed');
    expect(job.last_error).toBe('no-match after top-3');

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('failed');
    // Phase 8 D-01: failure_reason persisted alongside enrichment_status.
    expect(book.failure_reason).toBe('no_match');
  });

  it('truncates last_error to 500 chars before writing', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    const long = 'x'.repeat(1000);
    await markTerminalFailure(db, jobId, MD5, new Error(long), 'no_match');

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.last_error).toHaveLength(500);
    expect(job.last_error).toBe('x'.repeat(500));
  });

  it('accepts non-Error values (string, unknown) without throwing', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await openJob(MD5);

    await markTerminalFailure(db, jobId, MD5, 'raw string failure', 'no_match');

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('failed');
    expect(job.last_error).toBe('raw string failure');
  });
});
