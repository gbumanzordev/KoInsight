import type { YearlyReportBucket } from '@koinsight/common/types/reports-api';
import { BarChart } from '@mantine/charts';
import { useMantineTheme } from '@mantine/core';
import { JSX, useMemo } from 'react';

// Genre breakdown rendered as a horizontal bar chart (one bar per genre)
// so differences in count are easy to read at a glance.

const CHART_HEIGHT = 300;

export function GenreBar({ data }: { data: YearlyReportBucket[] }): JSX.Element {
  const { colors } = useMantineTheme();

  const palette = useMemo(
    () => [
      colors.koinsight[7],
      colors.violet[6],
      colors.koinsight[5],
      colors.violet[4],
      colors.koinsight[8],
      colors.violet[8],
      colors.koinsight[3],
      colors.violet[2],
    ],
    [colors]
  );

  const rows = useMemo(
    () =>
      data.map((bucket, i) => ({
        genre: bucket.key,
        count: bucket.count,
        color: palette[i % palette.length],
      })),
    [data, palette]
  );

  return (
    <BarChart
      h={CHART_HEIGHT}
      data={rows}
      dataKey="genre"
      orientation="vertical"
      yAxisProps={{ width: 140 }}
      gridAxis="x"
      getBarColor={(_, item) => (item as { color: string }).color}
      series={[{ name: 'count', label: 'Books', color: 'koinsight.7' }]}
    />
  );
}
