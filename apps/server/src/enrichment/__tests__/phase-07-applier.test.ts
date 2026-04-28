import { beforeEach, describe, expect, it } from 'vitest';
import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { applyEnrichment, type EnrichedBundle } from '../applier';

// Phase 7 Plan 03 Task 1: D-06 reference_pages provenance guard.
// Mirrors the publication_year manual-wins / openlibrary-overwrite pattern but
// adds the no-clear semantic: a null bundle.referencePages must NEVER clear an
// existing reference_pages value (whether OL- or manual-sourced).

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
    subjects: ['Science Fiction'],
    referencePages: null,
    ...overrides,
  };
}

describe('applyEnrichment reference_pages provenance (D-06)', () => {
  beforeEach(async () => {
    await seedGenres();
  });

  it('case 1: NULL/NULL + bundle 352 -> 352/openlibrary', async () => {
    await createBook(db, {
      md5: MD5,
      enrichment_status: 'pending',
      reference_pages: null,
      reference_pages_source: null,
    });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ referencePages: 352 }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.reference_pages).toBe(352);
    expect(book.reference_pages_source).toBe('openlibrary');
  });

  it('case 2: 320/openlibrary + bundle 384 -> 384/openlibrary (overwrite OL with OL)', async () => {
    await createBook(db, {
      md5: MD5,
      enrichment_status: 'pending',
      reference_pages: 320,
      reference_pages_source: 'openlibrary',
    });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ referencePages: 384 }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.reference_pages).toBe(384);
    expect(book.reference_pages_source).toBe('openlibrary');
  });

  it('case 3: 320/openlibrary + bundle null -> 320/openlibrary (no-clear, D-06)', async () => {
    await createBook(db, {
      md5: MD5,
      enrichment_status: 'pending',
      reference_pages: 320,
      reference_pages_source: 'openlibrary',
    });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ referencePages: null }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.reference_pages).toBe(320);
    expect(book.reference_pages_source).toBe('openlibrary');
  });

  it('case 4: 320/manual + bundle 384 -> 320/manual (manual sticky)', async () => {
    await createBook(db, {
      md5: MD5,
      enrichment_status: 'pending',
      reference_pages: 320,
      reference_pages_source: 'manual',
    });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ referencePages: 384 }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.reference_pages).toBe(320);
    expect(book.reference_pages_source).toBe('manual');
  });

  it('case 5: NULL/NULL + bundle null -> NULL/NULL (no write)', async () => {
    await createBook(db, {
      md5: MD5,
      enrichment_status: 'pending',
      reference_pages: null,
      reference_pages_source: null,
    });
    const jobId = await openJob(MD5);

    await applyEnrichment(db, MD5, jobId, enderBundle({ referencePages: null }));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.reference_pages).toBeNull();
    expect(book.reference_pages_source).toBeNull();
  });
});
