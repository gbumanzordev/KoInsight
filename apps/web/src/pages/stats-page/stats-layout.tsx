import { Box, Stack, Title } from '@mantine/core';
import { IconCalendarWeek, IconChartBar, IconReport } from '@tabler/icons-react';
import { JSX } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { RoutePath } from '../../routes';
import style from './stats-layout.module.css';

const sections = [
  { to: RoutePath.STATS_GENERAL, label: 'General', icon: IconChartBar },
  { to: RoutePath.STATS_WEEKLY, label: 'Weekly', icon: IconCalendarWeek },
  { to: RoutePath.STATS_YEARLY, label: 'Yearly', icon: IconReport },
];

export function StatsLayout(): JSX.Element {
  const { pathname } = useLocation();
  return (
    <Box className={style.layout}>
      <Stack className={style.rail} gap="xs">
        <Title order={3}>Insights</Title>
        {sections.map((s) => (
          <NavLink
            key={s.to}
            to={s.to}
            className={style.navLink}
            data-active={pathname.startsWith(s.to) || undefined}
          >
            <s.icon size={16} stroke={1.5} />
            <span>{s.label}</span>
          </NavLink>
        ))}
      </Stack>
      <Box className={style.content}>
        <Outlet />
      </Box>
    </Box>
  );
}
