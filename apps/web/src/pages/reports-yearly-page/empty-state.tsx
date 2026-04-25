import { Anchor, Stack, Text, Title } from '@mantine/core';
import { JSX } from 'react';
import { Link } from 'react-router';
import { RoutePath } from '../../routes';

// Phase 6 Plan 06 (D-08, REPORT-UI-05): empty-state placeholder shown when a
// year has no enriched reading data. Links to /settings/unmatched so users can
// fix unmatched matches and populate this report.

export type EmptyYearStateProps = {
  year: number;
};

export function EmptyYearState({ year }: EmptyYearStateProps): JSX.Element {
  return (
    <Stack align="center" py="xl" gap="md">
      <Title order={3}>No reading data for {year}</Title>
      <Text c="dimmed" ta="center" maw={520}>
        No enriched books for this year. Visit the{' '}
        <Anchor component={Link} to={RoutePath.SETTINGS_UNMATCHED}>
          unmatched books inbox
        </Anchor>{' '}
        to fix unmatched matches and populate this report.
      </Text>
    </Stack>
  );
}
