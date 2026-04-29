import type { YearlyReportBucket } from '@koinsight/common/types/reports-api';
import { BarChart } from '@mantine/charts';
import { useComputedColorScheme } from '@mantine/core';
import { JSX, useMemo } from 'react';

// Phase 6 Plan 07 (REPORT-UI-03): publication-decade histogram. Server-side
// already zero-fills gaps between min and max decades and appends 'Unknown'
// (CONTEXT D-05), so this is just a single-series BarChart over the buckets.

export function DecadeHistogram({ data }: { data: YearlyReportBucket[] }): JSX.Element {
  const colorScheme = useComputedColorScheme();

  const populated = useMemo(() => data.filter((d) => d.count > 0), [data]);

  return (
    <BarChart
      h={300}
      data={populated}
      dataKey="key"
      gridAxis="y"
      series={[
        {
          name: 'count',
          label: 'Books',
          color: colorScheme === 'dark' ? 'koinsight.7' : 'koinsight.1',
        },
      ]}
    />
  );
}
