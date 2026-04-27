import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { db } from '../knex';
import { enqueueMany } from './service';
import { getEnrichmentStatusCounts, getUnmatchedBooks } from './unmatched-repository';

// Phase 5 Plan 03: enrichment router exposing the two read endpoints the
// Settings > Unmatched UI needs.
//
// - GET /unmatched: paginated list of books that failed enrichment (EDIT-04).
// - GET /status: { pending, running, enriched, failed, skipped } counters
//   that drive the Settings nav badge + stat cards (EDIT-05).
//
// Zod-at-the-boundary per CLAUDE.md: query params are coerced + validated
// before any DB call; oversized limits and negative offsets are rejected
// with 400 (T-05-12, T-05-13 mitigations).

const router = Router();

const unmatchedQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/unmatched', async (req: Request, res: Response) => {
  const parsed = unmatchedQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const { offset, limit } = parsed.data;
  try {
    const { rows, total } = await getUnmatchedBooks(offset, limit);
    res.status(200).json({ rows, total, offset, limit });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load unmatched books' });
  }
});

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const counts = await getEnrichmentStatusCounts();
    res.status(200).json(counts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load enrichment status' });
  }
});

// Phase 8 RETRY-01 / CD-2: bulk re-enqueue every book with
// enrichment_status='failed'. Body schema is z.object({...}).strict() per
// T-08-03 mitigation: unknown keys and non-boolean `force` are rejected with
// 400. enqueueMany is invoked with force=true so the failed -> pending status
// flip is permitted (Open Q4); enqueueMany itself returns
// { enqueued, skipped } verbatim.
const retryAllBodySchema = z
  .object({
    force: z.boolean().optional(),
  })
  .strict();

router.post('/retry-all', async (req: Request, res: Response) => {
  const parsed = retryAllBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const failedRows = await db('book')
      .where({ enrichment_status: 'failed' })
      .select<Array<{ md5: string }>>('md5');
    const failedMd5s = failedRows.map((r) => r.md5);
    const result = await enqueueMany(failedMd5s, { force: true });
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to enqueue retries' });
  }
});

export { router as enrichmentRouter };
