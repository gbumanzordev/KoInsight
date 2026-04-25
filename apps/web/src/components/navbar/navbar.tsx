import {
  ActionIcon,
  Box,
  Flex,
  Indicator,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconBooks,
  IconCalendar,
  IconChartBar,
  IconDownload,
  IconMoon,
  IconReload,
  IconReport,
  IconSettings,
  IconSun,
} from '@tabler/icons-react';
import { JSX, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useEnrichmentStatus } from '../../api/enrichment';
import { RoutePath } from '../../routes';
import { Logo } from '../logo/logo';
import { DownloadPluginModal } from './download-plugin';
import { UploadForm } from './upload-form';

import style from './navbar.module.css';

export function Navbar({ onNavigate }: { onNavigate?: () => void }): JSX.Element {
  const { pathname } = useLocation();
  const { setColorScheme } = useMantineColorScheme();
  const computedColorScheme = useComputedColorScheme();
  const toggleColorScheme = () => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark');
  };

  const [downloadOpened, { close: closeDownload, open: openDownload }] = useDisclosure(false);

  // Phase 5 Plan 05 (UI-04, D-09): shared SWR key with the Settings page so a
  // single 5s poll feeds both the Navbar Indicator and the stat cards.
  const { data: status } = useEnrichmentStatus();

  const tabs = [
    { link: RoutePath.BOOKS, label: 'Books', icon: IconBooks },
    { link: RoutePath.CALENDAR, label: 'Calendar', icon: IconCalendar },
    { link: RoutePath.STATS, label: 'Reading stats', icon: IconChartBar },
    { link: RoutePath.REPORTS_YEARLY, label: 'Reports', icon: IconReport },
    { link: RoutePath.SYNCS, label: 'Progress syncs', icon: IconReload },
    { link: RoutePath.SETTINGS, label: 'Settings', icon: IconSettings },
    { onClick: openDownload, label: 'KOReader Plugin', icon: IconDownload },
  ];

  const [active, setActive] = useState(
    () => tabs.find((item) => item.link === pathname)?.link ?? RoutePath.HOME
  );

  const onClick = (link: RoutePath) => {
    setActive(link);
    onNavigate?.();
  };

  const links = tabs.map((item) => {
    if (item.link) {
      const navLink = (
        <NavLink
          className={style.Link}
          data-active={item.link === active || undefined}
          to={item.link}
          onClick={() => onClick(item.link)}
        >
          <item.icon className={style.LinkIcon} stroke={1.5} />
          <span>{item.label}</span>
        </NavLink>
      );
      // Phase 5 Plan 05 (D-09, Pitfall 7): wrap the Settings nav item with a
      // Mantine Indicator showing the failed count. Use disabled={!status?.failed}
      // so the badge hides when the count is zero (never label={0}).
      if (item.link === RoutePath.SETTINGS) {
        return (
          <Indicator
            key={item.label}
            label={status?.failed}
            disabled={!status?.failed}
            color="red"
            size={16}
            offset={6}
            position="top-end"
            inline
          >
            {navLink}
          </Indicator>
        );
      }
      return <span key={item.label}>{navLink}</span>;
    }
    return (
      <a className={style.Link} key={item.label} onClick={() => item.onClick()}>
        <item.icon className={style.LinkIcon} stroke={1.5} />
        <span>{item.label}</span>
      </a>
    );
  });

  return (
    <Box className={style.Navbar} component="nav">
      <Logo
        onClick={() => {
          setActive(RoutePath.HOME);
          onNavigate?.();
        }}
        className={style.Logo}
      />
      <div>{links}</div>
      <div className={style.Footer}>
        <Flex gap="xs">
          <UploadForm />
          <ActionIcon
            onClick={toggleColorScheme}
            variant="default"
            size="lg"
            aria-label="Toggle color scheme"
          >
            {computedColorScheme === 'dark' ? (
              <IconSun stroke={1.5} color="yellow" />
            ) : (
              <IconMoon stroke={1.5} color="violet" />
            )}
          </ActionIcon>
        </Flex>
      </div>
      <DownloadPluginModal opened={downloadOpened} onClose={closeDownload} />
    </Box>
  );
}
