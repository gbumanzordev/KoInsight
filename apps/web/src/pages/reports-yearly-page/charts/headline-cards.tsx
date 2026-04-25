import type { YearlyReport } from '@koinsight/common/types/reports-api';
import { Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { JSX } from 'react';
import { formatSecondsToHumanReadable } from '../../../utils/dates';

// Phase 6 Plan 07 (REPORT-UI-03): three Paper cards mirroring
// settings-page/enrichment-status-cards.tsx for the headline totals
// (books read, page turns, reading time).

const numberFormatter = new Intl.NumberFormat();

export function HeadlineCards({ totals }: { totals: YearlyReport['totals'] }): JSX.Element {
  const cards = [
    { label: 'Books read', value: numberFormatter.format(totals.books) },
    { label: 'Page turns', value: numberFormatter.format(totals.pages) },
    {
      label: 'Reading time',
      value:
        totals.readTimeSeconds > 0 ? formatSecondsToHumanReadable(totals.readTimeSeconds) : 'N/A',
    },
  ];

  return (
    <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
      {cards.map((c) => (
        <Paper key={c.label} p="md" withBorder>
          <Stack gap={4}>
            <Text size="sm" c="dimmed" fw={400}>
              {c.label}
            </Text>
            <Text size="28px" fw={600} lh={1.1}>
              {c.value}
            </Text>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
