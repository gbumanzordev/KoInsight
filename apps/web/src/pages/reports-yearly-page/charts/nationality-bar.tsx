import type { YearlyReportBucket } from '@koinsight/common/types/reports-api';
import { BarChart } from '@mantine/charts';
import { useComputedColorScheme } from '@mantine/core';
import { JSX } from 'react';

// Phase 6 Plan 07 (REPORT-UI-03): nationality breakdown as a single-series
// BarChart. 'Other' and 'Unknown' are ordinary bars, not special-cased.

export function NationalityBar({ data }: { data: YearlyReportBucket[] }): JSX.Element {
  const colorScheme = useComputedColorScheme();

  return (
    <BarChart
      h={300}
      data={data}
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
