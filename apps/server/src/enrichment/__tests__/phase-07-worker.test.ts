import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { enrichmentService } from '../service';
import { ENRICHMENT_POLL_INTERVAL_MS } from '../constants';
import { sharedHttpLimiter } from '../http/rate-limiter';
import { startEnrichmentWorker, type EnrichmentWorker } from '../worker';
import authorFixture from './fixtures/author-ender.json';
import editionFixture from './fixtures/edition-ender.json';
import editionNoPagesFixture from './fixtures/edition-no-pages.json';
import searchFixture from './fixtures/search-ender.json';
import searchWithEditionKeyFixture from './fixtures/search-ender-with-edition-key.json';
import wikidataFixture from './fixtures/wikidata-ender.json';
import workFixture from './fixtures/work-ender.json';

// Phase 7 Plan 03 Task 2: end-to-end worker integration covering Edition fetch
// for reference_pages enrichment. Mirrors the harness from phase-04-integration:
// fake timers, fetch stubbed globally, runOneTick.

const MD5 = 'a'.repeat(32);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface FetchOverrides {
  searchBody?: unknown;
  editionBody?: unknown;
  editionStatus?: number;
  onEditionFetch?: () => void;
}

function buildFetchMock(overrides: FetchOverrides = {}): ReturnType<typeof vi.fn> {
  const searchBody = overrides.searchBody ?? searchWithEditionKeyFixture;
  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/search.json')) return jsonResponse(searchBody);
    if (url.includes('/works/') && url.includes('/editions.json')) {
      return jsonResponse({ entries: [{ key: '/books/OL7641985M' }] });
    }
    if (url.includes('/works/')) return jsonResponse(workFixture);
    if (url.includes('/books/')) {
      overrides.onEditionFetch?.();
      const status = overrides.editionStatus ?? 200;
      if (status === 404) return new Response('Not Found', { status: 404 });
      return jsonResponse(overrides.editionBody ?? editionFixture, status);
    }
    if (url.includes('/authors/')) return jsonResponse(authorFixture);
    if (url.includes('wikidata.org')) return jsonResponse(wikidataFixture);
    throw new Error('unexpected fetch url: ' + url);
  });
}

async function seedGenres(): Promise<void> {
  await db('genre')
    .insert(CANONICAL_GENRES.map((name) => ({ name })))
    .onConflict('name')
    .ignore();
}

async function drainMicrotasks(iterations = 20): Promise<void> {
  for (let i = 0; i < iterations; i += 1) {
    await Promise.resolve();
  }
}

async function runOneTick(): Promise<void> {
  await drainMicrotasks();
  await vi.advanceTimersByTimeAsync(ENRICHMENT_POLL_INTERVAL_MS + 50);
  vi.useRealTimers();
  await drainMicrotasks();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await drainMicrotasks();
}

async function startWorkerReady(): Promise<EnrichmentWorker> {
  const worker = startEnrichmentWorker(db);
  await drainMicrotasks();
  return worker;
}

describe('Phase 7 worker: Edition fetch + reference_pages provenance', () => {
  beforeEach(async () => {
    await seedGenres();
    sharedHttpLimiter.updateSettings({ minTime: 0, maxConcurrent: 10 });
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('case 1: search has cover_edition_key, edition has number_of_pages -> writes 352/openlibrary', async () => {
    vi.stubGlobal('fetch', buildFetchMock());

    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
      reference_pages: null,
      reference_pages_source: null,
    });

    await enrichmentService.enqueue(MD5);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = await startWorkerReady();
    await runOneTick();

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('enriched');
    expect(book.reference_pages).toBe(352);
    expect(book.reference_pages_source).toBe('openlibrary');

    await worker.stop();
  });

  it('case 2: search has NO cover_edition_key -> no edition fetch, NULL/NULL', async () => {
    let editionFetched = false;
    vi.stubGlobal(
      'fetch',
      buildFetchMock({
        searchBody: searchFixture, // no cover_edition_key
        onEditionFetch: () => {
          editionFetched = true;
        },
      })
    );

    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
      reference_pages: null,
      reference_pages_source: null,
    });

    await enrichmentService.enqueue(MD5);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = await startWorkerReady();
    await runOneTick();

    expect(editionFetched).toBe(false);

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('enriched');
    expect(book.reference_pages).toBeNull();
    expect(book.reference_pages_source).toBeNull();

    await worker.stop();
  });

  it('case 3: edition has no number_of_pages -> NULL/NULL', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ editionBody: editionNoPagesFixture }));

    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
      reference_pages: null,
      reference_pages_source: null,
    });

    await enrichmentService.enqueue(MD5);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = await startWorkerReady();
    await runOneTick();

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('enriched');
    expect(book.reference_pages).toBeNull();
    expect(book.reference_pages_source).toBeNull();

    await worker.stop();
  });

  it('case 4: edition fetch 404 -> book flips to failed (D-05)', async () => {
    vi.stubGlobal('fetch', buildFetchMock({ editionStatus: 404 }));

    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
      reference_pages: null,
      reference_pages_source: null,
    });

    await enrichmentService.enqueue(MD5);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = await startWorkerReady();
    await runOneTick();

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('failed');

    await worker.stop();
  });

  it('case 5: manual reference_pages sticky end-to-end (320/manual remains after enrichment with 352)', async () => {
    vi.stubGlobal('fetch', buildFetchMock());

    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
      reference_pages: 320,
      reference_pages_source: 'manual',
    });

    await enrichmentService.enqueue(MD5);
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = await startWorkerReady();
    await runOneTick();

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('enriched');
    expect(book.reference_pages).toBe(320);
    expect(book.reference_pages_source).toBe('manual');

    await worker.stop();
  });
});
