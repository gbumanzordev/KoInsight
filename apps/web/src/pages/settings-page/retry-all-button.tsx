import { Button, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';
import { JSX, useState } from 'react';

import {
  invalidateUnmatchedList,
  postRetryAll,
  useEnrichmentStatus,
} from '../../api/enrichment';

// Phase 8 Plan 04 (RETRY-01, D-10, D-11, D-13): section-level "Retry all
// failed" button in the Unmatched Books header. Per D-10 the click fires
// immediately; there is NO confirmation modal (UI-SPEC modal section is
// stale). Disabled when failed === 0 with the locked tooltip "No failed books
// to retry". Toast wording is locked verbatim by D-13 + UI-SPEC Copywriting
// Contract.
export function RetryAllButton(): JSX.Element {
  const { data } = useEnrichmentStatus();
  const failedCount = data?.failed ?? 0;
  const [isSubmitting, setIsSubmitting] = useState(false);

  const disabled = isSubmitting || failedCount === 0;

  const onClick = async () => {
    try {
      setIsSubmitting(true);
      const res = await postRetryAll();
      if (res.enqueued > 0) {
        notifications.show({
          title: 'Retrying...',
          message: `Re-enqueued ${res.enqueued} books`,
          color: 'blue',
          position: 'top-center',
        });
      } else {
        notifications.show({
          message: 'No failed books to retry',
          color: 'blue',
          position: 'top-center',
        });
      }
      await invalidateUnmatchedList();
    } catch {
      notifications.show({
        title: 'Could not start bulk retry',
        message: 'Server error. Try again in a moment.',
        color: 'red',
        position: 'top-center',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Tooltip label="No failed books to retry" disabled={failedCount > 0}>
      <Button
        variant="default"
        size="sm"
        leftSection={<IconRefresh size={16} />}
        disabled={disabled}
        loading={isSubmitting}
        onClick={onClick}
      >
        Retry all failed
      </Button>
    </Tooltip>
  );
}
