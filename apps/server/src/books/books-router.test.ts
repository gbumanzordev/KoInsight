import express from 'express';
import request from 'supertest';
import { createBook } from '../db/factories/book-factory';
import { db } from '../knex';
import { booksRouter } from './books-router';

describe('books-router', () => {
  const app = express();
  app.use(express.json());
  app.use('/books', booksRouter);

  describe('GET /books', () => {
    it('returns all books as JSON', async () => {
      await createBook(db, { title: 'Book 1' });

      let response = await request(app).get('/books');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toEqual(expect.objectContaining({ title: 'Book 1' }));

      await createBook(db, { title: 'Book 2' });

      response = await request(app).get('/books');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(response.body[1]).toEqual(expect.objectContaining({ title: 'Book 2' }));
    });

    it('excludes hidden books by default', async () => {
      await createBook(db, { title: 'Visible Book', soft_deleted: false });
      await createBook(db, { title: 'Hidden Book', soft_deleted: true });

      const response = await request(app).get('/books');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe('Visible Book');
    });

    it('includes hidden books when showHidden=true', async () => {
      await createBook(db, { title: 'Visible Book', soft_deleted: false });
      await createBook(db, { title: 'Hidden Book', soft_deleted: true });

      const response = await request(app).get('/books?showHidden=true');
      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
    });
  });

  describe('GET /books/:bookId', () => {
    it('returns a book by id', async () => {
      const book = await createBook(db, { title: 'Test Book' });

      const response = await request(app).get(`/books/${book.id}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual(expect.objectContaining({ title: 'Test Book' }));
    });
  });

  describe('DELETE /books/:bookId', () => {
    it('deletes a book', async () => {
      const book = await createBook(db, { title: 'Book to Delete' });

      const response = await request(app).delete(`/books/${book.id}`);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Book deleted' });
    });
  });

  describe('PUT /books/:bookId/hide', () => {
    it('hides a book', async () => {
      const book = await createBook(db, { title: 'Book to Hide', soft_deleted: false });

      const response = await request(app).put(`/books/${book.id}/hide`).send({ hidden: true });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Book hidden' });
    });

    it('shows a hidden book', async () => {
      const book = await createBook(db, { title: 'Hidden Book', soft_deleted: true });

      const response = await request(app).put(`/books/${book.id}/hide`).send({ hidden: false });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Book shown' });
    });

    it('returns 400 when hidden field is missing', async () => {
      const book = await createBook(db);

      const response = await request(app).put(`/books/${book.id}/hide`).send({});
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Missing required fields' });
    });
  });

  describe('POST /books/:bookId/genres', () => {
    it('adds a genre to a book', async () => {
      const book = await createBook(db);

      const response = await request(app)
        .post(`/books/${book.id}/genres`)
        .send({ genreName: 'Fantasy' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Genre added' });
    });

    it('returns 400 when genreName is missing', async () => {
      const book = await createBook(db);

      const response = await request(app).post(`/books/${book.id}/genres`).send({});
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: 'Missing required fields' });
    });
  });

  describe('PATCH /books/:bookId/metadata', () => {
    it('200: persists publication_year and stamps publication_year_source=manual', async () => {
      const book = await createBook(db, { title: 'Test', md5: 'a'.repeat(32) });

      const response = await request(app)
        .patch(`/books/${book.id}/metadata`)
        .send({ publication_year: 1953 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({ id: book.id, publication_year: 1953 })
      );

      const row = await db('book').where({ id: book.id }).first();
      expect(row.publication_year).toBe(1953);
      expect(row.publication_year_source).toBe('manual');
    });

    it('200: rewrites book_author rows and syncs denormalized book.authors text', async () => {
      const book = await createBook(db, { title: 'T', md5: 'b'.repeat(32), authors: 'Old Name' });

      const response = await request(app)
        .patch(`/books/${book.id}/metadata`)
        .send({
          authors: [{ name: 'Isaac Asimov' }, { name: 'Arthur C. Clarke' }],
        });

      expect(response.status).toBe(200);

      const rows = await db('book_author').where({ book_md5: book.md5 }).orderBy('position');
      expect(rows).toHaveLength(2);
      expect(rows[0].position).toBe(0);
      expect(rows[1].position).toBe(1);

      const fresh = await db('book').where({ id: book.id }).first();
      expect(fresh.authors_source).toBe('manual');
      expect(fresh.authors).toBe('Isaac Asimov, Arthur C. Clarke');
    });

    it('200: rewrites book_genre rows and stamps genres_source=manual; silently drops non-canonical names', async () => {
      const book = await createBook(db, { md5: 'c'.repeat(32) });
      await db('genre').insert({ name: 'Phase5 Test Genre' }).onConflict('name').ignore();

      const response = await request(app)
        .patch(`/books/${book.id}/metadata`)
        .send({ genres: ['Phase5 Test Genre', 'Not A Real Canonical Genre'] });

      expect(response.status).toBe(200);

      const rows = await db('book_genre as bg')
        .join('genre as g', 'bg.genre_id', 'g.id')
        .where({ book_md5: book.md5 })
        .select('g.name');
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('Phase5 Test Genre');

      const fresh = await db('book').where({ id: book.id }).first();
      expect(fresh.genres_source).toBe('manual');
    });

    it('200: publication_year=null is an explicit clear (value=null, source=manual)', async () => {
      const book = await createBook(db, {
        md5: 'd'.repeat(32),
        publication_year: 1999,
        publication_year_source: 'openlibrary',
      });

      const response = await request(app)
        .patch(`/books/${book.id}/metadata`)
        .send({ publication_year: null });

      expect(response.status).toBe(200);

      const fresh = await db('book').where({ id: book.id }).first();
      expect(fresh.publication_year).toBe(null);
      expect(fresh.publication_year_source).toBe('manual');
    });

    it('200: fields absent from the body are not touched (preserves prior genres_source)', async () => {
      const book = await createBook(db, {
        md5: 'e'.repeat(32),
        genres_source: 'openlibrary',
      });

      const response = await request(app)
        .patch(`/books/${book.id}/metadata`)
        .send({ publication_year: 1953 });

      expect(response.status).toBe(200);

      const fresh = await db('book').where({ id: book.id }).first();
      expect(fresh.genres_source).toBe('openlibrary'); // untouched
      expect(fresh.publication_year_source).toBe('manual');
    });

    it('400: invalid publication_year returns flattened Zod error', async () => {
      const book = await createBook(db, { md5: 'f'.repeat(32) });

      const response = await request(app)
        .patch(`/books/${book.id}/metadata`)
        .send({ publication_year: 999 });

      expect(response.status).toBe(400);
      expect(response.body.error.fieldErrors.publication_year).toBeDefined();
      expect(response.body.error.fieldErrors.publication_year.join(' ')).toContain(
        'between 1000 and 2100'
      );
    });

    it('400: empty body rejected via .refine', async () => {
      const book = await createBook(db, { md5: '1'.repeat(32) });

      const response = await request(app).patch(`/books/${book.id}/metadata`).send({});

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body.error)).toContain('No fields to update');
    });

    it('400: unknown field rejected by strict mode', async () => {
      const book = await createBook(db, { md5: '2'.repeat(32) });

      const response = await request(app)
        .patch(`/books/${book.id}/metadata`)
        .send({ foo: 'bar' });

      expect(response.status).toBe(400);
    });

    it('404: unknown :bookId', async () => {
      const response = await request(app)
        .patch(`/books/999999/metadata`)
        .send({ publication_year: 1953 });

      expect(response.status).toBe(404);
    });
  });

  describe('POST /books/:bookId/re-enrich', () => {
    it('returns 202 with new pending job for a pending book', async () => {
      const md5 = 'a'.repeat(32);
      const book = await createBook(db, {
        md5,
        title: 'Pending Book',
        enrichment_status: 'pending',
      });

      const pre = await db('enrichment_job').where({ book_md5: md5 }).select('id');
      expect(pre).toHaveLength(0);

      const response = await request(app).post(`/books/${book.id}/re-enrich`).send();

      expect(response.status).toBe(202);
      expect(response.body.job).toEqual(
        expect.objectContaining({
          book_md5: md5,
          status: 'pending',
          attempts: 0,
          last_error: null,
        })
      );
      expect(typeof response.body.job.id).toBe('number');

      const post = await db('enrichment_job').where({ book_md5: md5 }).select('id');
      expect(post).toHaveLength(1);
    });

    it('returns 202 with existing open job when one already exists', async () => {
      const md5 = 'b'.repeat(32);
      const book = await createBook(db, { md5, enrichment_status: 'pending' });
      const [existing] = await db('enrichment_job')
        .insert({ book_md5: md5, status: 'pending' })
        .returning('id');
      const existingId = (existing as { id: number }).id ?? (existing as unknown as number);

      const preCount = (await db('enrichment_job').where({ book_md5: md5 }).select('id')).length;
      expect(preCount).toBe(1);

      const response = await request(app).post(`/books/${book.id}/re-enrich`).send();

      expect(response.status).toBe(202);
      expect(response.body.job.id).toBe(existingId);
      expect(response.body.job.status).toBe('pending');

      const postCount = (await db('enrichment_job').where({ book_md5: md5 }).select('id')).length;
      expect(postCount).toBe(1);
    });

    it('returns 202 with a new pending job for a previously-failed book', async () => {
      // Manual re-enrich (force=true) bypasses the terminal-state gate, resets
      // book.enrichment_status to 'pending', and enqueues a fresh pending job.
      // The router prefers the open job over historical terminal rows.
      const md5 = 'c'.repeat(32);
      const book = await createBook(db, { md5, enrichment_status: 'failed' });
      const [inserted] = await db('enrichment_job')
        .insert({ book_md5: md5, status: 'failed', last_error: 'prior-error', attempts: 1 })
        .returning('id');
      const priorFailedId = (inserted as { id: number }).id ?? (inserted as unknown as number);

      const response = await request(app).post(`/books/${book.id}/re-enrich`).send();

      expect(response.status).toBe(202);
      expect(response.body.job.status).toBe('pending');
      expect(response.body.job.id).not.toBe(priorFailedId);

      const updatedBook = await db('book').where({ md5 }).first();
      expect(updatedBook?.enrichment_status).toBe('pending');

      const allJobs = await db('enrichment_job').where({ book_md5: md5 }).select('id', 'status');
      expect(allJobs).toHaveLength(2);
      expect(allJobs.map((j) => j.status).sort()).toEqual(['failed', 'pending']);
    });

    it('returns 404 when bookId does not exist', async () => {
      const response = await request(app).post(`/books/999999/re-enrich`).send();
      expect(response.status).toBe(404);
    });
  });

  describe('PUT /books/:bookId/reference_pages', () => {
    it('updates reference pages', async () => {
      const book = await createBook(db, { reference_pages: 100 });

      const response = await request(app)
        .put(`/books/${book.id}/reference_pages`)
        .send({ reference_pages: 250 });
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ message: 'Reference pages updated' });
    });

    it('returns 400 when reference_pages is missing', async () => {
      const book = await createBook(db);

      const response = await request(app).put(`/books/${book.id}/reference_pages`).send({});
      expect(response.status).toBe(400);
      // Phase 7 Plan 04 (D-13): Zod-flattened error replaces the legacy plain message.
      expect(response.body.error).toBeDefined();
    });
  });
});
