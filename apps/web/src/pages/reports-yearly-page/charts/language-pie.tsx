import type { YearlyReportBook, YearlyReportBucket } from '@koinsight/common/types/reports-api';
import { PieChart } from '@mantine/charts';
import { Anchor, ScrollArea, Table, useMantineTheme } from '@mantine/core';
import { JSX, useMemo } from 'react';
import { Link } from 'react-router';
import { getBookPath } from '../../../routes';

// Phase 6 Plan 07 (REPORT-UI-03): original-language pie chart. First use of
// PieChart in the repo, follows @mantine/charts data shape
// `{ name, value, color }[]` and cycles through koinsight + violet shades.

// Map ISO 639-1 language codes to a representative ISO 3166-1 region for
// the emoji flag. Languages without a single canonical region (e.g. ar, sw)
// fall through to no flag.
const LANGUAGE_TO_REGION: Record<string, string> = {
  en: 'GB',
  fr: 'FR',
  es: 'ES',
  pt: 'PT',
  de: 'DE',
  it: 'IT',
  nl: 'NL',
  sv: 'SE',
  no: 'NO',
  nb: 'NO',
  nn: 'NO',
  da: 'DK',
  fi: 'FI',
  is: 'IS',
  pl: 'PL',
  cs: 'CZ',
  sk: 'SK',
  hu: 'HU',
  ro: 'RO',
  bg: 'BG',
  el: 'GR',
  ru: 'RU',
  uk: 'UA',
  tr: 'TR',
  ja: 'JP',
  zh: 'CN',
  ko: 'KR',
  vi: 'VN',
  th: 'TH',
  id: 'ID',
  ms: 'MY',
  hi: 'IN',
  he: 'IL',
  fa: 'IR',
};

function regionToFlag(region: string): string {
  const A = 0x1f1e6;
  return String.fromCodePoint(
    ...region
      .toUpperCase()
      .split('')
      .map((c) => A + (c.charCodeAt(0) - 'A'.charCodeAt(0)))
  );
}

const displayNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

export function formatLanguage(code: string): string {
  if (code === 'Unknown' || code === 'Other') return code;
  const lower = code.toLowerCase();
  let name = code;
  try {
    const resolved = displayNames?.of(lower);
    if (resolved && resolved.toLowerCase() !== lower) {
      name = resolved.charAt(0).toUpperCase() + resolved.slice(1);
    }
  } catch {
    // Fall back to the raw code if Intl rejects it.
  }
  const region = LANGUAGE_TO_REGION[lower];
  return region ? `${regionToFlag(region)} ${name}` : name;
}

export function LanguagePie({ data }: { data: YearlyReportBucket[] }): JSX.Element {
  const { colors } = useMantineTheme();

  const palette = useMemo(
    () => [
      colors.koinsight[6],
      colors.violet[6],
      colors.koinsight[4],
      colors.violet[4],
      colors.koinsight[8],
      colors.violet[8],
      colors.koinsight[2],
      colors.violet[2],
    ],
    [colors]
  );

  const slices = useMemo(
    () =>
      data.map((bucket, i) => ({
        name: formatLanguage(bucket.key),
        value: bucket.count,
        color: palette[i % palette.length],
      })),
    [data, palette]
  );

  return (
    <PieChart
      h={300}
      data={slices}
      withLabels
      withLabelsLine
      withTooltip
      tooltipDataSource="segment"
      labelsType="percent"
    />
  );
}

export function YearlyReportBooksTable({ books }: { books: YearlyReportBook[] }): JSX.Element | null {
  if (books.length === 0) return null;
  return (
    <ScrollArea.Autosize mah={400} type="auto">
      <Table stickyHeader highlightOnHover withTableBorder withColumnBorders fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Title</Table.Th>
            <Table.Th>Author</Table.Th>
            <Table.Th>Language</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {books.map((book) => (
            <Table.Tr key={book.md5}>
              <Table.Td>
                <Anchor component={Link} to={getBookPath(book.id)} size="sm">
                  {book.title}
                </Anchor>
              </Table.Td>
              <Table.Td>{book.authors ?? '—'}</Table.Td>
              <Table.Td>
                {book.original_language ? formatLanguage(book.original_language) : '—'}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </ScrollArea.Autosize>
  );
}
