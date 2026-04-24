import { Request, Response, Router } from 'express';
import { z } from 'zod';
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

export { router as enrichmentRouter };
