import { AuthorEdit } from '@koinsight/common/types';
import { ActionIcon, Group, Select, Stack, Text, TextInput, Tooltip } from '@mantine/core';
import { modals } from '@mantine/modals';
import { IconArrowDown, IconArrowUp, IconTrash, IconX } from '@tabler/icons-react';
import { JSX } from 'react';
import { iso3166Options } from '../../constants/iso-3166';

// Phase 5 Plan 04 (D-04, D-05, UI-SPEC "Destructive confirmations"): single
// editable author row in the metadata edit form. The OL key is read-only; users
// can only clear it. Removing a row that has an OL key fires a confirm modal;
// rows without an OL key are removed inline.
export type AuthorRowEditorProps = {
  value: AuthorEdit;
  onChange: (next: AuthorEdit) => void;
  onRemove: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  index: number;
};

export function AuthorRowEditor({
  value,
  onChange,
  onRemove,
  onMoveUp,
  onMoveDown,
  index,
}: AuthorRowEditorProps): JSX.Element {
  const handleRemoveClick = () => {
    if (value.openlibrary_key) {
      modals.openConfirmModal({
        title: 'Remove author?',
        centered: true,
        children: (
          <Text size="sm">
            This author has an OpenLibrary link. Removing them will not delete the author record but
            will detach them from this book.
          </Text>
        ),
        labels: { confirm: 'Remove', cancel: 'Keep' },
        confirmProps: { color: 'red' },
        onConfirm: onRemove,
      });
    } else {
      onRemove();
    }
  };

  return (
    <Group gap="sm" align="flex-start" wrap="nowrap">
      <Stack gap={4} flex={1}>
        <TextInput
          placeholder="Author name"
          aria-label={`Author ${index + 1} name`}
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.currentTarget.value })}
        />
        <Select
          data={iso3166Options()}
          placeholder="Nationality"
          aria-label={`Author ${index + 1} nationality`}
          value={value.nationality ?? null}
          onChange={(next) => onChange({ ...value, nationality: next })}
          clearable
          searchable
        />
        <Group gap="xs" align="center">
          <Text c="dimmed" size="xs">
            {value.openlibrary_key ? value.openlibrary_key : 'No OpenLibrary link'}
          </Text>
          {value.openlibrary_key ? (
            <Tooltip label="Unlink to allow re-resolution on next enrichment">
              <ActionIcon
                variant="subtle"
                aria-label="Unlink OpenLibrary key"
                onClick={() => onChange({ ...value, openlibrary_key: null })}
              >
                <IconX size={16} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </Group>
      </Stack>

      <Stack gap={4}>
        <ActionIcon
          variant="subtle"
          aria-label="Move up"
          disabled={!onMoveUp}
          onClick={onMoveUp}
        >
          <IconArrowUp size={16} />
        </ActionIcon>
        <ActionIcon
          variant="subtle"
          aria-label="Move down"
          disabled={!onMoveDown}
          onClick={onMoveDown}
        >
          <IconArrowDown size={16} />
        </ActionIcon>
        <ActionIcon
          color="red"
          variant="subtle"
          aria-label="Remove author"
          onClick={handleRemoveClick}
        >
          <IconTrash size={16} />
        </ActionIcon>
      </Stack>
    </Group>
  );
}
