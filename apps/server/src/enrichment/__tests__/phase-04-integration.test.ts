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
import searchFixture from './fixtures/search-ender.json';
import wikidataFixture from './fixtures/wikidata-ender.json';
import workFixture from './fixtures/work-ender.json';

// Phase 4 Plan 06: end-to-end integration test. One describe per Phase 4 success
// criterion (SC-1, SC-3, SC-4, SC-5 parts 1 and 2). The full pipeline is driven
// by enrichmentService.enqueue plus a worker tick; HTTP is stubbed globally via
// fetch so the Plan 01 fixture JSONs flow through typed-fetch + Zod parsers,
// matcher, applier, and the Phase 1 schema.
//
// Execution model (per 04-PATTERNS Pitfall 4 + phase-04-worker.test.ts):
//   useFakeTimers -> startEnrichmentWorker -> drainMicrotasks ->
//   advanceTimersByTimeAsync(POLL + buffer) -> useRealTimers ->
//   drainMicrotasks + small real setTimeout wait.
// The real-timer tail is required because Bottleneck's limiter still awaits real
// I/O resolution after we swap back; fake timers alone cannot resolve the final
// chain of promise microtasks that follow a resolved fetch mock.

const MD5 = 'a'.repeat(32);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function buildFetchMock(overrides: {
  searchDocs?: unknown;
  workSubjects?: string[];
} = {}): ReturnType<typeof vi.fn> {
  const searchBody =
    overrides.searchDocs !== undefined
      ? { numFound: Array.isArray(overrides.searchDocs) ? overrides.searchDocs.length : 0, docs: overrides.searchDocs }
      : searchFixture;
  const workBody =
    overrides.workSubjects !== undefined ? { ...workFixture, subjects: overrides.workSubjects } : workFixture;

  return vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('/search.json')) return jsonResponse(searchBody);
    if (url.includes('/works/')) return jsonResponse(workBody);
    if (url.includes('/books/')) return jsonResponse(editionFixture);
    if (url.includes('/authors/')) return jsonResponse(authorFixture);
    // Wikidata EntityData URLs look like https://www.wikidata.org/wiki/Special:EntityData/Q185546.json
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

// Advances fake timers enough to trigger one poll interval, then swaps to real
// timers so the tail of the promise chain (fetch mock resolution, Zod parsing,
// knex writes) can settle. The sharedHttpLimiter's minTime is neutralized in
// beforeEach so real-timer settling is short.
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
  // Let crash-recovery sweep settle. The sweep is a knex call, not a timer.
  await drainMicrotasks();
  return worker;
}

describe('Phase 4 end-to-end integration', () => {
  beforeEach(async () => {
    await seedGenres();
    // Neutralize the module-level Bottleneck limiter for deterministic fake-timer
    // behavior. The limiter's minTime=1000ms spacing interacts poorly with cross-
    // test state and fake timers. Tests for rate-limiting behavior itself live in
    // phase-03-shared-limiter.test.ts.
    sharedHttpLimiter.updateSettings({ minTime: 0, maxConcurrent: 10 });
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('SC-1: sync enqueue -> worker tick -> enriched', () => {
    it('runs the full pipeline end-to-end and flips book + job to success states', async () => {
      vi.stubGlobal('fetch', buildFetchMock());

      await createBook(db, {
        md5: MD5,
        title: "Ender's Game",
        authors: 'Orson Scott Card',
        enrichment_status: 'pending',
      });

      await enrichmentService.enqueue(MD5);
      const pending = await db('enrichment_job').where({ book_md5: MD5 });
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe('pending');

      vi.useFakeTimers({ shouldAdvanceTime: false });
      const worker = await startWorkerReady();
      await runOneTick();

      const book = await db('book').where({ md5: MD5 }).first();
      expect(book.enrichment_status).toBe('enriched');
      expect(book.openlibrary_work_key).toBe('/works/OL27448W');
      expect(book.publication_year).toBe(1985);

      const bookAuthors = await db('book_author').where({ book_md5: MD5 });
      expect(bookAuthors.length).toBeGreaterThanOrEqual(1);

      const bookGenres = await db('book_genre').where({ book_md5: MD5 });
      expect(bookGenres.length).toBeGreaterThanOrEqual(1);
      // Fixture work subjects include "Science fiction" and "Children's stories"
      // (which aliases to "Children's Fiction"); both are canonical -> both map.
      const genreNames = (
        await db('genre')
          .whereIn(
            'id',
            bookGenres.map((r) => r.genre_id)
          )
          .pluck('name')
      ).sort();
      expect(genreNames).toContain('Science Fiction');

      const job = await db('enrichment_job').where({ book_md5: MD5 }).first();
      expect(job.status).toBe('succeeded');

      await worker.stop();
    });
  });

  describe('SC-3: idempotent re-run produces identical DB state', () => {
    it('deep-equals book + book_author + book_genre across two enrichment passes', async () => {
      vi.stubGlobal('fetch', buildFetchMock());

      await createBook(db, {
        md5: MD5,
        title: "Ender's Game",
        authors: 'Orson Scott Card',
        enrichment_status: 'pending',
      });

      // Pass 1
      await enrichmentService.enqueue(MD5);
      vi.useFakeTimers({ shouldAdvanceTime: false });
      let worker = await startWorkerReady();
      await runOneTick();
      await worker.stop();

      const snapshot = async () => {
        const book = (await db('book')
          .where({ md5: MD5 })
          .select(
            'md5',
            'title',
            'enrichment_status',
            'openlibrary_work_key',
            'publication_year',
            'original_language',
            'authors_source',
            'genres_source',
            'publication_year_source',
            'original_language_source'
          )
          .first()) as Record<string, unknown>;
        const authors = await db('book_author')
          .where({ book_md5: MD5 })
          .orderBy('position', 'asc')
          .select('author_id', 'position', 'role');
        const genreIds = (await db('book_genre').where({ book_md5: MD5 }).pluck('genre_id'))
          .slice()
          .sort((a, b) => a - b);
        return { book, authors, genreIds };
      };

      const firstSnap = await snapshot();

      // Simulate a Phase-5 explicit re-enrich path by re-seeding the job. Phase 4
      // service.enqueue would no-op against enrichment_status='enriched' (D-07),
      // so we flip the book back to 'pending' and enqueue again.
      await db('book').where({ md5: MD5 }).update({ enrichment_status: 'pending' });
      await enrichmentService.enqueue(MD5);
      const reenqueued = await db('enrichment_job')
        .where({ book_md5: MD5, status: 'pending' })
        .first();
      expect(reenqueued).toBeTruthy();

      vi.useFakeTimers({ shouldAdvanceTime: false });
      worker = await startWorkerReady();
      await runOneTick();
      await worker.stop();

      const secondSnap = await snapshot();

      expect(secondSnap.book).toEqual(firstSnap.book);
      expect(secondSnap.authors).toEqual(firstSnap.authors);
      expect(secondSnap.genreIds).toEqual(firstSnap.genreIds);
    });
  });

  describe('SC-4: manual-wins survives re-enrichment', () => {
    it('leaves book_genre untouched when genres_source=manual, even with different subjects', async () => {
      // Fixture's work subjects mapped -> Science Fiction + Children's Fiction.
      // Override to return ONLY "Fantasy"; if manual-wins breaks, book_genre would
      // switch from the pre-seeded Fantasy to Fantasy anyway (masking the break).
      // Solution: pre-seed with Fantasy and stub subjects -> Science Fiction, so
      // a break would flip the row to the Science Fiction id.
      vi.stubGlobal('fetch', buildFetchMock({ workSubjects: ['Science Fiction'] }));

      await createBook(db, {
        md5: MD5,
        title: "Ender's Game",
        authors: 'Orson Scott Card',
        enrichment_status: 'pending',
        genres_source: 'manual',
      });
      const fantasy = await db('genre').where({ name: 'Fantasy' }).first();
      expect(fantasy).toBeTruthy();
      await db('book_genre').insert({ book_md5: MD5, genre_id: fantasy.id });

      await enrichmentService.enqueue(MD5);
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const worker = await startWorkerReady();
      await runOneTick();
      await worker.stop();

      const book = await db('book').where({ md5: MD5 }).first();
      expect(book.enrichment_status).toBe('enriched');
      expect(book.genres_source).toBe('manual');

      const bookGenres = await db('book_genre').where({ book_md5: MD5 });
      expect(bookGenres).toHaveLength(1);
      expect(bookGenres[0].genre_id).toBe(fantasy.id);
    });
  });

  describe('SC-5 part 1: crash-recovery sweep on worker start', () => {
    it('resets a stuck running job to pending on startup and then processes it', async () => {
      vi.stubGlobal('fetch', buildFetchMock());

      await createBook(db, {
        md5: MD5,
        title: "Ender's Game",
        authors: 'Orson Scott Card',
        enrichment_status: 'pending',
      });
      const [row] = await db('enrichment_job')
        .insert({ book_md5: MD5, status: 'running', attempts: 1 })
        .returning('id');
      const jobId = typeof row === 'object' ? row.id : row;

      // Install fake timers BEFORE starting the worker so the first tick's
      // setTimeout is captured by the fake timer queue. The crash-recovery
      // sweep is a knex call (not a timer) and resolves during drainMicrotasks.
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const worker = startEnrichmentWorker(db);
      await drainMicrotasks();

      const afterSweep = await db('enrichment_job').where({ id: jobId }).first();
      expect(afterSweep.status).toBe('pending');

      // Drive the tick that processes the reclaimed job.
      await runOneTick();

      const afterTick = await db('enrichment_job').where({ id: jobId }).first();
      expect(afterTick.status).toBe('succeeded');
      const book = await db('book').where({ md5: MD5 }).first();
      expect(book.enrichment_status).toBe('enriched');

      await worker.stop();
    });
  });

  describe('SC-5 part 3 + ENRICH-07: no-match terminal failure', () => {
    it('flips book.enrichment_status and enrichment_job.status to failed with last_error', async () => {
      // Override search to return zero docs so matcher yields null and the
      // worker calls markTerminalFailure directly.
      vi.stubGlobal('fetch', buildFetchMock({ searchDocs: [] }));

      await createBook(db, {
        md5: MD5,
        title: "Ender's Game",
        authors: 'Orson Scott Card',
        enrichment_status: 'pending',
      });

      await enrichmentService.enqueue(MD5);
      vi.useFakeTimers({ shouldAdvanceTime: false });
      const worker = await startWorkerReady();
      await runOneTick();

      const job = await db('enrichment_job').where({ book_md5: MD5 }).first();
      expect(job.status).toBe('failed');
      expect(job.last_error).toBeTruthy();
      expect(String(job.last_error)).toContain('no-match');

      const book = await db('book').where({ md5: MD5 }).first();
      expect(book.enrichment_status).toBe('failed');

      await worker.stop();
    });
  });
});
