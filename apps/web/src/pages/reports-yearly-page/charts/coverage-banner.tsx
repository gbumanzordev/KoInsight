import { Text } from '@mantine/core';
import { JSX } from 'react';

// Phase 6 Plan 07 (REPORT-UI-04): per-chart coverage banner. The denominator
// MUST come from response.coverage (NOT recomputed from bar heights) per the
// research anti-pattern note.

export function CoverageBanner({
  known,
  total,
  label,
}: {
  known: number;
  total: number;
  label: string;
}): JSX.Element {
  const pct = total > 0 ? Math.round((known / total) * 100) : 0;
  return (
    <Text size="xs" c="dimmed" mt="xs">
      {label} known for {known} of {total} books read this year ({pct}%)
    </Text>
  );
}
