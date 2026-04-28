import { metadataPatchSchema } from '@koinsight/common/dist/types/books-edit-api.js';
import { NextFunction, Request, Response, Router } from 'express';
import { z } from 'zod';
import { enrichmentService } from '../enrichment/service';
import { db } from '../knex';
import { BooksRepository } from './books-repository';
import { applyManualEdit, BooksService } from './books-service';
import { coversRouter } from './covers/covers-router';
import { getBookById } from './get-book-by-id-middleware';

// Phase 7 Plan 04 (D-13): Zod schema for PUT /:bookId/reference_pages.
// Accepts a positive integer (set), null (clear), or 0 (clear). Anything else -> 400.
const referencePagesBodySchema = z.union([
  z.object({ reference_pages: z.number().int().positive() }),
  z.object({ reference_pages: z.null() }),
  z.object({ reference_pages: z.literal(0) }),
]);

const router = Router();

router.use('/:bookId/cover', coversRouter);

/**
 * Get all books with attached entity data
 */
router.get('/', async (req: Request, res: Response) => {
  const returnDeleted = Boolean(req.query.showHidden && req.query.showHidden === 'true');
  const books = await BooksRepository.getAllWithData(returnDeleted);
  res.status(200).json(books);
});

/**
 * Get a book with attached entity data by ID
 */
router.get('/:bookId', getBookById, async (req: Request, res: Response, next: NextFunction) => {
  const book = req.book!;
  const includeDeleted = req.query.includeDeleted === 'true';
  const bookWithData = await BooksService.withData(book, includeDeleted);
  res.status(200).json(bookWithData);
});

/**
 * Delete a book by ID
 */
router.delete('/:bookId', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;

  try {
    await BooksRepository.delete(book);
    res.status(200).json({ message: 'Book deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete book' });
  }
});

router.put('/:bookId/hide', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;
  const hidden = req.body.hidden;

  if (hidden === undefined || hidden === null) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    await BooksRepository.softDelete(book.id, hidden);
    res.status(200).json({ message: `Book ${hidden ? 'hidden' : 'shown'}` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update book visibility' });
  }
});

/**
 * Adds a new genre to a book
 */
router.post('/:bookId/genres', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;
  const { genreName } = req.body;

  if (!genreName) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  try {
    await BooksRepository.addGenre(book.md5, genreName);
    res.status(200).json({ message: 'Genre added' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add genre' });
  }
});

/**
 * Updates a book's reference pages.
 *
 * Phase 7 Plan 04 (REFPAGES-03):
 *   - D-13: Body validated by referencePagesBodySchema (positive int | null | 0).
 *   - D-12 confirm-no-lock: same-value PUT is a NO-OP (no DB write, source unchanged).
 *     This prevents the UI's "edit, confirm same value" flow from accidentally locking
 *     the book against future automatic re-enrichment.
 *   - null or 0: clears both reference_pages and reference_pages_source.
 *   - Different value: writes new value, stamps reference_pages_source = 'manual'.
 */
router.put('/:bookId/reference_pages', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;

  const parsed = referencePagesBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const newValue = parsed.data.reference_pages;
  const clearAction = newValue === null || newValue === 0;

  try {
    if (clearAction) {
      await BooksRepository.setReferencePages(book.id, null, null);
    } else if (newValue !== book.reference_pages) {
      await BooksRepository.setReferencePages(book.id, newValue, 'manual');
    }
    // same-value no-op intentionally writes nothing (D-12)
    res.status(200).json({ message: 'Reference pages updated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update reference pages' });
  }
});

/**
 * Phase 5 Plan 01 (EDIT-01, EDIT-02): manual metadata edit.
 * Zod-validates the body at the boundary; applyManualEdit is transactional
 * and stamps *_source='manual' for every touched field.
 */
router.patch('/:bookId/metadata', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;

  const parsed = metadataPatchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const updated = await applyManualEdit(book, parsed.data);
    res.status(200).json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update book metadata' });
  }
});

/**
 * Phase 5 Plan 02 (EDIT-03): manual re-enrichment trigger.
 * Thin 202 wrapper that enqueues via the enrichment service. Returns the current
 * open enrichment_job for the book, or the most recent terminal row if
 * there is no open job (D-11). Never waits for the worker.
 */
router.post('/:bookId/re-enrich', getBookById, async (req: Request, res: Response) => {
  const book = req.book!;

  try {
    await enrichmentService.enqueue(book.md5, { force: true });

    // Pitfall 5: prefer the open job (pending/running); fall back to the most
    // recent terminal row. If the book has never been enriched, return null.
    const openJob = await db('enrichment_job')
      .where({ book_md5: book.md5 })
      .whereIn('status', ['pending', 'running'])
      .orderBy('id', 'desc')
      .first();

    const job =
      openJob ??
      (await db('enrichment_job')
        .where({ book_md5: book.md5 })
        .orderBy('id', 'desc')
        .first()) ??
      null;

    res.status(202).json({ job });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to enqueue re-enrichment' });
  }
});

export { router as booksRouter };
