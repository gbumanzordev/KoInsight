import { Flex } from '@mantine/core';
import { endOfYear, formatDate, startOfDay, startOfYear } from 'date-fns';
import { JSX, useMemo } from 'react';
import { usePageStats } from '../../api/use-page-stats';
import { formatSecondsToHumanReadable } from '../../utils/dates';
import { DayData, DotTrail } from '../dot-trail/dot-trail';

type YearReadingCalendarProps = {
  year: number;
};

export function YearReadingCalendar({ year }: YearReadingCalendarProps): JSX.Element {
  const {
    data: { stats },
  } = usePageStats();

  const yearStart = useMemo(() => startOfYear(new Date(year, 0, 1)), [year]);
  const yearEnd = useMemo(() => endOfYear(new Date(year, 0, 1)), [year]);

  const percentPerDay: Record<number, DayData> = useMemo(() => {
    const startMs = yearStart.getTime();
    const endMs = yearEnd.getTime();

    const timePerDay = stats.reduce<Record<number, number>>((acc, stat) => {
      const day = startOfDay(stat.start_time).getTime();
      if (day < startMs || day > endMs) return acc;
      acc[day] = (acc[day] || 0) + stat.duration;
      return acc;
    }, {});

    const values = Object.values(timePerDay);
    if (values.length === 0) return {};
    const maxTime = Math.max(...values);

    return Object.entries(timePerDay).reduce<Record<number, DayData>>((acc, [day, time]) => {
      acc[Number(day)] = {
        percent: Math.floor((time / maxTime) * 100),
        tooltip: (
          <>
            {formatSecondsToHumanReadable(time)} read on{' '}
            {formatDate(new Date(Number(day)), 'dd MMM yyyy')}
          </>
        ),
      };
      return acc;
    }, {});
  }, [stats, yearStart, yearEnd]);

  return (
    <Flex style={{ width: '100%' }} justify="center" align="center">
      <DotTrail percentPerDay={percentPerDay} startDate={yearStart} endDate={yearEnd} />
    </Flex>
  );
}
