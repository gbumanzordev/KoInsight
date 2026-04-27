import {
  AuthorEdit,
  BookWithData,
  MetadataPatch,
  metadataPatchSchema,
} from '@koinsight/common/types';
import { CANONICAL_GENRES } from '@koinsight/common/genres';
import {
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useForm } from '@mantine/form';
import { zod4Resolver } from 'mantine-form-zod-resolver';
import { JSX } from 'react';
import { ProvenanceBadge } from '../../components/provenance-badge/provenance-badge';
import { iso639Options } from '../../constants/iso-639';
import { AuthorRowEditor } from './author-row-editor';

// Phase 5 Plan 04 (UI-01, UI-02): the metadata edit form. Validation flows
// through the SAME Zod schema that gates the server (D-03), shared via
// @koinsight/common. Field-level errors render inline; the parent owns toast
// behavior on submit.
export type BookMetadataFormProps = {
  book: BookWithData;
  onSubmit: (patch: MetadataPatch) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
};

type FormValues = {
  authors: AuthorEdit[];
  genres: string[];
  publication_year: number | null;
  original_language: string | null;
};

function deriveInitialAuthors(book: BookWithData): AuthorEdit[] {
  if (book.authors_full && book.authors_full.length > 0) {
    return book.authors_full.map((a) => ({
      name: a.name,
      nationality: a.nationality,
      openlibrary_key: a.openlibrary_key,
    }));
  }
  const raw = book.authors?.trim();
  if (!raw) {
    return [{ name: '', nationality: null, openlibrary_key: null }];
  }
  return raw
    .split(/,\s*/)
    .filter((n) => n.length > 0)
    .map((name) => ({ name, nationality: null, openlibrary_key: null }));
}

export function BookMetadataForm({
  book,
  onSubmit,
  onCancel,
  submitting,
}: BookMetadataFormProps): JSX.Element {
  const form = useForm<FormValues>({
    mode: 'controlled',
    initialValues: {
      authors: deriveInitialAuthors(book),
      genres: book.genres?.map((g) => g.name) ?? [],
      publication_year: book.publication_year ?? null,
      original_language: book.original_language ?? null,
    },
    validate: zod4Resolver(metadataPatchSchema),
  });

  const moveAuthor = (from: number, to: number) => {
    const next = [...form.values.authors];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    form.setFieldValue('authors', next);
  };

  const addAuthor = () => {
    form.setFieldValue('authors', [
      ...form.values.authors,
      { name: '', nationality: null, openlibrary_key: null },
    ]);
  };

  const handleSubmit = form.onSubmit(async (values) => {
    // The Zod schema treats every present key as a manual edit. We submit the
    // full payload (form is fully populated from the existing book), so the
    // server stamps every *_source='manual'. This matches the locked save toast
    // ("Manual edits will not be overwritten by future enrichment.").
    await onSubmit(values as MetadataPatch);
  });

  return (
    <form onSubmit={handleSubmit}>
      <Stack gap="md">
        <TextInput label="Title" value={book.title} disabled />

        <Stack gap="xs">
          <Group gap="xs">
            <Text fw={500}>Authors</Text>
            <ProvenanceBadge source={book.authors_source} fieldName="Authors" />
          </Group>
          <Stack gap="xs">
            {form.values.authors.map((author, index) => (
              <AuthorRowEditor
                key={index}
                index={index}
                value={author}
                onChange={(next) => {
                  const arr = [...form.values.authors];
                  arr[index] = next;
                  form.setFieldValue('authors', arr);
                }}
                onRemove={() => {
                  const arr = form.values.authors.filter((_, i) => i !== index);
                  form.setFieldValue('authors', arr);
                }}
                onMoveUp={index > 0 ? () => moveAuthor(index, index - 1) : undefined}
                onMoveDown={
                  index < form.values.authors.length - 1
                    ? () => moveAuthor(index, index + 1)
                    : undefined
                }
              />
            ))}
          </Stack>
          {typeof form.errors.authors === 'string' ? (
            <Text size="xs" c="red">
              {form.errors.authors}
            </Text>
          ) : null}
          <Button variant="default" size="xs" onClick={addAuthor} type="button">
            Add author
          </Button>
        </Stack>

        <MultiSelect
          label={
            <Group gap="xs" component="span">
              <Text fw={500} component="span">
                Genres
              </Text>
              <ProvenanceBadge source={book.genres_source} fieldName="Genres" />
            </Group>
          }
          data={CANONICAL_GENRES.map((g) => g)}
          searchable
          clearable
          {...form.getInputProps('genres')}
        />

        <NumberInput
          label={
            <Group gap="xs" component="span">
              <Text fw={500} component="span">
                Publication year
              </Text>
              <ProvenanceBadge
                source={book.publication_year_source}
                fieldName="Publication year"
              />
            </Group>
          }
          min={1000}
          max={2100}
          allowNegative={false}
          {...form.getInputProps('publication_year')}
        />

        <Select
          label={
            <Group gap="xs" component="span">
              <Text fw={500} component="span">
                Original language
              </Text>
              <ProvenanceBadge
                source={book.original_language_source}
                fieldName="Original language"
              />
            </Group>
          }
          data={iso639Options()}
          searchable
          clearable
          {...form.getInputProps('original_language')}
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} type="button" disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" loading={submitting}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
