import { Box, Stack, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { JSX } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { RoutePath } from '../../routes';
import style from './settings-layout.module.css';

// Phase 5 Plan 05 (D-07, D-08): Settings shell. Two-pane: left rail of section
// NavLinks + right content via <Outlet />. Only "Unmatched books" ships in this
// phase; the array structure accommodates future sections (user/password,
// import debug, backfill) without rework.
const sections = [
  { to: RoutePath.SETTINGS_UNMATCHED, label: 'Unmatched books', icon: IconAlertCircle },
];

export function SettingsLayout(): JSX.Element {
  const { pathname } = useLocation();
  return (
    <Box className={style.layout}>
      <Stack className={style.rail} gap="xs">
        <Title order={3}>Settings</Title>
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
