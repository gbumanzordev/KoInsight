import { Annotation } from './annotation';
import { AuthorRole } from './author';
import { Book } from './book';
import { BookDevice } from './book-device';
import { Genre } from './genre';
import { PageStat } from './page-stat';

export type BookAuthorJoined = {
  name: string;
  nationality: string | null;
  openlibrary_key: string | null;
  position: number;
  role: AuthorRole;
};

type Stats = {
  last_open: number;
  total_read_time: number;
  total_pages: number;
  total_read_pages: number;
  unique_read_pages: number;
  notes: number;
  highlights: number;
  read_per_day: Record<string, number>;
  started_reading: number;
  highlights_count: number;
  notes_count: number;
  bookmarks_count: number;
  deleted_count: number;
};

type RelatedEntities = {
  stats: PageStat[];
  device_data: BookDevice[];
  genres: Genre[];
  annotations: Annotation[];
  authors_full: BookAuthorJoined[];
};

export type BookWithData = Book & Stats & RelatedEntities;
