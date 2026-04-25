import { Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { JSX } from 'react';
import { useEnrichmentStatus } from '../../api/enrichment';

// Phase 5 Plan 05 (D-16, UI-SPEC stat-card spec): four counters at the top of
// the Unmatched section. Numerals 28px / 600 / 1.1; labels 14px / 400 dimmed.
// Shared SWR key with the Navbar Indicator (A6) keeps both surfaces in lockstep.
const CARDS = [
  { key: 'pending' as const, label: 'Pending', color: 'gray' },
  { key: 'running' as const, label: 'Running', color: 'blue' },
  { key: 'enriched' as const, label: 'Enriched', color: 'teal' },
  { key: 'failed' as const, label: 'Failed', color: 'red' },
];

export function EnrichmentStatusCards(): JSX.Element {
  const { data, error } = useEnrichmentStatus();
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="md">
      {CARDS.map((c) => (
        <Paper key={c.key} p="md" withBorder>
          <Stack gap={4}>
            <Text size="sm" c="dimmed" fw={400}>
              {c.label}
            </Text>
            <Text size="28px" fw={600} lh={1.1} c={error ? 'dimmed' : c.color}>
              {error ? '-' : (data?.[c.key] ?? 0)}
            </Text>
          </Stack>
        </Paper>
      ))}
    </SimpleGrid>
  );
}
