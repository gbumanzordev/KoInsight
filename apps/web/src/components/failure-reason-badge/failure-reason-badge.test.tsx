import { describe, expect, it } from 'vitest';

import { renderWithProviders, screen } from '../../test-utils';
// @ts-expect-error: FailureReasonBadge lands in Wave 3 (Plan 04)
import { FailureReasonBadge } from './failure-reason-badge';

// Phase 8 RED tests for RETRY-04 UI: failure-reason badge.
// UI-SPEC vocabulary is locked. Server emits the lowercase enum; the badge
// renders the human label from a closed lookup map. NULL renders 'Unknown'
// with variant='outline' (D-04 / UI-SPEC §"Failure Reason Vocabulary").

describe('FailureReasonBadge (Phase 8 RETRY-04)', () => {
  it('reason="no_match" renders "No match" with role="status" and aria-label', () => {
    renderWithProviders(<FailureReasonBadge reason="no_match" />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('No match');
    expect(badge).toHaveAttribute('aria-label', 'Failure reason: No match');
  });

  it('reason="ambiguous_match" renders "Ambiguous"', () => {
    renderWithProviders(<FailureReasonBadge reason="ambiguous_match" />);
    expect(screen.getByRole('status')).toHaveTextContent('Ambiguous');
  });

  it('reason="network" renders "Network"', () => {
    renderWithProviders(<FailureReasonBadge reason="network" />);
    expect(screen.getByRole('status')).toHaveTextContent('Network');
  });

  it('reason="parse_error" renders "Parse error"', () => {
    renderWithProviders(<FailureReasonBadge reason="parse_error" />);
    expect(screen.getByRole('status')).toHaveTextContent('Parse error');
  });

  it('reason={null} renders "Unknown" with variant="outline" attribute', () => {
    renderWithProviders(<FailureReasonBadge reason={null} />);
    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('Unknown');
    // Mantine encodes variant via data-variant on the rendered element.
    expect(badge.getAttribute('data-variant')).toBe('outline');
  });

  it('aria-label always reads "Failure reason: <label>"', () => {
    renderWithProviders(<FailureReasonBadge reason="ambiguous_match" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Failure reason: Ambiguous'
    );
  });
});
