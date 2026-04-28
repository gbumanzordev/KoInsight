import {
  Alert,
  Box,
  Button,
  Group,
  LoadingOverlay,
  Pagination,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { JSX, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { useUnmatchedBooks } from '../../api/enrichment';
import { FailureReasonBadge } from '../../components/failure-reason-badge/failure-reason-badge';
import { ReEnrichButton } from '../../components/re-enrich-button/re-enrich-button';
import { getBookPath, RoutePath } from '../../routes';
import { formatRelativeDate } from '../../utils/dates';
import { EnrichmentStatusCards } from './enrichment-status-cards';
import { RetryAllButton } from './retry-all-button';

// Phase 5 Plan 05 (UI-04, D-14, D-16, D-20): paginated list of failed books with
// per-row Edit metadata + Re-enrich actions. Uses a single list-level SWR poll
// (5s) per D-14; no per-row polling. Books that transition out of `failed`
// naturally drop off on the next revalidation.
const PAGE_SIZE = 20;

export function UnmatchedBooksSection(): JSX.Element {
  const [page, setPage] = useState(1);
  const offset = (page - 1) * PAGE_SIZE;
  const { data, error, isLoading } = useUnmatchedBooks({ offset, limit: PAGE_SIZE });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="center">
        <Title order={2}>Unmatched books</Title>
        <RetryAllButton />
      </Group>
      <EnrichmentStatusCards />

      {error && (
        <Alert color="red" title="Could not load unmatched books">
          Refresh the page or try again later.
        </Alert>
      )}

      {!error && (
        <Box pos="relative" mih={200}>
          <LoadingOverlay visible={isLoading} />

          {data && data.total === 0 && (
            <Stack align="center" py="xl" gap="md">
              <Title order={3}>No unmatched books</Title>
              <Text c="dimmed">
                Every book in your library has been enriched. New unmatched books will
                appear here.
              </Text>
              <Button component={NavLink} to={RoutePath.BOOKS} variant="default">
                View all books
              </Button>
            </Stack>
          )}

          {data && data.total > 0 && data.rows.length === 0 && (
            <Stack align="center" py="xl" gap="md">
              <Title order={3}>No more results</Title>
              <Text c="dimmed">You've reached the end of the list.</Text>
              <Button onClick={() => setPage(1)} variant="default">
                Back to first page
              </Button>
            </Stack>
          )}

          {data && data.rows.length > 0 && (
            <Stack gap="md">
              {data.rows.map((row) => (
                <Paper key={row.id} p="md" withBorder>
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                      <Text fw={600} truncate>
                        {row.title}
                      </Text>
                      <Text size="sm" c="dimmed" truncate>
                        {row.authors ?? 'Unknown author'}
                      </Text>
                      <Group gap="xs" wrap="nowrap">
                        <FailureReasonBadge reason={row.failure_reason} />
                        {row.job_updated_at && (
                          <Text size="xs" c="dimmed">
                            {formatRelativeDate(row.job_updated_at)}
                          </Text>
                        )}
                      </Group>
                    </Stack>
                    <Group gap="sm" wrap="nowrap">
                      <Button
                        component={Link}
                        to={getBookPath(row.id)}
                        variant="default"
                        size="sm"
                      >
                        Edit metadata
                      </Button>
                      <ReEnrichButton
                        bookId={row.id}
                        enrichmentStatus="failed"
                        variant="row"
                      />
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {data && data.total > PAGE_SIZE && (
        <Group justify="center">
          <Pagination value={page} onChange={setPage} total={totalPages} />
        </Group>
      )}
    </Stack>
  );
}
