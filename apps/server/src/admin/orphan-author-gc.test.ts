import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthor } from '../db/factories/author-factory';
import { createBook } from '../db/factories/book-factory';
import { db } from '../knex';
import { deleteOrphanAuthors } from './orphan-author-gc';

describe('deleteOrphanAuthors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes only orphan authors and leaves referenced authors untouched', async () => {
    const refA = await createAuthor(db, { name: 'Referenced A' });
    const refB = await createAuthor(db, { name: 'Referenced B' });
    const bookA = await createBook(db, { title: 'Book A' });
    const bookB = await createBook(db, { title: 'Book B' });
    await db('book_author').insert({ book_md5: bookA.md5, author_id: refA.id, position: 0 });
    await db('book_author').insert({ book_md5: bookB.md5, author_id: refB.id, position: 0 });

    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });
    await createAuthor(db, { name: 'Orphan 3' });

    const result = await deleteOrphanAuthors(db, { dryRun: false });

    expect(result.deleted).toBe(3);
    expect(result.sample).toHaveLength(3);
    for (const entry of result.sample) {
      expect(entry).toEqual({ id: expect.any(Number), name: expect.any(String) });
    }

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 2 });

    const survivors = await db<{ name: string }>('author').select('name').orderBy('name');
    expect(survivors.map((r) => r.name)).toEqual(['Referenced A', 'Referenced B']);
  });

  it('dry-run reports the count without mutating', async () => {
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });
    await createAuthor(db, { name: 'Orphan 3' });

    const result = await deleteOrphanAuthors(db, { dryRun: true });

    expect(result.deleted).toBe(3);
    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 3 });
  });

  it('returns deleted: 0 with empty sample on a DB with no orphans', async () => {
    const ref = await createAuthor(db, { name: 'Only Referenced' });
    const book = await createBook(db, { title: 'Only Book' });
    await db('book_author').insert({ book_md5: book.md5, author_id: ref.id, position: 0 });

    const result = await deleteOrphanAuthors(db, { dryRun: false });

    expect(result.deleted).toBe(0);
    expect(result.sample).toEqual([]);
    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 1 });
  });

  it('is idempotent: second consecutive call deletes 0', async () => {
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });
    await createAuthor(db, { name: 'Orphan 3' });

    const first = await deleteOrphanAuthors(db, { dryRun: false });
    expect(first.deleted).toBe(3);

    const second = await deleteOrphanAuthors(db, { dryRun: false });
    expect(second.deleted).toBe(0);
    expect(second.sample).toEqual([]);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 0 });
  });

  it('caps sample at 20 when there are more than 20 orphans', async () => {
    for (let i = 1; i <= 25; i++) {
      const padded = String(i).padStart(4, '0');
      await createAuthor(db, { name: `Orphan ${padded}` });
    }

    const result = await deleteOrphanAuthors(db, { dryRun: true });

    expect(result.deleted).toBe(25);
    expect(result.sample).toHaveLength(20);
  });

  it('authors referenced by any book_author row are never deleted', async () => {
    const a = await createAuthor(db, { name: 'Author A' });
    const b = await createAuthor(db, { name: 'Author B' });
    const c = await createAuthor(db, { name: 'Author C' });

    const bookX = await createBook(db, { title: 'Book X' });
    const bookY = await createBook(db, { title: 'Book Y' });
    await db('book_author').insert({ book_md5: bookX.md5, author_id: a.id, position: 0 });
    await db('book_author').insert({ book_md5: bookY.md5, author_id: c.id, position: 0 });

    const result = await deleteOrphanAuthors(db, { dryRun: false });

    expect(result.deleted).toBe(1);
    expect(result.sample[0].name).toBe('Author B');

    const survivors = await db<{ name: string }>('author').select('name').orderBy('name');
    expect(survivors.map((r) => r.name)).toEqual(['Author A', 'Author C']);
  });

  it('delete path opens a single transaction', async () => {
    await createAuthor(db, { name: 'Lone Orphan' });
    const spy = vi.spyOn(db, 'transaction');

    await deleteOrphanAuthors(db, { dryRun: false });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('dry-run path does NOT open a transaction', async () => {
    await createAuthor(db, { name: 'Lone Orphan' });
    const spy = vi.spyOn(db, 'transaction');

    await deleteOrphanAuthors(db, { dryRun: true });

    expect(spy).not.toHaveBeenCalled();
  });
});
