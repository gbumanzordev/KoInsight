import type { YearlyReportBucket } from '@koinsight/common/types/reports-api';
import { BarChart } from '@mantine/charts';
import { useComputedColorScheme, useMantineTheme } from '@mantine/core';
import { JSX, useMemo } from 'react';

// Phase 6 Plan 07 (REPORT-UI-03): genre breakdown rendered as a single-row
// stacked BarChart. Each genre key becomes its own stacked series, so the
// chart shows one wide bar split into colored segments. dataKey is a static
// label since we have one row representing the whole year.

export function GenreBar({ data }: { data: YearlyReportBucket[] }): JSX.Element {
  const colorScheme = useComputedColorScheme();
  const { colors } = useMantineTheme();

  const palette = useMemo(() => {
    // cycle through koinsight + violet shades to avoid running out of colors
    const base = [
      colors.koinsight[6],
      colors.violet[6],
      colors.koinsight[4],
      colors.violet[4],
      colors.koinsight[8],
      colors.violet[8],
      colors.koinsight[2],
      colors.violet[2],
    ];
    return base;
  }, [colors]);

  const { row, series } = useMemo(() => {
    const r: Record<string, string | number> = { label: 'Genres' };
    const s = data.map((bucket, i) => {
      r[bucket.key] = bucket.count;
      return {
        name: bucket.key,
        color: palette[i % palette.length],
      };
    });
    return { row: r, series: s };
  }, [data, palette]);

  if (data.length === 0) {
    return (
      <BarChart
        h={300}
        data={[]}
        dataKey="label"
        series={[
          {
            name: 'count',
            color: colorScheme === 'dark' ? 'koinsight.7' : 'koinsight.1',
          },
        ]}
      />
    );
  }

  return (
    <BarChart
      h={300}
      data={[row]}
      dataKey="label"
      type="stacked"
      series={series}
      withLegend
      gridAxis="y"
    />
  );
}
