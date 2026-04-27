import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';
import * as swr from 'swr';

import { renderWithProviders, screen, waitFor } from '../../test-utils';
import { ReEnrichButton } from './re-enrich-button';

// Phase 8 RED tests for RETRY-02 / D-14: hardened post-action handler.
// After a successful re-enrich, the button MUST invalidate three SWR keys:
//   1. `books/<id>` (existing Phase 5 behavior, preserve).
//   2. predicate match against ['enrichment/unmatched', offset, limit] (D-14).
//   3. 'enrichment/status' string key (badge counter refresh).

vi.mock('../../api/books', () => ({
  reEnrichBook: vi.fn(async () => ({ job: null })),
}));

describe('ReEnrichButton list-key mutate (Phase 8 D-14)', () => {
  let mutateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mutateSpy = vi.spyOn(swr, 'mutate');
  });

  afterEach(() => {
    mutateSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('after successful re-enrich, calls mutate("books/<id>")', async () => {
    renderWithProviders(
      <ReEnrichButton bookId={42} enrichmentStatus="failed" variant="row" />
    );

    await userEvent.click(screen.getByRole('button', { name: /Re-enrich/i }));

    await waitFor(() => {
      const calls = mutateSpy.mock.calls.map((c) => c[0]);
      expect(calls).toContain('books/42');
    });
  });

  it('after successful re-enrich, calls predicate-style mutate matching "enrichment/unmatched" tuple keys (D-14)', async () => {
    renderWithProviders(
      <ReEnrichButton bookId={42} enrichmentStatus="failed" variant="row" />
    );

    await userEvent.click(screen.getByRole('button', { name: /Re-enrich/i }));

    await waitFor(() => {
      const predicateCalls = mutateSpy.mock.calls.filter(
        (c) => typeof c[0] === 'function'
      );
      expect(predicateCalls.length).toBeGreaterThan(0);

      // Verify the predicate matches the tuple cache key shape:
      const predicate = predicateCalls[0][0] as (key: unknown) => boolean;
      expect(predicate(['enrichment/unmatched', 0, 20])).toBe(true);
      expect(predicate(['enrichment/unmatched', 40, 20])).toBe(true);
      expect(predicate(['something/else'])).toBe(false);
      expect(predicate('books/42')).toBe(false);
    });
  });

  it('after successful re-enrich, calls mutate("enrichment/status") for nav badge refresh', async () => {
    renderWithProviders(
      <ReEnrichButton bookId={42} enrichmentStatus="failed" variant="row" />
    );

    await userEvent.click(screen.getByRole('button', { name: /Re-enrich/i }));

    await waitFor(() => {
      const calls = mutateSpy.mock.calls.map((c) => c[0]);
      expect(calls).toContain('enrichment/status');
    });
  });
});
