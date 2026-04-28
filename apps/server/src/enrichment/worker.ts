import type { Knex } from 'knex';
import { ENRICHMENT_MAX_ATTEMPTS, ENRICHMENT_POLL_INTERVAL_MS } from './constants';
import { openLibraryClient } from '../open-library/open-library-client';
import { wikidataClient } from './wikidata/wikidata-client';
import { matchWork, NoMatchError } from './matcher';
import { classifyFailure, computeNextAttemptAt, truncateError } from './retry';
import { applyEnrichment, markTerminalFailure, type EnrichedBundle } from './applier';

// Phase 4 Plan 05 Task 1: polling worker.
// - D-05 crash-recovery sweep on startup.
// - D-02 + D-13 atomic UPDATE ... RETURNING * claim under SQLite 3.35+.
// - setTimeout self-chain (never setInterval).
// - Graceful shutdown awaits any in-flight job.
// - All HTTP routed through Phase 3 singletons (openLibraryClient, wikidataClient).

export interface EnrichmentWorker {
  stop(): Promise<void>;
}

interface EnrichmentJobRow {
  id: number;
  book_md5: string;
  attempts: number;
  status: string;
}

export function startEnrichmentWorker(knex: Knex): EnrichmentWorker {
  let isShuttingDown = false;
  let timerHandle: NodeJS.Timeout | null = null;
  let currentJob: Promise<void> | null = null;

  // D-05 crash recovery: reset orphaned running rows so they get retried.
  const readyPromise = knex('enrichment_job')
    .where({ status: 'running' })
    .update({ status: 'pending' })
    .then((n) => {
      if (n > 0) {
        console.log(`enrichment worker: reset ${n} running -> pending`);
      }
    });

  async function tick(): Promise<void> {
    if (isShuttingDown) return;
    try {
      currentJob = claimAndProcess(knex);
      await currentJob;
    } catch (err) {
      console.error('enrichment worker tick failed', err);
    } finally {
      currentJob = null;
    }
    if (!isShuttingDown) {
      timerHandle = setTimeout(() => {
        void tick();
      }, ENRICHMENT_POLL_INTERVAL_MS);
    }
  }

  readyPromise
    .then(() => {
      if (!isShuttingDown) {
        timerHandle = setTimeout(() => {
          void tick();
        }, ENRICHMENT_POLL_INTERVAL_MS);
      }
    })
    .catch((err) => {
      console.error('enrichment worker: crash-recovery sweep failed', err);
    });

  return {
    async stop(): Promise<void> {
      isShuttingDown = true;
      if (timerHandle) {
        clearTimeout(timerHandle);
        timerHandle = null;
      }
      // Await any in-flight job before returning.
      try {
        await readyPromise;
      } catch {
        /* already logged */
      }
      if (currentJob) {
        try {
          await currentJob;
        } catch {
          /* already logged in tick() */
        }
      }
    },
  };
}

async function claimAndProcess(knex: Knex): Promise<void> {
  // D-02 + D-13 atomic claim. SQLite 3.35+ supports UPDATE ... RETURNING.
  const raw = await knex.raw<EnrichmentJobRow[]>(
    `UPDATE enrichment_job
     SET status = 'running', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM enrichment_job
       WHERE status = 'pending'
         AND (next_attempt_at IS NULL OR next_attempt_at <= CURRENT_TIMESTAMP)
       ORDER BY created_at ASC
       LIMIT 1
     )
     RETURNING *`
  );
  const rows: EnrichmentJobRow[] = Array.isArray(raw)
    ? (raw as unknown as EnrichmentJobRow[])
    : ((raw as unknown as { rows?: EnrichmentJobRow[] }).rows ?? []);
  const job = rows[0];
  if (!job) return;

  try {
    await processJob(knex, job);
  } catch (err) {
    await scheduleRetryOrFail(knex, job, err);
  }
}

interface BookRow {
  md5: string;
  title: string;
  authors: string | null;
}

async function processJob(knex: Knex, job: EnrichmentJobRow): Promise<void> {
  const book = (await knex('book')
    .where({ md5: job.book_md5 })
    .select('md5', 'title', 'authors')
    .first()) as BookRow | undefined;
  if (!book) {
    throw new Error(`processJob: book ${job.book_md5} not found`);
  }

  const primaryAuthor = (book.authors ?? '').split(',')[0]?.trim() ?? '';
  const search = await openLibraryClient.searchWork(book.title, primaryAuthor || undefined);

  // Phase 8 D-05/D-06: matchWork now ALWAYS returns a candidate or throws
  // (NoMatchError / AmbiguousMatchError). The thrown errors are caught by
  // claimAndProcess and routed through scheduleRetryOrFail -> classifyFailure,
  // which maps them to permanent failures with the correct FailureReason.
  // Defensive guard kept so a future refactor that re-introduces a null path
  // surfaces an explicit NoMatchError instead of crashing on `.key` below.
  const candidate = matchWork(
    { title: book.title, authors: book.authors },
    search.docs ?? []
  );
  if (!candidate) {
    throw new NoMatchError();
  }

  const workKey = candidate.key;
  if (!workKey) {
    throw new Error('no work key derivable from OL candidate');
  }

  // D-04: fetch one Edition (single call through sharedHttpLimiter) to populate referencePages.
  // null when cover_edition_key absent on the candidate, or when the Edition has no positive number_of_pages.
  // 404 here propagates to claimAndProcess and classifyFailure flips the book to 'failed' (D-05 known consequence).
  const edition = candidate.cover_edition_key
    ? await openLibraryClient.getEdition(candidate.cover_edition_key)
    : null;
  const referencePages =
    edition && typeof edition.number_of_pages === 'number' && edition.number_of_pages > 0
      ? edition.number_of_pages
      : null;

  // Walk to work (OL-05 invariant: subjects live on work, not edition).
  const work = await openLibraryClient.getWork(workKey);

  // Resolve authors + nationalities.
  const enrichedAuthors: EnrichedBundle['authors'] = [];
  for (const a of work.authors ?? []) {
    const authorKey = a?.author?.key;
    if (!authorKey) continue;
    const author = await openLibraryClient.getAuthor(authorKey);
    const wikidataQid = author.remote_ids?.wikidata;
    const nationality = wikidataQid
      ? await wikidataClient.resolveP27Nationality(wikidataQid)
      : null;
    enrichedAuthors.push({
      name: author.name,
      openlibrary_key: authorKey,
      nationality,
    });
  }

  const bundle: EnrichedBundle = {
    workKey,
    publicationYear: extractPublicationYear(work, candidate as { first_publish_year?: number }),
    originalLanguage: null, // OL WorkSchema does not expose original_languages; leave null until Phase 6 widens the schema.
    authors: enrichedAuthors,
    subjects: work.subjects ?? [],
    referencePages,
  };

  await applyEnrichment(knex, job.book_md5, job.id, bundle);
}

async function scheduleRetryOrFail(
  knex: Knex,
  job: EnrichmentJobRow,
  err: unknown
): Promise<void> {
  // Phase 8 D-02 / Pitfall 5: classifyFailure now returns { class, reason };
  // thread `reason` to markTerminalFailure so book.failure_reason gets
  // persisted on every terminal failure path (RETRY-04).
  const { class: klass, reason } = classifyFailure(err);
  if (klass === 'permanent') {
    await markTerminalFailure(knex, job.id, job.book_md5, err, reason);
    return;
  }
  if (job.attempts >= ENRICHMENT_MAX_ATTEMPTS) {
    // Pitfall 6: attempts-exhausted retryable failures are persisted with the
    // `reason` from the classifier verbatim (typically 'network' for the
    // errors that reach this branch). No special re-classification.
    await markTerminalFailure(knex, job.id, job.book_md5, err, reason);
    return;
  }

  const message = err instanceof Error ? err.message : String(err);
  await knex('enrichment_job').where({ id: job.id }).update({
    status: 'pending',
    last_error: truncateError(message),
    next_attempt_at: computeNextAttemptAt(job.attempts, new Date()),
    updated_at: knex.fn.now(),
  });
}

function extractPublicationYear(
  work: { first_publish_date?: string },
  candidate: { first_publish_year?: number }
): number | null {
  if (candidate.first_publish_year && Number.isFinite(candidate.first_publish_year)) {
    return candidate.first_publish_year;
  }
  const raw = work.first_publish_date;
  if (!raw) return null;
  const match = String(raw).match(/\b(\d{4})\b/);
  return match ? Number(match[1]) : null;
}
