import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { sharedHttpLimiter } from '../http/rate-limiter';
import { runReferencePagesBackfill } from '../backfill-reference-pages';

// Phase 7 Plan 04 Task 2: backfill script integration tests.
//
// D-08 predicate: enriched + reference_pages IS NULL + source != 'manual' + work key set.
// D-09 option b: getWorkEditions -> first edition -> getEdition -> number_of_pages.
// D-10: errored rows do NOT flip enrichment_status; the script keeps going and exits 0.
// D-11: idempotent re-run; books already populated by a prior run are excluded.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('runReferencePagesBackfill (Phase 7 Plan 04)', () => {
  beforeEach(() => {
    // Neutralize the shared limiter so the test suite is fast and deterministic.
    sharedHttpLimiter.updateSettings({ minTime: 0, maxConcurrent: 10 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('populates only D-08 candidates: skips manual-source rows, leaves no_pages rows NULL', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/works/OL_A/editions.json')) {
        return jsonResponse({ entries: [{ key: '/books/OL_A_E1' }] });
      }
      if (url.includes('/works/OL_B/editions.json')) {
        return jsonResponse({ entries: [{ key: '/books/OL_B_E1' }] });
      }
      if (url.includes('/books/OL_A_E1.json')) {
        return jsonResponse({
          key: '/books/OL_A_E1',
          works: [{ key: '/works/OL_A' }],
          number_of_pages: 256,
        });
      }
      if (url.includes('/books/OL_B_E1.json')) {
        return jsonResponse({
          key: '/books/OL_B_E1',
          works: [{ key: '/works/OL_B' }],
          // no number_of_pages
        });
      }
      throw new Error('unexpected fetch url: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const bookA = await createBook(db, {
      md5: 'a'.repeat(32),
      enrichment_status: 'enriched',
      reference_pages: null,
      reference_pages_source: null,
      openlibrary_work_key: '/works/OL_A',
    });
    const bookB = await createBook(db, {
      md5: 'b'.repeat(32),
      enrichment_status: 'enriched',
      reference_pages: null,
      reference_pages_source: null,
      openlibrary_work_key: '/works/OL_B',
    });
    const bookC = await createBook(db, {
      md5: 'c'.repeat(32),
      enrichment_status: 'enriched',
      reference_pages: 320,
      reference_pages_source: 'manual',
      openlibrary_work_key: '/works/OL_C',
    });

    const summary = await runReferencePagesBackfill(db);

    expect(summary).toEqual({ scanned: 2, populated: 1, no_pages: 1, errored: 0 });

    const a = await db('book').where({ id: bookA.id }).first();
    expect(a.reference_pages).toBe(256);
    expect(a.reference_pages_source).toBe('openlibrary');

    const b = await db('book').where({ id: bookB.id }).first();
    expect(b.reference_pages).toBeNull();
    expect(b.reference_pages_source).toBeNull();

    const c = await db('book').where({ id: bookC.id }).first();
    expect(c.reference_pages).toBe(320);
    expect(c.reference_pages_source).toBe('manual');

    // OL_C must never have been called
    const calls = fetchMock.mock.calls.map((args) => String(args[0]));
    expect(calls.some((url) => url.includes('OL_C'))).toBe(false);
  });

  it('idempotency: second run only re-scans the no_pages row, populates 0', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/works/OL_A/editions.json')) {
        return jsonResponse({ entries: [{ key: '/books/OL_A_E1' }] });
      }
      if (url.includes('/works/OL_B/editions.json')) {
        return jsonResponse({ entries: [{ key: '/books/OL_B_E1' }] });
      }
      if (url.includes('/books/OL_A_E1.json')) {
        return jsonResponse({
          key: '/books/OL_A_E1',
          works: [{ key: '/works/OL_A' }],
          number_of_pages: 256,
        });
      }
      if (url.includes('/books/OL_B_E1.json')) {
        return jsonResponse({
          key: '/books/OL_B_E1',
          works: [{ key: '/works/OL_B' }],
        });
      }
      throw new Error('unexpected fetch url: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    await createBook(db, {
      md5: 'a'.repeat(32),
      enrichment_status: 'enriched',
      reference_pages: null,
      reference_pages_source: null,
      openlibrary_work_key: '/works/OL_A',
    });
    await createBook(db, {
      md5: 'b'.repeat(32),
      enrichment_status: 'enriched',
      reference_pages: null,
      reference_pages_source: null,
      openlibrary_work_key: '/works/OL_B',
    });

    const first = await runReferencePagesBackfill(db);
    expect(first).toEqual({ scanned: 2, populated: 1, no_pages: 1, errored: 0 });

    const second = await runReferencePagesBackfill(db);
    // A is now populated (source openlibrary), so excluded by predicate.
    // B is still NULL with source NULL -> still scanned, still no_pages.
    expect(second).toEqual({ scanned: 1, populated: 0, no_pages: 1, errored: 0 });

    const a = await db('book').where({ md5: 'a'.repeat(32) }).first();
    expect(a.reference_pages).toBe(256);
  });

  it('skips rows whose enrichment_status is not "enriched"', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await createBook(db, {
      md5: 'd'.repeat(32),
      enrichment_status: 'pending',
      reference_pages: null,
      reference_pages_source: null,
      openlibrary_work_key: '/works/OL_D',
    });

    const summary = await runReferencePagesBackfill(db);
    expect(summary).toEqual({ scanned: 0, populated: 0, no_pages: 0, errored: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('error path: thrown fetch increments errored, does NOT flip enrichment_status, continues', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/works/OL_E/editions.json')) {
        throw new Error('network down');
      }
      if (url.includes('/works/OL_F/editions.json')) {
        return jsonResponse({ entries: [{ key: '/books/OL_F_E1' }] });
      }
      if (url.includes('/books/OL_F_E1.json')) {
        return jsonResponse({
          key: '/books/OL_F_E1',
          works: [{ key: '/works/OL_F' }],
          number_of_pages: 100,
        });
      }
      throw new Error('unexpected fetch url: ' + url);
    });
    vi.stubGlobal('fetch', fetchMock);

    const bookE = await createBook(db, {
      md5: 'e'.repeat(32),
      enrichment_status: 'enriched',
      reference_pages: null,
      reference_pages_source: null,
      openlibrary_work_key: '/works/OL_E',
    });
    const bookF = await createBook(db, {
      md5: 'f'.repeat(32),
      enrichment_status: 'enriched',
      reference_pages: null,
      reference_pages_source: null,
      openlibrary_work_key: '/works/OL_F',
    });

    const summary = await runReferencePagesBackfill(db);
    expect(summary.errored).toBe(1);
    expect(summary.populated).toBe(1);
    expect(summary.scanned).toBe(2);

    const e = await db('book').where({ id: bookE.id }).first();
    // D-10: status remains enriched, do not flip to failed
    expect(e.enrichment_status).toBe('enriched');
    expect(e.reference_pages).toBeNull();

    const f = await db('book').where({ id: bookF.id }).first();
    expect(f.reference_pages).toBe(100);
    expect(f.reference_pages_source).toBe('openlibrary');
  });
});
