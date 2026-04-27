import type { YearlyReport, YearsResponse } from '@koinsight/common/types/reports-api';
import useSWR from 'swr';
import { fetchFromAPI } from './api';

// Phase 6 Plan 06 (D-09): SWR hooks for the yearly report. The years list uses
// a STRING key so the YearNavigator and the page share one cache entry; the
// yearly hook uses a tuple key so a year change re-keys SWR and the previous
// year stays cached for instant back/forward navigation. No refreshInterval:
// yearly aggregates do not change between page loads in normal use.

const YEARS_KEY = 'reports/years';

export function useReportYears() {
  return useSWR<YearsResponse>(YEARS_KEY, () => fetchFromAPI<YearsResponse>('reports/years'));
}

export function useReportYearly(year: number | null) {
  return useSWR<YearlyReport>(year ? ['reports/yearly', year] : null, () =>
    fetchFromAPI<YearlyReport>('reports/yearly', 'GET', { year: year! })
  );
}
