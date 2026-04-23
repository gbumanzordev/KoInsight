import type { Knex } from 'knex';
import { parseAuthors } from './helpers/parse-authors';

// D-09: app-layer dedup key. No schema column for this; UNIQUE(name) is the schema backstop (D-08).
function dedupKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export async function up(knex: Knex): Promise<void> {
  await knex.transaction(async (trx) => {
    // SCHEMA-08: source data is existing book.authors strings only. No external data, no network.
    const books: Array<{ md5: string; authors: string }> = await trx('book')
      .select('md5', 'authors')
      .whereNotNull('authors')
      .andWhere('authors', '!=', '');

    // Cache: dedupKey -> author.id, populated lazily so we make at most one INSERT per unique author.
    const authorIdByKey = new Map<string, number>();

    for (const book of books) {
      const parsed = parseAuthors(book.authors);
      if (parsed.length === 0) continue;

      for (const { name, position } of parsed) {
        const key = dedupKey(name);

        let authorId = authorIdByKey.get(key);

        if (authorId === undefined) {
          // Look up by normalized dedup key to honor D-09 (case-insensitive, whitespace-collapsed).
          // Because dedupKey is case-insensitive but UNIQUE(name) is case-sensitive,
          // we search by the dedupKey via LOWER(TRIM(...)) with space-collapse.
          const existing = await trx('author')
            .select('id')
            .whereRaw("LOWER(TRIM(REPLACE(REPLACE(name, '  ', ' '), '  ', ' '))) = ?", [key])
            .first();

          if (existing) {
            authorId = existing.id;
          } else {
            // Insert. UNIQUE(name) is the backstop: if a concurrent migration somehow
            // inserted the same canonical name, we would get a UNIQUE error; but migrations
            // run serially so that path is not realistic.
            const [inserted] = await trx('author')
              .insert({
                name, // D-08: stored verbatim (case + punctuation as parsed)
                nationality_source: null, // D-14
                bio: null,
              })
              .returning('id');
            authorId = typeof inserted === 'object' ? inserted.id : inserted;
          }

          authorIdByKey.set(key, authorId as number);
        }

        // Insert junction row. role defaults to 'author' (set in Plan 03's schema).
        // unique(book_md5, position) and unique(book_md5, author_id) are the schema guards.
        await trx('book_author').insert({
          book_md5: book.md5,
          author_id: authorId,
          position,
          role: 'author',
        });
      }
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  // Data-only migration. Rollback drops only the data this migration inserted.
  // Safe approach: truncate book_author and author. This is acceptable because
  // Phase 1 is the first phase to populate these tables; there is no upstream data
  // we would be destroying. (Phase 4 enrichment also writes here, but if you are
  // rolling back Phase 1, you have already rolled back later phases first.)
  await knex('book_author').del();
  await knex('author').del();
}
