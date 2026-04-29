import { generatePath } from 'react-router';

export enum RoutePath {
  BOOKS = '/books',
  BOOK = '/books/:id',
  CALENDAR = '/calendar/',
  STATS = '/stats',
  STATS_GENERAL = '/stats/general',
  STATS_WEEKLY = '/stats/weekly',
  STATS_YEARLY = '/stats/yearly',
  SYNCS = '/syncs',
  REPORTS = '/reports',
  REPORTS_YEARLY = '/reports/yearly',
  SETTINGS = '/settings',
  SETTINGS_UNMATCHED = '/settings/unmatched',
  SETTINGS_SYNCS = '/settings/syncs',

  HOME = BOOKS,
}

export function getBookPath(bookId: number | string): string {
  return generatePath(RoutePath.BOOK, { id: bookId.toString() });
}
