// Phase 6 reports repository (RED stub).
//
// Real implementation lands in 06-03-02 (GREEN). The empty exports here exist
// so the integration test file compiles in the RED step and the failing
// assertions surface as test failures instead of import errors.

export async function getYearsWithReading(): Promise<number[]> {
  return [];
}

export async function getBooksReadInYear(
  _yearStartSec: number,
  _yearEndSec: number
): Promise<string[]> {
  return [];
}

export async function getReadingTotalsInYear(
  _yearStartSec: number,
  _yearEndSec: number
): Promise<{ totalReadTimeSec: number; totalPageTurns: number }> {
  return { totalReadTimeSec: 0, totalPageTurns: 0 };
}

export async function getGenresForBooks(
  _md5s: string[]
): Promise<Array<{ md5: string; genre: string | null }>> {
  return [];
}

export async function getPrimaryAuthorNationalities(
  _md5s: string[]
): Promise<Array<{ md5: string; nationality: string | null }>> {
  return [];
}

export async function getPublicationYears(
  _md5s: string[]
): Promise<Array<{ md5: string; publication_year: number | null }>> {
  return [];
}

export async function getOriginalLanguages(
  _md5s: string[]
): Promise<Array<{ md5: string; original_language: string | null }>> {
  return [];
}

export async function getCoverageCounts(_md5s: string[]): Promise<{
  total_books: number;
  genre_known: number;
  nationality_known: number;
  publication_year_known: number;
  original_language_known: number;
}> {
  return {
    total_books: 0,
    genre_known: 0,
    nationality_known: 0,
    publication_year_known: 0,
    original_language_known: 0,
  };
}
