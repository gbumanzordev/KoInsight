// Phase 6 Plan 05: HTTP surface for the yearly-report subsystem.
//
// Two thin handlers that delegate to ReportsService and translate errors
// into stable JSON responses:
//   - GET /years           -> { years: number[] }            (REPORT-03)
//   - GET /yearly?year=Y   -> YearlyReport                   (REPORT-01)
//
// Zod-at-the-boundary per CLAUDE.md. The year query is coerced + bounded
// (1900..2200) before reaching SQL, mitigating T-06-05-01 (tampering /
// query injection via ?year=). On service errors we log the full error to
// stderr and return a generic 500 body, mitigating T-06-05-02 (information
// disclosure on error).

import { Request, Response, Router } from 'express';
import { z } from 'zod';

import { ReportsService } from './reports-service';

const router = Router();

const yearlyQuerySchema = z.object({
  year: z.coerce.number().int().min(1900).max(2200),
});

router.get('/years', async (_req: Request, res: Response) => {
  try {
    const result = await ReportsService.getYears();
    res.status(200).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load years' });
  }
});

router.get('/yearly', async (req: Request, res: Response) => {
  const parsed = yearlyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const report = await ReportsService.getYearly(parsed.data.year);
    res.status(200).json(report);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to load yearly report' });
  }
});

export { router as reportsRouter };
