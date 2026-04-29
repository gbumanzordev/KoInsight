import {
  Anchor,
  Box,
  Burger,
  createTheme,
  Drawer,
  Flex,
  Group,
  MantineProvider,
  Stack,
  Text,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { IconError404, IconHeart } from '@tabler/icons-react';
import { JSX } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import style from './app.module.css';
import { Logo } from './components/logo/logo';
import { Navbar } from './components/navbar/navbar';
import { BookPage } from './pages/book-page/book-page';
import { BooksPage } from './pages/books-page/books-page';
import { CalendarPage } from './pages/calendar-page';
import { ReportsYearlyPage } from './pages/reports-yearly-page/reports-yearly-page';
import { SettingsLayout } from './pages/settings-page/settings-layout';
import { UnmatchedBooksSection } from './pages/settings-page/unmatched-books-section';
import { GeneralStatsPage } from './pages/stats-page/general-stats-page';
import { StatsLayout } from './pages/stats-page/stats-layout';
import { WeeklyStatsPage } from './pages/stats-page/weekly-stats-page';
import { SyncsPage } from './pages/syncs-page';
import { RoutePath } from './routes';

const theme = createTheme({
  headings: { fontFamily: 'Noto Serif, serif' },
  primaryColor: 'koinsight',
  primaryShade: 8,
  colors: {
    koinsight: [
      '#e2fefc',
      '#d3f8f5',
      '#acede8',
      '#81e3dc',
      '#5edad1',
      '#46d5ca',
      '#36d2c7',
      '#23baaf',
      '#0aa69c',
      '#009087',
    ],
  },
});

export function App(): JSX.Element {
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const version = __APP_VERSION__;
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      <ModalsProvider>
        <Notifications />
        <div className={style.Shell}>
        <div className={style.App}>
          <Group hiddenFrom="md" align="center" gap="sm" mb="lg" ml="md">
            <Burger size="sm" onClick={() => openDrawer()} />
            <Logo />
          </Group>
          <Drawer opened={drawerOpened} onClose={closeDrawer}>
            <Navbar onNavigate={closeDrawer} />
          </Drawer>
          <Box visibleFrom="md">
            <Navbar />
          </Box>
          <main className={style.Main}>
            <Routes>
              <Route index element={<Navigate to={RoutePath.BOOKS} />} />
              <Route path={RoutePath.BOOKS} element={<BooksPage />} />
              <Route path={RoutePath.BOOK} element={<BookPage />} />
              <Route path={RoutePath.CALENDAR} element={<CalendarPage />} />
              <Route path={RoutePath.STATS} element={<StatsLayout />}>
                <Route index element={<Navigate to="general" replace />} />
                <Route path="general" element={<GeneralStatsPage />} />
                <Route path="weekly" element={<WeeklyStatsPage />} />
                <Route path="yearly" element={<ReportsYearlyPage />} />
              </Route>
              <Route path={RoutePath.SYNCS} element={<Navigate to={RoutePath.SETTINGS_SYNCS} replace />} />
              <Route path={RoutePath.SETTINGS} element={<SettingsLayout />}>
                <Route index element={<Navigate to="unmatched" replace />} />
                <Route path="unmatched" element={<UnmatchedBooksSection />} />
                <Route path="syncs" element={<SyncsPage />} />
              </Route>
              <Route path={RoutePath.REPORTS}>
                <Route index element={<Navigate to={RoutePath.STATS_YEARLY} replace />} />
                <Route path="yearly" element={<Navigate to={RoutePath.STATS_YEARLY} replace />} />
              </Route>
              {/* Catch-all route goes last */}
              <Route
                path="*"
                element={
                  <Stack align="center" justify="center" style={{ height: '100%' }}>
                    <IconError404 size={144} /> Page not found 😢
                  </Stack>
                }
              />
            </Routes>
          </main>
        </div>
        <Text size="xs" ta="center" c="dimmed" py={4}>
          Made with <IconHeart size={10} /> by{' '}
          <Anchor href="https://gar.dev" target="_blank">
            gar.dev
          </Anchor>
          . {version}
        </Text>
        </div>
      </ModalsProvider>
    </MantineProvider>
  );
}
