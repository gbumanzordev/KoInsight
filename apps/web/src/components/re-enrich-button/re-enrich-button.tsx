import { Book, BookWithData } from '@koinsight/common/types';
import { Button, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconRefresh } from '@tabler/icons-react';
import { JSX, useState } from 'react';
import { mutate } from 'swr';
import { reEnrichBook } from '../../api/books';
import { invalidateUnmatchedList } from '../../api/enrichment';

// Phase 5 Plan 04 (UI-05, D-13): primary CTA in the book detail header AND the
// per-row action in the unmatched inbox. Disabled with a tooltip while the
// book's enrichment job is open. Only emits the kickoff toast; the parent page
// (which watches book.enrichment_status via SWR polling) emits the terminal
// success / failure toast.
export type ReEnrichButtonProps = {
  bookId: Book['id'];
  enrichmentStatus: BookWithData['enrichment_status'];
  variant: 'primary' | 'row';
};

export function ReEnrichButton({
  bookId,
  enrichmentStatus,
  variant,
}: ReEnrichButtonProps): JSX.Element {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isOpen = enrichmentStatus === 'pending' || enrichmentStatus === 'running';

  const onClick = async () => {
    try {
      setIsSubmitting(true);
      await reEnrichBook(bookId);
      notifications.show({
        title: 'Re-enriching...',
        message: "We're checking OpenLibrary for fresh metadata.",
        color: 'blue',
        position: 'top-center',
      });
      // Trigger SWR to refetch immediately so the conditional polling kicks in.
      await mutate(`books/${bookId}`);
      // Phase 8 Plan 04 (D-14, RETRY-02): invalidate the unmatched-list cache
      // so the inbox row updates without a page reload.
      await invalidateUnmatchedList();
    } catch (error) {
      notifications.show({
        title: 'Enrichment failed',
        message:
          'OpenLibrary could not match this book. Edit metadata manually to fix it.',
        color: 'red',
        position: 'top-center',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Tooltip label="Already running" disabled={!isOpen}>
      <Button
        disabled={isOpen || isSubmitting}
        loading={isSubmitting}
        leftSection={<IconRefresh size={16} />}
        variant={variant === 'primary' ? 'filled' : 'default'}
        onClick={onClick}
      >
        Re-enrich
      </Button>
    </Tooltip>
  );
}
