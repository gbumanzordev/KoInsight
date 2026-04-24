import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBook } from '../../db/factories/book-factory';
import { db } from '../../knex';
import { openLibraryClient } from '../../open-library/open-library-client';
import { wikidataClient } from '../wikidata/wikidata-client';
import { ENRICHMENT_MAX_ATTEMPTS, ENRICHMENT_POLL_INTERVAL_MS } from '../constants';
import { startEnrichmentWorker } from '../worker';
import { NotFoundError, UpstreamServerError } from '../http/http-errors';
import { CANONICAL_GENRES } from '@koinsight/common/dist/genres/canonical.js';

// Phase 4 Plan 05 Task 1: worker polling loop, claim, processJob, crash-recovery,
// retry scheduling, graceful shutdown.

const MD5 = 'a'.repeat(32);

async function seedGenres(): Promise<void> {
  await db('genre')
    .insert(CANONICAL_GENRES.map((name) => ({ name })))
    .onConflict('name')
    .ignore();
}

async function insertJob(
  bookMd5: string,
  overrides: Partial<{
    status: string;
    attempts: number;
    next_attempt_at: string | null;
    last_error: string | null;
  }> = {}
): Promise<number> {
  const [row] = await db('enrichment_job')
    .insert({ book_md5: bookMd5, status: 'pending', ...overrides })
    .returning('id');
  return typeof row === 'object' ? row.id : row;
}

// Fixture helpers matching shapes validated by open-library-schemas.ts.
function stubSearchOk() {
  return vi.spyOn(openLibraryClient, 'searchWork').mockResolvedValue({
    numFound: 1,
    docs: [
      {
        key: '/works/OL27448W',
        title: "Ender's Game",
        author_name: ['Orson Scott Card'],
        author_key: ['OL27695A'],
        first_publish_year: 1985,
      },
    ],
  });
}
function stubWorkOk() {
  return vi.spyOn(openLibraryClient, 'getWork').mockResolvedValue({
    key: '/works/OL27448W',
    title: "Ender's Game",
    subjects: ['Science fiction', 'Space Opera'],
    authors: [{ author: { key: '/authors/OL27695A' } }],
    first_publish_date: '1985',
  });
}
function stubAuthorOk() {
  return vi.spyOn(openLibraryClient, 'getAuthor').mockResolvedValue({
    key: '/authors/OL27695A',
    name: 'Orson Scott Card',
    remote_ids: { wikidata: 'Q185546' },
  });
}
function stubWdOk() {
  return vi.spyOn(wikidataClient, 'resolveP27Nationality').mockResolvedValue('US');
}

async function drainMicrotasks() {
  for (let i = 0; i < 20; i += 1) {
    await Promise.resolve();
  }
}

describe('startEnrichmentWorker', () => {
  beforeEach(async () => {
    await seedGenres();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('crash recovery (D-05): resets status=running rows to pending before first tick', async () => {
    await createBook(db, { md5: MD5, enrichment_status: 'pending' });
    const jobId = await insertJob(MD5, { status: 'running', attempts: 1 });

    const worker = startEnrichmentWorker(db);
    // Wait for ready sweep to settle.
    await drainMicrotasks();

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('pending');

    await worker.stop();
  });

  it('idle tick: does nothing when no pending jobs exist', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = startEnrichmentWorker(db);
    await drainMicrotasks();
    await vi.advanceTimersByTimeAsync(ENRICHMENT_POLL_INTERVAL_MS * 3);
    await drainMicrotasks();
    const jobs = await db('enrichment_job');
    expect(jobs).toHaveLength(0);
    await worker.stop();
  });

  it('happy path: claim + processJob flips book to enriched, job to succeeded', async () => {
    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
    });
    const jobId = await insertJob(MD5);

    stubSearchOk();
    stubWorkOk();
    stubAuthorOk();
    stubWdOk();

    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = startEnrichmentWorker(db);
    await drainMicrotasks();
    await vi.advanceTimersByTimeAsync(ENRICHMENT_POLL_INTERVAL_MS + 50);
    // let job processing settle
    vi.useRealTimers();
    await drainMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('enriched');
    expect(book.openlibrary_work_key).toBe('/works/OL27448W');

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('succeeded');

    await worker.stop();
  });

  it('retryable failure with attempts=1: schedules next_attempt_at, keeps pending', async () => {
    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
    });
    const jobId = await insertJob(MD5);

    vi.spyOn(openLibraryClient, 'searchWork').mockRejectedValue(
      new UpstreamServerError('https://openlibrary.org/search.json', 503)
    );

    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = startEnrichmentWorker(db);
    await drainMicrotasks();
    await vi.advanceTimersByTimeAsync(ENRICHMENT_POLL_INTERVAL_MS + 50);
    vi.useRealTimers();
    await drainMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1);
    expect(job.next_attempt_at).toBeTruthy();
    expect(job.last_error).toBeTruthy();

    await worker.stop();
  });

  it('retryable failure at ceiling: flips job.failed + book.failed via markTerminalFailure', async () => {
    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
    });
    const jobId = await insertJob(MD5, { attempts: ENRICHMENT_MAX_ATTEMPTS - 1 });

    vi.spyOn(openLibraryClient, 'searchWork').mockRejectedValue(
      new UpstreamServerError('https://openlibrary.org/search.json', 503)
    );

    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = startEnrichmentWorker(db);
    await drainMicrotasks();
    await vi.advanceTimersByTimeAsync(ENRICHMENT_POLL_INTERVAL_MS + 50);
    vi.useRealTimers();
    await drainMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('failed');
    expect(job.last_error).toBeTruthy();

    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('failed');

    await worker.stop();
  });

  it('permanent failure (no-match): markTerminalFailure regardless of attempts', async () => {
    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
    });
    const jobId = await insertJob(MD5);

    vi.spyOn(openLibraryClient, 'searchWork').mockResolvedValue({ numFound: 0, docs: [] });

    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = startEnrichmentWorker(db);
    await drainMicrotasks();
    await vi.advanceTimersByTimeAsync(ENRICHMENT_POLL_INTERVAL_MS + 50);
    vi.useRealTimers();
    await drainMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('failed');
    expect(job.attempts).toBe(1);
    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('failed');

    await worker.stop();
  });

  it('permanent failure (/works/ 404): markTerminalFailure invoked', async () => {
    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
    });
    const jobId = await insertJob(MD5);

    stubSearchOk();
    vi.spyOn(openLibraryClient, 'getWork').mockRejectedValue(
      new NotFoundError('https://openlibrary.org/works/OL27448W.json')
    );

    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = startEnrichmentWorker(db);
    await drainMicrotasks();
    await vi.advanceTimersByTimeAsync(ENRICHMENT_POLL_INTERVAL_MS + 50);
    vi.useRealTimers();
    await drainMicrotasks();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('failed');
    const book = await db('book').where({ md5: MD5 }).first();
    expect(book.enrichment_status).toBe('failed');

    await worker.stop();
  });

  it('graceful shutdown: stop() awaits in-flight processJob and schedules no more ticks', async () => {
    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
    });
    await insertJob(MD5);

    let resolveSearch: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveSearch = resolve;
    });
    vi.spyOn(openLibraryClient, 'searchWork').mockImplementation(
      () => pending as Promise<never>
    );

    const worker = startEnrichmentWorker(db);
    // Wait long enough for first tick to fire and processJob to begin.
    await new Promise((resolve) => setTimeout(resolve, ENRICHMENT_POLL_INTERVAL_MS + 50));

    const stopPromise = worker.stop();
    // Resolve the in-flight searchWork so the tick unwinds.
    resolveSearch({ numFound: 0, docs: [] });
    await stopPromise;

    // After stop resolves, no further state changes should occur even if time passes.
    const snap = await db('enrichment_job').first();
    await new Promise((resolve) => setTimeout(resolve, ENRICHMENT_POLL_INTERVAL_MS * 2));
    const snap2 = await db('enrichment_job').first();
    expect(snap2.status).toBe(snap.status);
  }, 15000);

  it('next_attempt_at gating: a future-scheduled job is not claimed', async () => {
    await createBook(db, {
      md5: MD5,
      title: "Ender's Game",
      authors: 'Orson Scott Card',
      enrichment_status: 'pending',
    });
    const future = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const jobId = await insertJob(MD5, { next_attempt_at: future, attempts: 1 });

    const searchSpy = vi.spyOn(openLibraryClient, 'searchWork');

    vi.useFakeTimers({ shouldAdvanceTime: false });
    const worker = startEnrichmentWorker(db);
    await drainMicrotasks();
    await vi.advanceTimersByTimeAsync(ENRICHMENT_POLL_INTERVAL_MS * 3);
    vi.useRealTimers();
    await drainMicrotasks();

    expect(searchSpy).not.toHaveBeenCalled();
    const job = await db('enrichment_job').where({ id: jobId }).first();
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(1); // never claimed, counter unchanged

    await worker.stop();
  });

  it('reference-equality invariant: openLibraryClient singleton stable across import paths', async () => {
    const again = await import('../../open-library/open-library-client');
    expect(openLibraryClient).toBe(again.openLibraryClient);
    const wdAgain = await import('../wikidata/wikidata-client');
    expect(wikidataClient).toBe(wdAgain.wikidataClient);
  });
});
