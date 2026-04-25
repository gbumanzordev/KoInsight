import { FieldSource } from '@koinsight/common/types';
import { Badge } from '@mantine/core';
import { JSX } from 'react';

import './provenance-badge.module.css';

// Phase 5 Plan 04 (UI-02, D-15): pure presentational badge surfacing the
// `*_source` provenance for an editable field. NULL / undefined source renders
// nothing (no "unset" placeholder per the locked UI spec).
export type ProvenanceBadgeProps = {
  source: FieldSource | null | undefined;
  fieldName?: string;
};

export function ProvenanceBadge({ source, fieldName }: ProvenanceBadgeProps): JSX.Element | null {
  if (source !== 'manual' && source !== 'openlibrary') {
    return null;
  }

  if (source === 'manual') {
    return (
      <Badge
        color="yellow"
        variant="light"
        size="sm"
        role="status"
        aria-label={`${fieldName ?? 'Field'} is manual`}
      >
        manual
      </Badge>
    );
  }

  return (
    <Badge
      color="blue"
      variant="light"
      size="sm"
      role="status"
      aria-label={`${fieldName ?? 'Field'} is OpenLibrary`}
    >
      OpenLibrary
    </Badge>
  );
}
