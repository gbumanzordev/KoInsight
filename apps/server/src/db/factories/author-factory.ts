import { faker } from '@faker-js/faker';
import { Knex } from 'knex';

export type AuthorRow = {
  id: number;
  name: string;
  openlibrary_key: string | null;
  wikidata_qid: string | null;
  nationality: string | null;
  nationality_source: 'openlibrary' | 'manual' | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
};

type FakeAuthor = Omit<AuthorRow, 'id' | 'created_at' | 'updated_at'>;

// Caller must pass unique `name` overrides when seeding multiple rows (UNIQUE(name) constraint).
export function fakeAuthor(overrides: Partial<FakeAuthor> = {}): FakeAuthor {
  return {
    name: faker.person.fullName(),
    openlibrary_key: null,
    wikidata_qid: null,
    nationality: null,
    nationality_source: null,
    bio: null,
    ...overrides,
  };
}

export async function createAuthor(
  db: Knex,
  overrides: Partial<FakeAuthor> = {}
): Promise<AuthorRow> {
  const data = fakeAuthor(overrides);
  const [row] = await db<AuthorRow>('author').insert(data).returning('*');
  return row;
}
