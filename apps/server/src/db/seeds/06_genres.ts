import type { CanonicalGenre } from '@koinsight/common/genres';
import { Genre } from '@koinsight/common/types';
import { Knex } from 'knex';
import { db } from '../../knex';
import { createGenre } from '../factories/genre-factory';
import { SEEDED_BOOKS } from './02_books';

// Source of truth: @koinsight/common/genres#CANONICAL_GENRES (D-19).
// The dev seed no longer owns a genre list; it reuses the shipped canonical tuple.

// Map books to their genres (by title pattern matching)
const BOOK_GENRE_MAPPING: Record<string, CanonicalGenre[]> = {
  Mistborn: ['Fantasy', 'Epic Fantasy', 'Magic', 'Adventure'],
  'The Name of the Wind': ['Fantasy', 'Adventure', 'Magic'],
  'A Game of Thrones': ['Fantasy', 'Epic Fantasy', 'Adventure', 'War Fiction'],
  'The Way of Kings': ['Fantasy', 'Epic Fantasy', 'Adventure'],
  'The Fellowship of the Ring': ['Fantasy', 'Epic Fantasy', 'Adventure'],
  'The Two Towers': ['Fantasy', 'Epic Fantasy', 'Adventure'],
  'The Last Wish': ['Fantasy', 'Sword and Sorcery', 'Adventure'],
  Hyperion: ['Science Fiction', 'Space Opera', 'Adventure'],
  'The Martian': ['Science Fiction', 'Hard Science Fiction', 'Adventure'],
  Foundation: ['Science Fiction', 'Space Opera'],
};

export let SEEDED_GENRES: Genre[] = [];

export async function seed(knex: Knex): Promise<void> {
  await knex('book_genre').del();
  await knex('genre').del();

  // Dynamic import: @koinsight/common is ESM ("type": "module") and this CJS
  // seed file cannot statically require() it. The value import lives here so
  // the tuple is still sourced from the canonical module (D-19); the type
  // import at the top of the file is erased by TypeScript and does not hit
  // the runtime module resolver.
  //
  // We hide the import() behind `new Function(...)` so TypeScript's CJS
  // downleveler (module: commonjs) does not rewrite it into a require() call
  // and the native Node ESM loader is used at runtime.
  const dynamicImport = new Function('p', 'return import(p)') as <T>(p: string) => Promise<T>;
  // Native ESM resolver does not honor directory imports or extensionless
  // specifiers; point at the compiled canonical.js file in the common
  // package's dist output (CANONICAL_GENRES is a leaf module with no
  // relative imports, so no .js-extension rewriting is needed at load time).
  const { CANONICAL_GENRES } = await dynamicImport<
    typeof import('@koinsight/common/genres/canonical')
  >('@koinsight/common/dist/genres/canonical.js');

  // Create all unique genres
  const genres = await Promise.all(CANONICAL_GENRES.map((name) => createGenre(db, { name })));

  SEEDED_GENRES = genres;

  // Create book-genre associations
  const bookGenrePromises: Promise<any>[] = [];

  SEEDED_BOOKS.forEach((book) => {
    // Find matching genres for this book
    const bookGenres =
      Object.entries(BOOK_GENRE_MAPPING).find(([titlePattern]) =>
        book.title.includes(titlePattern)
      )?.[1] || [];

    // Associate book with its genres
    bookGenres.forEach((genreName) => {
      const genre = SEEDED_GENRES.find((g) => g.name === genreName);
      if (genre) {
        bookGenrePromises.push(
          db('book_genre').insert({
            book_md5: book.md5,
            genre_id: genre.id,
          })
        );
      }
    });
  });

  await Promise.all(bookGenrePromises);

  console.log(`✓ Seeded ${SEEDED_GENRES.length} genres with book associations`);
}
