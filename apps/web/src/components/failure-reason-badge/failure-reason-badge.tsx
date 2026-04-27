import type { FailureReason } from '@koinsight/common/types/enrichment';
import { Badge, Tooltip } from '@mantine/core';
import { JSX } from 'react';

import './failure-reason-badge.module.css';

// Phase 8 Plan 04 (RETRY-04, T-08-02): pure presentational badge surfacing the
// structured failure reason for a failed book. UI-SPEC §"Failure Reason
// Vocabulary" locks every label, color, variant, and tooltip verbatim. The
// 'unknown' entry is a UI-only fallback for NULL or unrecognized server values
// (defensive lookup, no string concat from server-controlled values into JSX).

type ReasonKey = FailureReason | 'unknown';

type ReasonConfig = {
  label: string;
  color: string;
  variant: 'light' | 'outline';
  tooltip: string;
};

const FAILURE_REASON_MAP: Record<ReasonKey, ReasonConfig> = {
  no_match: {
    label: 'No match',
    color: 'gray',
    variant: 'light',
    tooltip:
      'OpenLibrary has no candidate for this title and author. Edit metadata manually.',
  },
  ambiguous_match: {
    label: 'Ambiguous',
    color: 'yellow',
    variant: 'light',
    tooltip:
      'Multiple OpenLibrary candidates matched. Open the book and pick the right one manually.',
  },
  network: {
    label: 'Network',
    color: 'blue',
    variant: 'light',
    tooltip: 'OpenLibrary was unreachable. Retrying usually fixes this.',
  },
  parse_error: {
    label: 'Parse error',
    color: 'orange',
    variant: 'light',
    tooltip:
      'OpenLibrary returned data we could not read. Retry; if it persists, this is a bug.',
  },
  unknown: {
    label: 'Unknown',
    color: 'gray',
    variant: 'outline',
    tooltip:
      'This failure was logged before structured reasons existed. Retry to refresh it.',
  },
};

export type FailureReasonBadgeProps = {
  reason: FailureReason | null;
};

export function FailureReasonBadge({ reason }: FailureReasonBadgeProps): JSX.Element {
  // Closed lookup with defensive fallback (T-08-02): unrecognized server
  // values render the safe 'Unknown' entry; we never concat `reason` into JSX.
  const cfg = FAILURE_REASON_MAP[reason ?? 'unknown'] ?? FAILURE_REASON_MAP.unknown;

  return (
    <Tooltip label={cfg.tooltip}>
      <Badge
        size="sm"
        variant={cfg.variant}
        color={cfg.color}
        role="status"
        aria-label={`Failure reason: ${cfg.label}`}
      >
        {cfg.label}
      </Badge>
    </Tooltip>
  );
}
