export type FieldSource = 'openlibrary' | 'manual';

export type AuthorRole = 'author' | 'editor';

export type Author = {
  id: number;
  name: string;
  openlibrary_key: string | null;
  wikidata_qid: string | null;
  nationality: string | null; // ISO 3166-1 alpha-2 when set
  nationality_source: FieldSource | null;
  bio: string | null;
  created_at: string; // ISO timestamp from SQLite
  updated_at: string;
};

export type BookAuthor = {
  id: number;
  book_md5: string;
  author_id: number;
  position: number; // 0 = primary author
  role: AuthorRole;
};
