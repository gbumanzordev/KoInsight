// Phase 6 Plan 01: shared wire-format types for /api/reports/*.
// Pure TypeScript per CLAUDE.md ("@koinsight/common stays runtime-free");
// the router-level Zod schema lives in apps/server/src/reports/reports-router.ts.
// Consumed by both apps/server (response shape) and apps/web (SWR fetcher generics).

export type YearlyReportBucket = { key: string; count: number };

export type YearlyReportBook = {
  md5: string;
  id: number;
  title: string;
  authors: string | null;
  original_language: string | null;
};

export type YearlyReport = {
  year: number;
  totals: { books: number; pages: number; readTimeSeconds: number };
  genre: YearlyReportBucket[];
  nationality: YearlyReportBucket[]; // includes 'Other' + 'Unknown' per CONTEXT D-03 / D-07
  decade: YearlyReportBucket[]; // zero-filled gaps; trailing 'Unknown' per CONTEXT D-05
  language: YearlyReportBucket[];
  books: YearlyReportBook[];
  coverage: {
    total_books: number;
    genre_known: number;
    nationality_known: number;
    publication_year_known: number;
    original_language_known: number;
  };
};

export type YearsResponse = { years: number[] };
