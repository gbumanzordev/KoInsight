import { BookWithData } from '@koinsight/common/types';
import {
  Badge,
  Box,
  Button,
  Flex,
  Group,
  Loader,
  Menu,
  Paper,
  RingProgress,
  Stack,
  Tabs,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconCalendar,
  IconChevronDown,
  IconClock,
  IconClockHour4,
  IconEdit,
  IconFile,
  IconHighlight,
  IconRefresh,
  IconSettings,
  IconTable,
} from '@tabler/icons-react';
import { sum } from 'ramda';
import { JSX, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useBookWithData } from '../../api/use-book-with-data';
import { ReEnrichButton } from '../../components/re-enrich-button/re-enrich-button';
import { formatSecondsToHumanReadable } from '../../utils/dates';
import { BookCard } from './book-card';
import { BookMetadataEditModal } from './book-metadata-edit-modal';
import { BookPageAnnotations } from './book-page-annotations';
import { BookPageCalendar } from './book-page-calendar';
import { BookPageManage } from './book-page-manage/book-page-manage';
import { BookPageRaw } from './book-page-raw';

export function BookPage(): JSX.Element {
  const { id } = useParams() as { id: string };
  const { data: book, isLoading, mutate } = useBookWithData(Number(id));

  const [tabValue, setTabValue] = useState<string | null>('calendar');
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);

  // Phase 5 Plan 04 (UI-05): emit terminal toasts when the book transitions out
  // of an open enrichment status (pending/running). The kickoff toast comes
  // from ReEnrichButton; this effect closes the loop on the polling cycle.
  const prevStatusRef = useRef(book?.enrichment_status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    const next = book?.enrichment_status;
    if (prev && next && prev !== next && (prev === 'pending' || prev === 'running')) {
      if (next === 'enriched') {
        notifications.show({
          title: 'Enrichment complete',
          message: 'Metadata refreshed from OpenLibrary.',
          color: 'green',
          position: 'top-center',
        });
      } else if (next === 'failed') {
        notifications.show({
          title: 'Enrichment failed',
          message: 'OpenLibrary could not match this book. Edit metadata manually to fix it.',
          color: 'red',
          position: 'top-center',
        });
      }
    }
    prevStatusRef.current = next;
  }, [book?.enrichment_status]);

  if (isLoading || !book) {
    return (
      <Flex justify="center" align="center" h="100%">
        <Loader />
      </Flex>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between" gap="md">
        <BookCard book={book} />
        <StatsCard book={book} />
      </Group>

      <Group gap="sm">
        <Button leftSection={<IconEdit size={16} />} onClick={openEdit}>
          Edit metadata
        </Button>
        <ReEnrichButton
          bookId={book.id}
          enrichmentStatus={book.enrichment_status}
          variant="primary"
        />
      </Group>

      <Group gap="xs">
        {book.genres?.map((genre) => (
          <Badge radius="sm" variant="outline" key={genre.id}>
            {genre.name}
          </Badge>
        ))}
      </Group>

      <Tabs value={tabValue} onChange={(value) => setTabValue(value)}>
        <Tabs.List style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Flex>
            <Tabs.Tab value="calendar" leftSection={<IconCalendar size={16} />}>
              Calendar
            </Tabs.Tab>
            <Tabs.Tab value="annotations" leftSection={<IconHighlight size={16} />}>
              <Flex align="center" gap="xs">
                Annotations{' '}
                {book.annotations.length > 0 && (
                  <Badge color="gray" size="xs">
                    {book.annotations.length}
                  </Badge>
                )}
              </Flex>
            </Tabs.Tab>
            <Tabs.Tab value="manage" leftSection={<IconSettings size={16} />}>
              Manage data
            </Tabs.Tab>
            {tabValue === 'raw-values' && (
              <Tabs.Tab value="raw-values" leftSection={<IconTable size={16} />}>
                Raw Values
              </Tabs.Tab>
            )}
          </Flex>
          <Menu position="bottom-end" withArrow>
            <Menu.Target>
              <UnstyledButton
                fz={13}
                px="md"
                py="xs"
                style={{ transition: 'background-color 100ms ease' }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--tab-hover-color)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '';
                }}
              >
                <Flex align="center" gap="xs">
                  <span>Advanced</span>
                  <IconChevronDown size={16} />
                </Flex>
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconTable size={16} />}
                onClick={() => setTabValue('raw-values')}
              >
                Raw Values
              </Menu.Item>
              <Menu.Item leftSection={<IconRefresh size={16} />} onClick={() => mutate()}>
                Reload book data
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Tabs.List>

        <Tabs.Panel value="calendar">
          <Box py={20}>
            <BookPageCalendar book={book} />
          </Box>
        </Tabs.Panel>

        <Tabs.Panel value="annotations">
          <Box py={20}>
            <BookPageAnnotations book={book} />
          </Box>
        </Tabs.Panel>

        <Tabs.Panel value="raw-values">
          <Box py={20}>
            <BookPageRaw book={book} />
          </Box>
        </Tabs.Panel>

        <Tabs.Panel value="manage">
          <Box py={20}>
            <BookPageManage book={book} />
          </Box>
        </Tabs.Panel>
      </Tabs>

      <BookMetadataEditModal book={book} opened={editOpened} onClose={closeEdit} />
    </Stack>
  );
}

function StatsCard({ book }: { book: BookWithData }): JSX.Element {
  const bookPages =
    book?.reference_pages ||
    book?.device_data.reduce((acc, device) => Math.max(acc, device.pages), 0) ||
    0;

  const readingDays = book ? Object.keys(book.read_per_day).length : 0;
  const avgPerDay = readingDays > 0 ? (book?.total_read_time ?? 0) / readingDays : 0;

  return (
    <Paper
      withBorder
      px="lg"
      py="md"
      radius="md"
      style={{
        background:
          'linear-gradient(135deg, var(--mantine-color-default) 0%, var(--mantine-color-body) 100%)',
      }}
    >
      <Stack gap={0} align="center">
        <Text size="sm" c="dimmed" tt="uppercase" fw={700}>
          Reading progress
        </Text>
        <Group align="center" justify="space-between" wrap="nowrap">
          <Stack align="center" gap="xs">
            <RingProgress
              size={180}
              thickness={9}
              roundCaps
              label={
                <Stack gap={0} align="center">
                  <Text size="xl" fw={700} ta="center">
                    {Math.round((book.unique_read_pages / bookPages) * 100)}%
                  </Text>
                  <Text size="xs" c="dimmed" ta="center" fw="bold">
                    {book.unique_read_pages} / {bookPages} <br /> pages read
                  </Text>
                </Stack>
              }
              sections={[
                {
                  value: (book.unique_read_pages / bookPages) * 100,
                  color: 'koinsight',
                },
              ]}
            />
          </Stack>

          <Stack gap="md" flex={1}>
            <Group gap="sm" wrap="nowrap">
              <IconClock size={18} style={{ flexShrink: 0, opacity: 0.6 }} />
              <Stack gap={0}>
                <Text fz={11} c="dimmed" lh={1.2} tt="uppercase" fw="bold">
                  Total read time
                </Text>
                <Text size="md" fw={600}>
                  {formatSecondsToHumanReadable(book.total_read_time)}
                </Text>
              </Stack>
            </Group>

            <Group gap="sm" wrap="nowrap">
              <IconClockHour4 size={18} style={{ flexShrink: 0, opacity: 0.6 }} />
              <Stack gap={0}>
                <Text fz={11} c="dimmed" lh={1.2} tt="uppercase" fw="bold">
                  Average per day
                </Text>
                <Text size="md" fw={600}>
                  {formatSecondsToHumanReadable(avgPerDay)}
                </Text>
              </Stack>
            </Group>
          </Stack>

          <Stack gap="md" flex={1}>
            <Group gap="sm" wrap="nowrap">
              <IconCalendar size={18} style={{ flexShrink: 0, opacity: 0.6 }} />
              <Stack gap={0}>
                <Text fz={11} c="dimmed" lh={1.2} tt="uppercase" fw="bold">
                  Days reading
                </Text>
                <Text size="md" fw={600}>
                  {Object.keys(book.read_per_day).length}
                </Text>
              </Stack>
            </Group>

            <Group gap="sm" wrap="nowrap">
              <IconFile size={18} style={{ flexShrink: 0, opacity: 0.6 }} />
              <Stack gap={0}>
                <Text fz={11} c="dimmed" lh={1.2} tt="uppercase" fw="bold">
                  Avg time per page
                </Text>
                <Text size="md" fw={600}>
                  {book.stats.length > 0
                    ? Math.round(sum(book.stats.map((p) => p.duration)) / book.stats.length)
                    : 0}
                  s
                </Text>
              </Stack>
            </Group>
          </Stack>
        </Group>
      </Stack>
    </Paper>
  );
}
