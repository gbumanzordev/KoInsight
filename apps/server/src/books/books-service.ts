import { Book, BookDevice, BookWithData, PageStat } from '@koinsight/common/types';
import type { MetadataPatch } from '@koinsight/common/dist/types/books-edit-api.js';
import { startOfDay } from 'date-fns';
import { AnnotationsRepository } from '../annotations/annotations-repository';
import { upsertAuthor } from '../enrichment/author-upsert';
import { GenreRepository } from '../genres/genre-repository';
import { db } from '../knex';
import { StatsRepository } from '../stats/stats-repository';
import { normalizeRanges, Range, totalRangeLength } from '../utils/ranges';
import { BooksRepository } from './books-repository';

export class BooksService {
  static getTotalPages(book: Book, bookDevices: BookDevice[]): number {
    return book.reference_pages || Math.max(...bookDevices.map((device) => device.pages || 0));
  }

  static getTotalReadTime(bookDevices: BookDevice[]): number {
    return bookDevices.reduce((acc, device) => acc + device.total_read_time, 0);
  }

  static getStartedReading(stats: PageStat[]): number {
    if (stats.length === 0) return 0;
    return stats.reduce((acc, stat) => Math.min(acc, stat.start_time), Infinity);
  }

  static getLastOpen(bookDevices: BookDevice[]): number {
    return bookDevices.reduce((acc, device) => Math.max(acc, device.last_open), 0);
  }

  static getReadPerDay(stats: PageStat[]): Record<string, number> {
    return stats.reduce(
      (acc, stat) => {
        const day = startOfDay(stat.start_time).getTime();
        acc[day] = (acc[day] || 0) + stat.duration;

        return acc;
      },
      {} as Record<string, number>
    );
  }

  static getUniqueReadPages(book: Book, stats: PageStat[]): number {
    const readPages: Range[] = [];

    stats.forEach((stat) => {
      if (book.reference_pages) {
        const startRefPage = (Math.max(stat.page - 1, 0) * book.reference_pages) / stat.total_pages;
        const endRefPage = (stat.page * book.reference_pages) / stat.total_pages;

        const range = [startRefPage, endRefPage] as Range;

        readPages.push(range);
      } else {
        readPages.push([Math.max(stat.page - 1, 0), stat.page]);
      }
    });

    return Math.round(totalRangeLength(normalizeRanges(readPages)));
  }

  static getTotalReadPages(book: Book, stats: PageStat[]): number {
    return Math.round(
      stats.reduce((acc, stat) => {
        if (book.reference_pages) {
          return acc + (1 / stat.total_pages) * book.reference_pages;
        } else {
          return acc + 1;
        }
      }, 0)
    );
  }

  static async withData(book: Book, includeDeleted = false): Promise<BookWithData> {
    const stats = await StatsRepository.getByBookMD5(book.md5);
    const bookDevices = await BooksRepository.getBookDevices(book.md5);
    const genres = await GenreRepository.getByBookMd5(book.md5);
    const authors_full = await db('book_author')
      .join('author', 'book_author.author_id', 'author.id')
      .where('book_author.book_md5', book.md5)
      .orderBy('book_author.position', 'asc')
      .select(
        'author.name',
        'author.nationality',
        'author.openlibrary_key',
        'book_author.position',
        'book_author.role'
      );

    // Get annotations data
    const annotations = await AnnotationsRepository.getByBookMd5(book.md5);
    const annotationCounts = await AnnotationsRepository.getCountsByType(book.md5);
    const deletedCount = await AnnotationsRepository.getDeletedCount(book.md5);

    const total_pages = this.getTotalPages(book, bookDevices);
    const total_read_time = this.getTotalReadTime(bookDevices);
    const started_reading = this.getStartedReading(stats);
    const last_open = this.getLastOpen(bookDevices);
    const read_per_day = this.getReadPerDay(stats);
    const total_read_pages = this.getTotalReadPages(book, stats);
    const unique_read_pages = this.getUniqueReadPages(book, stats);

    const response: BookWithData = {
      ...book,
      stats,
      device_data: bookDevices,
      started_reading,
      read_per_day,
      total_read_time,
      total_read_pages,
      unique_read_pages,
      total_pages,
      last_open,
      genres,
      authors_full,
      notes: bookDevices.reduce((acc, device) => acc + device.notes, 0),
      highlights: bookDevices.reduce((acc, device) => acc + device.highlights, 0),
      // Annotation data
      annotations,
      highlights_count: annotationCounts.highlight,
      notes_count: annotationCounts.note,
      bookmarks_count: annotationCounts.bookmark,
      deleted_count: deletedCount,
    };

    return response;
  }
}

// Phase 5 Plan 01 (EDIT-01, EDIT-02):
// Transactional writer for PATCH /api/books/:bookId/metadata.
//
// Contract:
// - Only fields PRESENT in `patch` are touched. Absent fields leave the row
//   (and their *_source column) untouched.
// - Every touched field stamps its corresponding *_source column to 'manual'
//   so the Phase 4 applier's D-20 guard permanently blocks re-enrichment
//   overwrites (the "manual wins" contract).
// - book_author / book_genre junction tables are rewritten by
//   delete-then-insert inside one transaction (mirrors applier.ts Pattern 6).
// - The denormalized `book.authors` text cache is SYNCED to the manual author
//   names (research A2 resolution: manual edits should be visible in
//   book-card.tsx, which reads book.authors text).
// - Non-canonical genre names are silently dropped via .whereIn on genre.name
//   (matches applier.ts; keeps the canonical whitelist honest).
// - Orphan author rows are NOT garbage-collected (research Pitfall 2: matches
//   applier behavior; GC deferred to a future cleanup pass).
export async function applyManualEdit(book: Book, patch: MetadataPatch): Promise<BookWithData> {
  await db.transaction(async (trx) => {
    const updates: Record<string, unknown> = {};

    if (patch.authors !== undefined) {
      const authorIds: number[] = [];
      for (const a of patch.authors) {
        const id = await upsertAuthor(
          trx,
          {
            name: a.name,
            openlibrary_key: a.openlibrary_key ?? null,
            nationality: a.nationality ?? null,
          },
          'manual'
        );
        authorIds.push(id);
      }
      await trx('book_author').where({ book_md5: book.md5 }).delete();
      if (authorIds.length > 0) {
        await trx('book_author').insert(
          authorIds.map((author_id, position) => ({
            book_md5: book.md5,
            author_id,
            position,
            role: 'author',
          }))
        );
      }
      updates.authors_source = 'manual';
      // A2: sync denormalized display cache so the UI reflects the edit.
      updates.authors = patch.authors.map((a) => a.name).join(', ');
    }

    if (patch.genres !== undefined) {
      const genreRows =
        patch.genres.length > 0
          ? await trx('genre').whereIn('name', patch.genres).select('id')
          : [];
      await trx('book_genre').where({ book_md5: book.md5 }).delete();
      if (genreRows.length > 0) {
        await trx('book_genre').insert(
          genreRows.map((g: { id: number }) => ({ book_md5: book.md5, genre_id: g.id }))
        );
      }
      updates.genres_source = 'manual';
    }

    if (patch.publication_year !== undefined) {
      updates.publication_year = patch.publication_year;
      updates.publication_year_source = 'manual';
    }

    if (patch.original_language !== undefined) {
      updates.original_language = patch.original_language;
      updates.original_language_source = 'manual';
    }

    if (Object.keys(updates).length > 0) {
      await trx('book').where({ md5: book.md5 }).update(updates);
    }
  });

  const fresh = await BooksRepository.getById(book.id);
  if (!fresh) {
    throw new Error(`applyManualEdit: book ${book.id} disappeared mid-transaction`);
  }
  return BooksService.withData(fresh, false);
}
