import { ActionIcon, Group, Select } from '@mantine/core';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { parseAsInteger, useQueryState } from 'nuqs';
import { JSX, useMemo } from 'react';

// Phase 6 Plan 06 (D-02): year navigator. Mantine Select is the source of
// truth, two ActionIcon arrows just call setYear(neighbor). The list arrives
// sorted DESC from /api/reports/years, so index 0 is the newest year. Arrows
// disable at the list endpoints. The selected year persists in the URL via
// nuqs (?year=YYYY) so reloads and back/forward navigation keep the choice.

export type YearNavigatorProps = {
  years: number[];
  onChange?: (year: number) => void;
};

export function YearNavigator({ years, onChange }: YearNavigatorProps): JSX.Element {
  const fallbackYear = years[0] ?? new Date().getFullYear();
  const [year, setYear] = useQueryState(
    'year',
    parseAsInteger.withDefault(fallbackYear)
  );

  const data = useMemo(
    () => years.map((y) => ({ value: String(y), label: String(y) })),
    [years]
  );

  const idx = years.indexOf(year);
  const newerYear = idx > 0 ? years[idx - 1] : null;
  const olderYear = idx >= 0 && idx < years.length - 1 ? years[idx + 1] : null;

  const updateYear = (next: number) => {
    setYear(next);
    onChange?.(next);
  };

  return (
    <Group gap="xs" wrap="nowrap">
      <ActionIcon
        variant="default"
        size="lg"
        aria-label="Older year"
        disabled={olderYear === null}
        onClick={() => olderYear !== null && updateYear(olderYear)}
      >
        <IconChevronLeft size={18} stroke={1.5} />
      </ActionIcon>
      <Select
        data={data}
        value={String(year)}
        onChange={(value) => {
          if (value === null) return;
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) updateYear(parsed);
        }}
        allowDeselect={false}
        searchable={false}
        w={120}
        aria-label="Select report year"
      />
      <ActionIcon
        variant="default"
        size="lg"
        aria-label="Newer year"
        disabled={newerYear === null}
        onClick={() => newerYear !== null && updateYear(newerYear)}
      >
        <IconChevronRight size={18} stroke={1.5} />
      </ActionIcon>
    </Group>
  );
}
