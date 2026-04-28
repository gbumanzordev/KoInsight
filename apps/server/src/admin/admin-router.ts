import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../knex';
import { deleteOrphanAuthors } from './orphan-author-gc';

// D-07: body schema. `confirm` must be the exact literal 'DELETE_ORPHANS' (case-sensitive).
const orphanAuthorGcBodySchema = z.object({
  confirm: z.literal('DELETE_ORPHANS'),
  dry_run: z.boolean().optional(),
});

const router = Router();

/**
 * POST /api/admin/authors/gc
 * Phase 9 (AUTHGC-01, AUTHGC-03):
 *   - D-07: body validated by Zod; literal `confirm: 'DELETE_ORPHANS'` required.
 *   - D-08: only POST registered. Other methods naturally return 404 (Express default).
 *   - D-09: response is { deleted, dry_run, sample }; sample is [] when deleted is 0.
 *   - D-10: console.info on successful non-dry-run; console.error on caught exception (-> 500).
 *   - dry_run resolution: explicit body field wins; otherwise query ?dry_run=1 (or '1'/'true') -> true.
 */
router.post('/authors/gc', async (req: Request, res: Response) => {
  const parsed = orphanAuthorGcBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const queryDryRun = req.query.dry_run === '1' || req.query.dry_run === 'true';
  const dryRun = parsed.data.dry_run !== undefined ? parsed.data.dry_run : queryDryRun;

  try {
    const result = await deleteOrphanAuthors(db, { dryRun });
    if (!dryRun) {
      console.info('admin:orphan-author-gc', {
        deleted: result.deleted,
        sample: result.sample,
      });
    }
    res.status(200).json({
      deleted: result.deleted,
      dry_run: dryRun,
      sample: result.sample,
    });
  } catch (error) {
    console.error('admin:orphan-author-gc failed', error);
    res.status(500).json({ error: 'Failed to delete orphan authors' });
  }
});

export { router as adminRouter };
