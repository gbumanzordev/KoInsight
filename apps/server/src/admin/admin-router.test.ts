import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthor } from '../db/factories/author-factory';
import { createBook } from '../db/factories/book-factory';
import { db } from '../knex';
import { adminRouter } from './admin-router';

describe('admin-router', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRouter);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function linkAuthorToNewBook(authorId: number, md5: string) {
    const book = await createBook(db, { md5 });
    await db('book_author').insert({ book_md5: book.md5, author_id: authorId, position: 0 });
    return book;
  }

  it('200: deletes orphan authors and returns deleted, dry_run:false, sample', async () => {
    await createAuthor(db, { name: 'Orphan A' });
    await createAuthor(db, { name: 'Orphan B' });
    await createAuthor(db, { name: 'Orphan C' });
    const ref = await createAuthor(db, { name: 'Referenced' });
    await linkAuthorToNewBook(ref.id, 'a'.repeat(32));

    const response = await request(app)
      .post('/api/admin/authors/gc')
      .send({ confirm: 'DELETE_ORPHANS' });

    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(3);
    expect(response.body.dry_run).toBe(false);
    expect(response.body.sample).toHaveLength(3);
    for (const entry of response.body.sample) {
      expect(entry).toEqual({ id: expect.any(Number), name: expect.any(String) });
    }

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 1 });
  });

  it('400: missing confirm field returns Zod flattened error and writes nothing', async () => {
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });

    const response = await request(app).post('/api/admin/authors/gc').send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 2 });
  });

  it('400: wrong-cased confirm (delete_orphans) is rejected', async () => {
    await createAuthor(db, { name: 'Orphan 1' });

    const response = await request(app)
      .post('/api/admin/authors/gc')
      .send({ confirm: 'delete_orphans' });

    expect(response.status).toBe(400);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 1 });
  });

  it('400: completely wrong confirm string is rejected', async () => {
    const response = await request(app)
      .post('/api/admin/authors/gc')
      .send({ confirm: 'YES' });

    expect(response.status).toBe(400);
  });

  it('404: GET /api/admin/authors/gc returns 404 (no GET handler)', async () => {
    await createAuthor(db, { name: 'Orphan 1' });

    const response = await request(app).get('/api/admin/authors/gc');

    expect(response.status).toBe(404);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 1 });
  });

  it('404: DELETE /api/admin/authors/gc returns 404 (no DELETE handler)', async () => {
    await createAuthor(db, { name: 'Orphan 1' });

    const response = await request(app).delete('/api/admin/authors/gc');

    expect(response.status).toBe(404);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 1 });
  });

  it('200: ?dry_run=1 query reports count without mutating', async () => {
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });
    await createAuthor(db, { name: 'Orphan 3' });
    await createAuthor(db, { name: 'Orphan 4' });

    const response = await request(app)
      .post('/api/admin/authors/gc?dry_run=1')
      .send({ confirm: 'DELETE_ORPHANS' });

    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(4);
    expect(response.body.dry_run).toBe(true);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 4 });
  });

  it('200: body {dry_run:true} reports count without mutating', async () => {
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });
    await createAuthor(db, { name: 'Orphan 3' });
    await createAuthor(db, { name: 'Orphan 4' });

    const response = await request(app)
      .post('/api/admin/authors/gc')
      .send({ confirm: 'DELETE_ORPHANS', dry_run: true });

    expect(response.status).toBe(200);
    expect(response.body.deleted).toBe(4);
    expect(response.body.dry_run).toBe(true);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 4 });
  });

  it('idempotency: second POST returns deleted:0 and writes nothing', async () => {
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });
    await createAuthor(db, { name: 'Orphan 3' });

    const first = await request(app)
      .post('/api/admin/authors/gc')
      .send({ confirm: 'DELETE_ORPHANS' });
    expect(first.status).toBe(200);
    expect(first.body.deleted).toBe(3);

    const second = await request(app)
      .post('/api/admin/authors/gc')
      .send({ confirm: 'DELETE_ORPHANS' });
    expect(second.status).toBe(200);
    expect(second.body.deleted).toBe(0);
    expect(second.body.sample).toEqual([]);

    const count = await db('author').count('id as c').first();
    expect(count).toEqual({ c: 0 });
  });

  it('200: console.info logs deleted count and sample on non-dry-run', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });

    const response = await request(app)
      .post('/api/admin/authors/gc')
      .send({ confirm: 'DELETE_ORPHANS' });

    expect(response.status).toBe(200);

    const matchingCalls = spy.mock.calls.filter((call) => call[0] === 'admin:orphan-author-gc');
    expect(matchingCalls).toHaveLength(1);
    const [, payload] = matchingCalls[0];
    expect(payload).toEqual(
      expect.objectContaining({
        deleted: 2,
        sample: expect.any(Array),
      })
    );
    expect((payload as { sample: unknown[] }).sample).toHaveLength(2);
  });

  it('200: console.info is NOT called on dry-run', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    await createAuthor(db, { name: 'Orphan 1' });
    await createAuthor(db, { name: 'Orphan 2' });

    const response = await request(app)
      .post('/api/admin/authors/gc')
      .send({ confirm: 'DELETE_ORPHANS', dry_run: true });

    expect(response.status).toBe(200);

    const matchingCalls = spy.mock.calls.filter((call) => call[0] === 'admin:orphan-author-gc');
    expect(matchingCalls).toHaveLength(0);
  });
});
