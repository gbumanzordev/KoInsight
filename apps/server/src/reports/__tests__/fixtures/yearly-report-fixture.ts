// Phase 6 Plan 03: composable seed helper for reports-repository integration tests.
//
// Builds a yearly-report scenario by composing the existing factories
// (createBook, createDevice, createBookDevice, createPageStat) plus direct
// inserts for author / book_author / genre / book_genre rows (no factory
// existed for those Phase 4-era tables, so the inserts live here).
//
// Determinism: callers pass explicit md5 strings (e.g., 'md5-A') so assertions
// stay simple. Authors are de-duplicated by name within a single seed call.

import type { Knex } from 'knex';

import { createBook } from '../../../db/factories/book-factory';
import { createBookDevice } from '../../../db/factories/book-device-factory';
import { createDevice } from '../../../db/factories/device-factory';
import { createPageStat } from '../../../db/factories/page-stat-factory';

export type ScenarioBookSpec = {
  md5: string;
  pages: number;
  referencePages?: number | null;
  publicationYear?: number | null;
  originalLanguage?: string | null;
  softDeleted?: boolean;
  primaryAuthor?: { name: string; nationality?: string | null } | null;
  coAuthors?: Array<{ name: string; nationality?: string | null }>;
  genres?: string[];
  pageStats?: Array<{ page: number; startTimeSec: number; durationSec: number }>;
};

export type ScenarioOpts = {
  books: ScenarioBookSpec[];
};

export type ScenarioResult = {
  md5s: string[];
  deviceId: string;
};

export async function seedYearlyReportScenario(
  db: Knex,
  opts: ScenarioOpts
): Promise<ScenarioResult> {
  const device = await createDevice(db);

  // Cache author rows by name within this seed call to avoid UNIQUE(name) collisions.
  const authorIdByName = new Map<string, number>();
  const ensureAuthor = async (name: string, nationality: string | null): Promise<number> => {
    const cached = authorIdByName.get(name);
    if (cached != null) return cached;
    const [row] = await db('author')
      .insert({ name, nationality, nationality_source: nationality ? 'manual' : null })
      .returning('id');
    const id = typeof row === 'object' ? row.id : row;
    authorIdByName.set(name, id);
    return id;
  };

  // Cache genre rows by name; canonical genres seeded by the migration are reused.
  const ensureGenre = async (name: string): Promise<number> => {
    const existing = await db('genre').where({ name }).first();
    if (existing) return existing.id;
    const [row] = await db('genre').insert({ name }).returning('id');
    return typeof row === 'object' ? row.id : row;
  };

  const md5s: string[] = [];

  for (const spec of opts.books) {
    // book.pages was dropped from the schema in 20250413124229; only
    // book.reference_pages remains. Per-device pages live on book_device.pages.
    const book = await createBook(db, {
      md5: spec.md5,
      reference_pages: spec.referencePages === undefined ? spec.pages : spec.referencePages,
      publication_year: spec.publicationYear ?? null,
      original_language: spec.originalLanguage ?? null,
      soft_deleted: spec.softDeleted ?? false,
    });
    md5s.push(book.md5);

    const bookDevice = await createBookDevice(db, book, device, { pages: spec.pages });

    if (spec.primaryAuthor) {
      const authorId = await ensureAuthor(
        spec.primaryAuthor.name,
        spec.primaryAuthor.nationality ?? null
      );
      await db('book_author').insert({
        book_md5: book.md5,
        author_id: authorId,
        position: 0,
        role: 'author',
      });
    }
    if (spec.coAuthors) {
      let position = 1;
      for (const co of spec.coAuthors) {
        const authorId = await ensureAuthor(co.name, co.nationality ?? null);
        await db('book_author').insert({
          book_md5: book.md5,
          author_id: authorId,
          position,
          role: 'author',
        });
        position++;
      }
    }

    if (spec.genres) {
      for (const genreName of spec.genres) {
        const genreId = await ensureGenre(genreName);
        await db('book_genre').insert({ book_md5: book.md5, genre_id: genreId });
      }
    }

    if (spec.pageStats) {
      for (const ps of spec.pageStats) {
        await createPageStat(db, book, bookDevice, device, {
          page: ps.page,
          start_time: ps.startTimeSec,
          duration: ps.durationSec,
        });
      }
    }
  }

  return { md5s, deviceId: device.id };
}
