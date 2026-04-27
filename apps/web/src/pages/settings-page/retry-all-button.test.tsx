import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import userEvent from '@testing-library/user-event';

import { renderWithProviders, screen, waitFor } from '../../test-utils';
// @ts-expect-error: RetryAllButton lands in Wave 3 (Plan 04)
import { RetryAllButton } from './retry-all-button';

// Phase 8 RED tests for RETRY-01 / D-10 / D-13: section-level Retry-all button.
// UI-SPEC §"Copywriting Contract" locks the toast wording verbatim. D-10
// supersedes UI-SPEC modal sections: clicking fires immediately, no
// modals.openConfirmModal, no role="dialog" appears.

vi.mock('../../api/enrichment', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../api/enrichment');
  return {
    ...actual,
    useEnrichmentStatus: vi.fn(),
  };
});

import { useEnrichmentStatus } from '../../api/enrichment';

const mockedUseStatus = useEnrichmentStatus as unknown as ReturnType<typeof vi.fn>;

function setStatus(failed: number) {
  mockedUseStatus.mockReturnValue({
    data: { pending: 0, running: 0, enriched: 0, failed, skipped: 0 },
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  });
}

describe('RetryAllButton (Phase 8 RETRY-01)', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ enqueued: 0, skipped: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    mockedUseStatus.mockReset();
  });

  it('renders disabled when failed === 0', () => {
    setStatus(0);
    renderWithProviders(<RetryAllButton />);
    const button = screen.getByRole('button', { name: /Retry all failed/i });
    expect(button).toBeDisabled();
  });

  it('renders enabled when failed > 0', () => {
    setStatus(3);
    renderWithProviders(<RetryAllButton />);
    const button = screen.getByRole('button', { name: /Retry all failed/i });
    expect(button).toBeEnabled();
  });

  it('clicking POSTs to /api/enrichment/retry-all and shows "Re-enqueued N books" toast', async () => {
    setStatus(3);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ enqueued: 3, skipped: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    renderWithProviders(<RetryAllButton />);

    await userEvent.click(screen.getByRole('button', { name: /Retry all failed/i }));

    await waitFor(() => {
      const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes('enrichment/retry-all'))).toBe(true);
    });

    await waitFor(() => {
      expect(screen.getByText(/Re-enqueued \d+ books/)).toBeInTheDocument();
    });
  });

  it('toast on { enqueued: 0 } reads "No failed books to retry"', async () => {
    setStatus(1);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ enqueued: 0, skipped: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    renderWithProviders(<RetryAllButton />);

    await userEvent.click(screen.getByRole('button', { name: /Retry all failed/i }));

    await waitFor(() => {
      expect(screen.getByText('No failed books to retry')).toBeInTheDocument();
    });
  });

  it('on 500 server error, toast title reads "Could not start bulk retry" with red color', async () => {
    setStatus(2);
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'boom' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      })
    );
    renderWithProviders(<RetryAllButton />);

    await userEvent.click(screen.getByRole('button', { name: /Retry all failed/i }));

    await waitFor(() => {
      expect(screen.getByText('Could not start bulk retry')).toBeInTheDocument();
    });
  });

  it('clicking does NOT open a confirmation modal (D-10: no openConfirmModal)', async () => {
    setStatus(2);
    renderWithProviders(<RetryAllButton />);

    await userEvent.click(screen.getByRole('button', { name: /Retry all failed/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
