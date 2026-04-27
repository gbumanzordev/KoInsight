import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { booksRouter } from '../books-router';

// Phase 7 Plan 04 Task 1: PUT /:bookId/reference_pages with Zod + provenance.
//
// Decision references:
//   D-12: same-value PUT is a no-op (does NOT stamp 'manual') — confirm-no-lock.
//   D-13: Zod accepts {reference_pages: positive int | null | 0}; everything else 400.
const app = express();
app.use(express.json());
app.use('/books', booksRouter);

describe('PUT /books/:bookId/reference_pages (Phase 7 Plan 04)', () => {
  it('writes new value and stamps source=manual when book had NULL/NULL', async () => {
    const book = await createBook(db, {
      reference_pages: null,
      reference_pages_source: null,
    });

    const response = await request(app)
      .put(`/books/${book.id}/reference_pages`)
      .send({ reference_pages: 320 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ message: 'Reference pages updated' });

    const fresh = await db('book').where({ id: book.id }).first();
    expect(fresh.reference_pages).toBe(320);
    expect(fresh.reference_pages_source).toBe('manual');
  });

  it('D-12: same-value PUT is a no-op and does NOT overwrite source=openlibrary', async () => {
    const book = await createBook(db, {
      reference_pages: 320,
      reference_pages_source: 'openlibrary',
    });

    const response = await request(app)
      .put(`/books/${book.id}/reference_pages`)
      .send({ reference_pages: 320 });

    expect(response.status).toBe(200);

    const fresh = await db('book').where({ id: book.id }).first();
    expect(fresh.reference_pages).toBe(320);
    // confirm-no-lock: source must remain openlibrary
    expect(fresh.reference_pages_source).toBe('openlibrary');
  });

  it('different value flips source from openlibrary -> manual', async () => {
    const book = await createBook(db, {
      reference_pages: 320,
      reference_pages_source: 'openlibrary',
    });

    const response = await request(app)
      .put(`/books/${book.id}/reference_pages`)
      .send({ reference_pages: 321 });

    expect(response.status).toBe(200);

    const fresh = await db('book').where({ id: book.id }).first();
    expect(fresh.reference_pages).toBe(321);
    expect(fresh.reference_pages_source).toBe('manual');
  });

  it('reference_pages: null clears both columns', async () => {
    const book = await createBook(db, {
      reference_pages: 320,
      reference_pages_source: 'manual',
    });

    const response = await request(app)
      .put(`/books/${book.id}/reference_pages`)
      .send({ reference_pages: null });

    expect(response.status).toBe(200);

    const fresh = await db('book').where({ id: book.id }).first();
    expect(fresh.reference_pages).toBeNull();
    expect(fresh.reference_pages_source).toBeNull();
  });

  it('reference_pages: 0 clears both columns', async () => {
    const book = await createBook(db, {
      reference_pages: 320,
      reference_pages_source: 'manual',
    });

    const response = await request(app)
      .put(`/books/${book.id}/reference_pages`)
      .send({ reference_pages: 0 });

    expect(response.status).toBe(200);

    const fresh = await db('book').where({ id: book.id }).first();
    expect(fresh.reference_pages).toBeNull();
    expect(fresh.reference_pages_source).toBeNull();
  });

  it('400: negative integer rejected with flattened Zod error', async () => {
    const book = await createBook(db);

    const response = await request(app)
      .put(`/books/${book.id}/reference_pages`)
      .send({ reference_pages: -5 });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
    // flattened Zod error shape
    expect(response.body.error).toHaveProperty('formErrors');
  });

  it('400: missing reference_pages field rejected', async () => {
    const book = await createBook(db);

    const response = await request(app).put(`/books/${book.id}/reference_pages`).send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });

  it('400: non-numeric reference_pages rejected', async () => {
    const book = await createBook(db);

    const response = await request(app)
      .put(`/books/${book.id}/reference_pages`)
      .send({ reference_pages: 'not-a-number' });

    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});
