// Canonical genre vocabulary. Source of truth for the seed migration (SCHEMA-06)
// and for mapOpenLibrarySubjects (GENRE-02). Title Case, flat, English-only per
// CONTEXT D-03, D-04, D-05. Expand or trim but keep length in [60, 80] (D-02).
//
// Entries describe what a book is about (D-06); format and distribution labels
// (Audiobook, Paperback, Large type books, Accessible book, etc.) belong in the
// denylist, not here. Blanket umbrellas "Fiction" and "Nonfiction" also live on
// the denylist per D-13; they are too broad to be useful in reports.
export const CANONICAL_GENRES = [
  // Fiction - Genre core
  'Fantasy',
  'Epic Fantasy',
  'Urban Fantasy',
  'Sword and Sorcery',
  'Dark Fantasy',
  'Portal Fantasy',
  'Historical Fantasy',
  'Magical Realism',
  'Science Fiction',
  'Hard Science Fiction',
  'Space Opera',
  'Cyberpunk',
  'Dystopian',
  'Post-Apocalyptic',
  'Time Travel',
  'First Contact',
  'Military Science Fiction',
  'Mystery',
  'Detective Fiction',
  'Cozy Mystery',
  'Thriller',
  'Crime Fiction',
  'Horror',
  'Gothic Fiction',
  'Romance',
  'Historical Romance',
  'Paranormal Romance',
  'Western',

  // Fiction - Form / Audience
  'Literary Fiction',
  'Classics',
  'Historical Fiction',
  'Contemporary Fiction',
  'Young Adult',
  'Middle Grade',
  "Children's Fiction",
  'Graphic Novels',
  'Comics',
  'Short Stories',

  // Fiction - Misc / Themes
  'Adventure',
  'War Fiction',
  'Spy Fiction',
  'Humor',
  'Satire',
  'Magic',

  // Non-fiction - Core
  'Biography',
  'Autobiography',
  'Memoir',
  'History',
  'Military History',
  'Ancient History',
  'Philosophy',
  'Psychology',
  'Science',
  'Physics',
  'Mathematics',
  'Biology',
  'Astronomy',
  'Technology',
  'Computer Science',
  'Economics',
  'Business',
  'Politics',
  'Sociology',
  'Anthropology',
  'Religion',
  'Self-Help',

  // Non-fiction - Arts & Lifestyle
  'Art',
  'Music',
  'Travel',
  'Cooking',
  'Health',
  'Nature',
  'Essays',
  'Journalism',

  // Poetry / Drama
  'Poetry',
  'Drama',
] as const;

// String-literal union of the exact names in CANONICAL_GENRES.
// Edits to the tuple automatically update this type (D-17).
export type CanonicalGenre = (typeof CANONICAL_GENRES)[number];
