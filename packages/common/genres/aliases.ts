import type { CanonicalGenre } from './canonical.js';

// Alias keys are raw OL subject fragments. At lookup time they are normalized
// via trim + lowercase + whitespace-collapse (D-08); keys here are stored
// already-normalized (lowercase) to avoid double-normalization confusion.
// Values MUST be members of CANONICAL_GENRES; the CanonicalGenre type enforces
// this at TypeScript compile time (D-17, T-02-04 in threat register).
export const GENRE_ALIASES: Record<string, CanonicalGenre> = {
  // Science Fiction variants
  'sci-fi': 'Science Fiction',
  sf: 'Science Fiction',
  'science-fiction': 'Science Fiction',
  'science fiction & fantasy': 'Science Fiction',
  'american science fiction': 'Science Fiction',
  'english science fiction': 'Science Fiction',

  // Fantasy variants
  'fantasy fiction': 'Fantasy',
  'english fantasy fiction': 'Fantasy',
  'american fantasy fiction': 'Fantasy',
  'fantasy & magic': 'Fantasy',
  'fantasy fiction, english': 'Fantasy',
  'fantasy fiction, american': 'Fantasy',
  fantasy: 'Fantasy',
  'novela fantástica': 'Fantasy',
  fantasía: 'Fantasy',

  // Epic fantasy variants (compound subjects like "Fiction, fantasy, epic"
  // split to the literal fragment "epic" which maps here).
  epic: 'Epic Fantasy',
  'epic fiction': 'Epic Fantasy',
  'high fantasy': 'Epic Fantasy',
  'genre:high fantasy': 'Epic Fantasy',

  // Young Adult
  ya: 'Young Adult',
  'young adult fiction': 'Young Adult',
  'young-adult': 'Young Adult',
  'adult books for young adults': 'Young Adult',

  // Romance
  'love & romance': 'Romance',
  'love stories': 'Romance',
  'romance fiction': 'Romance',

  // Historical Romance
  'fiction, romance, historical': 'Historical Romance',
  'fiction, romance, historical, general': 'Historical Romance',
  'fiction, romance, historical, regency': 'Historical Romance',

  // Mystery / Detective / Thriller
  'mystery fiction': 'Mystery',
  'mystery and detective stories': 'Mystery',
  'detective and mystery stories': 'Detective Fiction',
  'thrillers (fiction)': 'Thriller',
  'suspense & thriller': 'Thriller',
  suspense: 'Thriller',

  // Horror
  'horror fiction': 'Horror',
  'horror tales': 'Horror',

  // Biography / Memoir
  biographies: 'Biography',
  'biography & autobiography': 'Biography',
  memoirs: 'Memoir',

  // Children's
  "children's stories": "Children's Fiction",
  "children's fiction": "Children's Fiction",
  'juvenile literature': "Children's Fiction",
  'picture books': "Children's Fiction",

  // Comics / Graphic Novels
  'graphic novel': 'Graphic Novels',
  'comic books, strips, etc.': 'Comics',
  'comic books, strips': 'Comics',

  // Historical Fiction
  'historical novels': 'Historical Fiction',
  'historical fiction': 'Historical Fiction',

  // Self-help
  'self help': 'Self-Help',
  'self-help techniques': 'Self-Help',

  // Poetry / Short stories
  poems: 'Poetry',
  'short stories, american': 'Short Stories',
  'short stories, english': 'Short Stories',

  // History
  'world history': 'History',
  'military history': 'Military History',
  'ancient history': 'Ancient History',

  // Classics
  'fiction classics': 'Classics',
  'classical literature': 'Classics',

  // Adventure
  'action & adventure': 'Adventure',
};
