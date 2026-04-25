import { BookWithData, MetadataPatch } from '@koinsight/common/types';
import { Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { JSX, useState } from 'react';
import { mutate } from 'swr';
import { patchBookMetadata } from '../../api/books';
import { BookMetadataForm } from './book-metadata-form';

// Phase 5 Plan 04 (D-01, D-02): Mantine Modal hosting the metadata edit form.
// Submit -> PATCH -> SWR mutate -> success toast -> close. Cancel closes
// silently (no confirm-on-discard).
export type BookMetadataEditModalProps = {
  book: BookWithData;
  opened: boolean;
  onClose: () => void;
};

export function BookMetadataEditModal({
  book,
  opened,
  onClose,
}: BookMetadataEditModalProps): JSX.Element {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (patch: MetadataPatch) => {
    try {
      setSubmitting(true);
      await patchBookMetadata(book.id, patch);
      await mutate(`books/${book.id}`);
      notifications.show({
        title: 'Metadata saved',
        message: 'Manual edits will not be overwritten by future enrichment.',
        color: 'green',
        position: 'top-center',
      });
      onClose();
    } catch (error) {
      const err = error as Error;
      const looksLikeClientError = /4\d\d/.test(err.message ?? '');
      notifications.show({
        title: 'Could not save changes',
        message: looksLikeClientError
          ? 'Some fields are invalid. Review highlighted rows and try again.'
          : 'Server error. Try again in a moment.',
        color: 'red',
        position: 'top-center',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title="Edit metadata" size="lg" centered>
      <BookMetadataForm
        book={book}
        submitting={submitting}
        onCancel={onClose}
        onSubmit={handleSubmit}
      />
    </Modal>
  );
}
