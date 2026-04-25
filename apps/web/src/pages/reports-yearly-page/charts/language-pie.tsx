import type { YearlyReportBucket } from '@koinsight/common/types/reports-api';
import { PieChart } from '@mantine/charts';
import { useMantineTheme } from '@mantine/core';
import { JSX, useMemo } from 'react';

// Phase 6 Plan 07 (REPORT-UI-03): original-language pie chart. First use of
// PieChart in the repo, follows @mantine/charts data shape
// `{ name, value, color }[]` and cycles through koinsight + violet shades.

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
        name: bucket.key,
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
