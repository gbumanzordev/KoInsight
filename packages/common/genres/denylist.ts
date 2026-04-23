// Denylist of OL subjects that are format, marketing, provenance, or
// too-broad-to-be-useful labels rather than genres (D-06). Matched by exact
// normalized form only (D-13, D-15); no substring, no regex. Entries are stored
// in display case here and normalized at module-load time in map.ts.
export const SUBJECT_DENYLIST: ReadonlySet<string> = new Set([
  // CONTEXT D-13 minimums
  'Accessible book',
  'Protected DAISY',
  'Large type books',
  'In library',
  'New York Times bestseller',
  'Overdrive',
  'Book club edition',
  'Fiction',
  'Nonfiction',
  'Non-fiction',
  'Non fiction',
  'Non-Fiction',

  // Format / distribution tags
  'Audiobook',
  'Ebook',
  'E-book',
  'Hardcover',
  'Paperback',
  'Large print',
  'Braille books',
  'Talking books',
  'OverDrive Read',
  'Coloring books',

  // OL-specific curation markers
  'Open Library Staff Picks',
  'Long Now Manual for Civilization',
  'New York Times reviewed',
  'Hugo Award Winner',
  'Quill Award winner',
  'Alex Award winner',

  // Generic placeholders and bibliographic artifacts
  'General',
  'Gift books',
  'Telephone directories',
  'Early works to 1850',
  'Readers',
  'Novel',
  'Roman',
  'Novela',
  'Ficción',
  'Fiction, general',

  // Language and nation meta tags (D-05)
  'English language',
  'English literature',
  'American literature',
  'British and irish fiction (fictional works by one author)',
  'British and Irish fiction (fictional works by one author)',
  'English fiction',
  'Arabic language materials',

  // Reading-level noise (Martian subjects)
  'Reading Level-Grade 7',
  'Reading Level-Grade 8',
  'Reading Level-Grade 9',
  'Reading Level-Grade 10',
  'Reading Level-Grade 11',
  'Reading Level-Grade 12',
  'Reading level-grade 7',
  'Reading level-grade 8',
  'Reading level-grade 9',
  'Reading level-grade 10',
  'Reading level-grade 11',
  'Reading level-grade 12',

  // Other noise observed in fixtures
  'Adaptations',
  'Juvenile audience',
]);
