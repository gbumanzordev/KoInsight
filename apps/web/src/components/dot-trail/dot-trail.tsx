import { darken, Tooltip, useComputedColorScheme } from '@mantine/core';
import { useResizeObserver } from '@mantine/hooks';
import { startOfDay, startOfWeek, subDays } from 'date-fns';
import { JSX, ReactNode, useMemo } from 'react';

import style from './dot-trail.module.css';

export type DayData = {
  percent: number;
  tooltip: ReactNode;
};

type DotTrailProps = {
  percentPerDay: Record<number, DayData>;
  startDate?: Date;
  endDate?: Date;
};

export function DotTrail({ percentPerDay, startDate, endDate }: DotTrailProps): JSX.Element {
  const [ref, rect] = useResizeObserver();
  const colorScheme = useComputedColorScheme();

  const today = startOfDay(endDate ?? new Date());

  const dotsToFit = Math.floor((rect.width - 18) / 18);
  const daysToFit = dotsToFit * 7;

  const start = startDate
    ? startOfDay(
        startOfWeek(startDate, { locale: { options: { weekStartsOn: 1 } } })
      )
    : startOfDay(
        startOfWeek(subDays(today, daysToFit), { locale: { options: { weekStartsOn: 1 } } })
      );

  const getOutlineColor = (percent?: number): string => {
    const backgound = colorScheme === 'light' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.1)';

    return percent ? darken(`rgba(35, 186, 175, ${percent / 100})`, 0.4) : backgound;
  };
  const getBackgroundColor = (percent?: number): string => {
    const backgound = colorScheme === 'dark' ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255)';
    return percent ? `rgba(35, 186, 175, ${percent / 100})` : backgound;
  };

  const allDays = useMemo(() => {
    const days = [];
    let current = start;
    while (current <= today) {
      days.push(startOfDay(current.getTime()).valueOf());
      current = new Date(current.getTime() + 24 * 60 * 60 * 1000);
    }

    return days;
  }, [start, today]);

  return (
    <div className={style.DotGrid} ref={ref}>
      {allDays.map((day, id) => (
        <div key={id}>
          <Tooltip
            withArrow
            label={
              percentPerDay[day]
                ? percentPerDay[day].tooltip
                : `No data for ${new Date(day).toDateString()}`
            }
          >
            <div
              key={day}
              className={style.Dot}
              style={{
                outlineColor: getOutlineColor(percentPerDay[day]?.percent),
                backgroundColor: getBackgroundColor(percentPerDay[day]?.percent),
              }}
            />
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
