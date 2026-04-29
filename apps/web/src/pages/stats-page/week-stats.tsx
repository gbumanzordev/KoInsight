import { Book } from '@koinsight/common/types/book';
import { PageStat } from '@koinsight/common/types/page-stat';
import { AreaChart, BarChart } from '@mantine/charts';
import { Box, Flex, Popover, Text, Title, useComputedColorScheme, useMantineTheme } from '@mantine/core';
import { DatePicker } from '@mantine/dates';
import {
  IconArrowsVertical,
  IconCaretDownFilled,
  IconClock,
  IconPageBreak,
} from '@tabler/icons-react';
import { BarProps } from 'recharts';
import { CustomBar } from '../../components/charts/custom-bar';
import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfWeek,
  format,
  formatDate,
  getDay,
  isBefore,
  isSameDay,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { createParser, useQueryState } from 'nuqs';
import { groupBy, sum } from 'ramda';
import { useMemo } from 'react';
import { Statistics } from '../../components/statistics/statistics';
import { formatSecondsToHumanReadable } from '../../utils/dates';

const parseAsLocalDate = createParser<Date>({
  parse: (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    return Number.isNaN(date.getTime()) ? null : date;
  },
  serialize: (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
  eq: (a, b) => a.getTime() === b.getTime(),
});

export function WeekStats({
  stats,
  booksByMd5,
}: {
  stats: PageStat[];
  booksByMd5: Record<string, Book>;
}) {
  const colorScheme = useComputedColorScheme();
  const { colors } = useMantineTheme();

  const [weekStartDate, setWeekStartDate] = useQueryState(
    'weekStart',
    parseAsLocalDate.withDefault(startOfWeek(new Date(), { weekStartsOn: 1 }))
  );
  const weekStart = useMemo(
    () => startOfWeek(weekStartDate, { weekStartsOn: 1 }).getTime(),
    [weekStartDate]
  );
  const setWeekStart = (ms: number) => {
    setWeekStartDate(startOfWeek(new Date(ms), { weekStartsOn: 1 }));
  };

  const weekEnd = useMemo(() => {
    const rawWeekEnd = endOfWeek(weekStart, { weekStartsOn: 1 }).getTime();
    const today = endOfDay(new Date()).getTime();
    return rawWeekEnd <= today ? rawWeekEnd : today;
  }, [weekStart]);

  const weekData = useMemo(() => {
    const start = startOfWeek(weekStart, { weekStartsOn: 1 }).getTime();
    return stats?.filter(({ start_time }) => start_time < weekEnd && start_time > start);
  }, [stats, weekStart, weekEnd]);

  const weekReadTime = useMemo(
    () => sum(weekData?.map((stat) => stat.duration) ?? []),
    [weekData]
  );

  const isCurrentWeek = useMemo(
    () => isSameDay(weekStart, startOfWeek(new Date(), { weekStartsOn: 1 })),
    [weekStart]
  );

  const weekDaysPassed = useMemo(
    () => differenceInCalendarDays(weekEnd, weekStart) + 1,
    [weekStart, weekEnd]
  );

  const pagesRead = useMemo(
    () =>
      Math.round(
        weekData?.reduce((acc, stat) => {
          // D-15: books with NULL reference_pages fall through to `acc + 1` (raw page-turn count).
          // This under-counts unenriched books in the weekly estimate; accepted data-quality stance.
          if (stat.total_pages && booksByMd5[stat.book_md5]?.reference_pages) {
            return acc + (1 / stat.total_pages) * booksByMd5[stat.book_md5].reference_pages!;
          } else {
            return acc + 1;
          }
        }, 0) ?? 0
      ),
    [weekData]
  );

  const avgPagesPerDay = useMemo(() => {
    const statsPerDay = groupBy((stat: PageStat) =>
      startOfDay(stat.start_time).getTime().toString()
    )(weekData ?? []);

    const pagesPerDay = Object.values(statsPerDay).map(
      (dayStats) =>
        dayStats?.reduce((acc, stat) => {
          if (stat.total_pages && booksByMd5[stat.book_md5]?.reference_pages) {
            return acc + (1 / stat.total_pages) * booksByMd5[stat.book_md5].reference_pages!;
          } else {
            return acc + 1;
          }
        }, 0) ?? 0
    );

    if (pagesPerDay.length === 0) {
      return '—';
    }

    return Math.round(sum(pagesPerDay) / pagesPerDay.length);
  }, [weekData]);

  const perDay = useMemo(() => {
    const perDayResult = [];

    let day = weekStart;
    while (isBefore(day, weekEnd)) {
      const dayStats = stats?.filter((stat) => isSameDay(stat.start_time, day)) ?? [];

      perDayResult.push({
        day: format(day, 'dd MMM yyyy'),
        weekday: format(day, 'EEE'),
        duration: sum(dayStats.map((s) => s.duration)),
      });

      day = addDays(day, 1).getTime();
    }

    return perDayResult;
  }, [stats, weekStart, weekEnd]);

  return (
    <>
      <Popover position="bottom-start">
        <Popover.Target>
          <Flex align="center" mb="md" gap={4} style={{ cursor: 'pointer' }}>
            <Text c="violet.4" tt="uppercase" size="sm" fw={600}>
              {formatDate(weekStart, 'dd MMM')} - {formatDate(weekEnd, 'dd MMM')}
            </Text>
            <IconCaretDownFilled size={16} color={colors.violet[6]} />
          </Flex>
        </Popover.Target>
        <Popover.Dropdown>
          <DatePicker
            value={new Date(weekStart)}
            maxDate={endOfWeek(new Date(), { weekStartsOn: 1 })}
            onChange={(date) =>
              date && setWeekStart(startOfWeek(date, { weekStartsOn: 1 }).getTime())
            }
          />
        </Popover.Dropdown>
      </Popover>
      <Box mb="md">
        <Text
          style={{ display: 'inline' }}
          variant="gradient"
          gradient={{
            from: colorScheme === 'dark' ? 'violet.4' : 'violet.8',
            to: colorScheme === 'dark' ? 'koinsight.5' : 'koinsight.8',
            deg: 120,
          }}
          fw={900}
        >
          {weekReadTime > 0 ? (
            <>
              You read for {formatSecondsToHumanReadable(weekReadTime)}
              {isCurrentWeek ? ' this week. Keep it up!' : ' during this week.'}
            </>
          ) : isCurrentWeek ? (
            <>You haven't read this week yet. No better time to start!</>
          ) : (
            <>No reading recorded for this week.</>
          )}
        </Text>
      </Box>
      <Statistics
        data={[
          {
            label: 'Read time',
            value: formatSecondsToHumanReadable(weekReadTime),
            icon: IconClock,
          },
          {
            label: 'Pages read',
            value: pagesRead,
            icon: IconPageBreak,
          },
          {
            label: 'Average pages per day',
            value: avgPagesPerDay,
            icon: IconArrowsVertical,
          },
          {
            label: 'Average time per day',
            value: formatSecondsToHumanReadable(Math.round(weekReadTime / weekDaysPassed)),
            icon: IconClock,
          },
        ]}
      />
      <AreaChart
        h={300}
        mt="sm"
        data={perDay}
        dataKey="day"
        gridAxis="none"
        withYAxis={false}
        type="stacked"
        valueFormatter={(value) => formatSecondsToHumanReadable(value)}
        curveType="monotone"
        series={[
          {
            name: 'duration',
            label: 'Reading time',
            color: colorScheme === 'dark' ? 'violet.3' : 'violet.7',
          },
        ]}
      />
      <Title mt="xl" order={3}>
        Per day of the week
      </Title>
      <BarChart
        h={300}
        mt="sm"
        data={perDay}
        dataKey="weekday"
        series={[
          {
            name: 'duration',
            label: 'Reading time',
            color: colorScheme === 'dark' ? 'koinsight.7' : 'koinsight.1',
          },
        ]}
        gridAxis="none"
        withYAxis={false}
        barProps={{
          maxBarSize: 100,
          shape: (props: BarProps) => (
            <CustomBar
              {...props}
              accent={colorScheme === 'dark' ? colors.koinsight[2] : colors.koinsight[8]}
            />
          ),
        }}
        valueFormatter={(value) => formatSecondsToHumanReadable(value)}
      />
    </>
  );
}
