import { Alert, Flex, Loader, Stack, Title } from '@mantine/core';
import { parseAsInteger, useQueryState } from 'nuqs';
import { JSX } from 'react';
import { useReportYearly, useReportYears } from '../../api/reports';
import { CoverageBanner } from './charts/coverage-banner';
import { DecadeHistogram } from './charts/decade-histogram';
import { GenreBar } from './charts/genre-bar';
import { HeadlineCards } from './charts/headline-cards';
import { LanguagePie } from './charts/language-pie';
import { NationalityBar } from './charts/nationality-bar';
import { EmptyYearState } from './empty-state';
import style from './reports-yearly-page.module.css';
import { YearNavigator } from './year-navigator';

// Phase 6 Plan 06 Task 02 (REPORT-UI-01, REPORT-UI-02, REPORT-UI-05): page
// shell for the yearly report. Fetches the years list first, then the report
// for the selected year. Renders a Loader while either request is pending,
// the empty state when total_books === 0, or the charts area placeholder
// otherwise. The charts themselves are filled in by Plan 06-07.

export function ReportsYearlyPage(): JSX.Element {
  const { data: yearsData, isLoading: yearsLoading, error: yearsError } = useReportYears();

  const years = yearsData?.years ?? [];
  const fallbackYear = years[0] ?? new Date().getFullYear();
  const [year] = useQueryState('year', parseAsInteger.withDefault(fallbackYear));

  const {
    data: report,
    isLoading: reportLoading,
    error: reportError,
  } = useReportYearly(years.length > 0 ? year : null);

  if (yearsLoading) {
    return (
      <div className={style.page}>
        <Flex className={style.loaderWrap}>
          <Loader />
        </Flex>
      </div>
    );
  }

  if (yearsError) {
    return (
      <div className={style.page}>
        <Alert color="red" title="Could not load report years">
          Refresh the page or try again later.
        </Alert>
      </div>
    );
  }

  if (years.length === 0) {
    return (
      <div className={style.page}>
        <Title mb="lg">Yearly report</Title>
        <EmptyYearState year={fallbackYear} />
      </div>
    );
  }

  return (
    <div className={style.page}>
      <div className={style.header}>
        <Title>Yearly report</Title>
        <YearNavigator years={years} />
      </div>

      {reportError && (
        <Alert color="red" title="Could not load yearly report">
          Refresh the page or try again later.
        </Alert>
      )}

      {!reportError && (reportLoading || !report) && (
        <Flex className={style.loaderWrap}>
          <Loader />
        </Flex>
      )}

      {!reportError &&
        report &&
        report.coverage.total_books === 0 &&
        report.totals.totalPageTurns === 0 && <EmptyYearState year={report.year} />}

      {!reportError &&
        report &&
        (report.coverage.total_books > 0 || report.totals.totalPageTurns > 0) && (
          <Stack gap="lg">
            <Title order={3}>{report.year}</Title>

            <HeadlineCards totals={report.totals} />

            {report.coverage.total_books > 0 && (
              <>
                <Stack gap="xs">
                  <Title order={3}>Genres</Title>
                  <GenreBar data={report.genre} />
                  <CoverageBanner
                    known={report.coverage.genre_known}
                    total={report.coverage.total_books}
                    label="Genres"
                  />
                </Stack>

                <Stack gap="xs">
                  <Title order={3}>Nationality</Title>
                  <NationalityBar data={report.nationality} />
                  <CoverageBanner
                    known={report.coverage.nationality_known}
                    total={report.coverage.total_books}
                    label="Nationality"
                  />
                </Stack>

                <Stack gap="xs">
                  <Title order={3}>Publication decade</Title>
                  <DecadeHistogram data={report.decade} />
                  <CoverageBanner
                    known={report.coverage.publication_year_known}
                    total={report.coverage.total_books}
                    label="Publication year"
                  />
                </Stack>

                <Stack gap="xs">
                  <Title order={3}>Original language</Title>
                  <LanguagePie data={report.language} />
                  <CoverageBanner
                    known={report.coverage.original_language_known}
                    total={report.coverage.total_books}
                    label="Original language"
                  />
                </Stack>
              </>
            )}
          </Stack>
        )}
    </div>
  );
}
