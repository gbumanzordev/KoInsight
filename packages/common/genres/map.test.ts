import { describe, expect, it } from 'vitest';

import { mapOpenLibrarySubjects } from './map';
import {
  ACOMAF_SUBJECTS,
  DUNE_SUBJECTS,
  FOUNDATION_SUBJECTS,
  LOTR_SUBJECTS,
  MARTIAN_SUBJECTS,
  MISTBORN_SUBJECTS,
  NAME_OF_THE_WIND_SUBJECTS,
  PRIDE_AND_PREJUDICE_SUBJECTS,
  SAPIENS_SUBJECTS,
  THINKING_FAST_SLOW_SUBJECTS,
} from './map.fixtures';

describe('mapOpenLibrarySubjects', () => {
  // Real-fixture tests (10)
  it('maps FOUNDATION_SUBJECTS to include Science Fiction', () => {
    expect(mapOpenLibrarySubjects([...FOUNDATION_SUBJECTS])).toContain('Science Fiction');
  });

  it('maps LOTR_SUBJECTS to include Fantasy', () => {
    expect(mapOpenLibrarySubjects([...LOTR_SUBJECTS])).toContain('Fantasy');
  });

  it('maps LOTR_SUBJECTS to include Epic Fantasy', () => {
    expect(mapOpenLibrarySubjects([...LOTR_SUBJECTS])).toContain('Epic Fantasy');
  });

  it('maps ACOMAF_SUBJECTS to include Fantasy', () => {
    expect(mapOpenLibrarySubjects([...ACOMAF_SUBJECTS])).toContain('Fantasy');
  });

  it('maps ACOMAF_SUBJECTS to include Romance via Love & Romance alias', () => {
    expect(mapOpenLibrarySubjects([...ACOMAF_SUBJECTS])).toContain('Romance');
  });

  it('maps MARTIAN_SUBJECTS to include Science Fiction', () => {
    expect(mapOpenLibrarySubjects([...MARTIAN_SUBJECTS])).toContain('Science Fiction');
  });

  it('maps MISTBORN_SUBJECTS to include Fantasy', () => {
    expect(mapOpenLibrarySubjects([...MISTBORN_SUBJECTS])).toContain('Fantasy');
  });

  it('maps SAPIENS_SUBJECTS to include History', () => {
    expect(mapOpenLibrarySubjects([...SAPIENS_SUBJECTS])).toContain('History');
  });

  it('maps DUNE_SUBJECTS to include Science Fiction', () => {
    expect(mapOpenLibrarySubjects([...DUNE_SUBJECTS])).toContain('Science Fiction');
  });

  it('maps NAME_OF_THE_WIND_SUBJECTS to include Fantasy', () => {
    expect(mapOpenLibrarySubjects([...NAME_OF_THE_WIND_SUBJECTS])).toContain('Fantasy');
  });

  // Boundary tests (10)
  it('returns [] for empty input', () => {
    expect(mapOpenLibrarySubjects([])).toEqual([]);
  });

  it('returns [] when every subject is denylisted (GENRE-04)', () => {
    expect(
      mapOpenLibrarySubjects([
        'Protected DAISY',
        'Accessible book',
        'Fiction',
        'New York Times bestseller',
        'In library',
      ])
    ).toEqual([]);
  });

  it('returns [] when no subject matches canonical or alias', () => {
    expect(
      mapOpenLibrarySubjects(['Telephone directories', 'Romans, nouvelles', 'Pr6039.o32 l6 2005'])
    ).toEqual([]);
  });

  it('matches case-insensitively', () => {
    expect(mapOpenLibrarySubjects(['science fiction'])).toEqual(['Science Fiction']);
  });

  it('normalizes surrounding and collapsed whitespace', () => {
    expect(mapOpenLibrarySubjects(['  Science   Fiction  '])).toEqual(['Science Fiction']);
  });

  it('de-duplicates repeated hits by canonical name', () => {
    expect(mapOpenLibrarySubjects(['Science Fiction', 'Science Fiction', 'sci-fi'])).toEqual([
      'Science Fiction',
    ]);
  });

  it('preserves first-hit order across distinct canonicals', () => {
    expect(mapOpenLibrarySubjects(['Fantasy', 'Science Fiction'])).toEqual([
      'Fantasy',
      'Science Fiction',
    ]);
  });

  it('splits compound subjects on no-space double dash and drops all-noise fragments', () => {
    expect(mapOpenLibrarySubjects(['Middle earth (imaginary place)--fiction']).length).toBe(0);
  });

  it('splits compound subjects on comma-space and keeps matching fragments', () => {
    expect(mapOpenLibrarySubjects(['Fantasy fiction, American'])).toEqual(['Fantasy']);
  });

  it('handles mixed double-dash and comma-space compounds', () => {
    const result = mapOpenLibrarySubjects(['Science fiction -- Fantasy fiction, American']);
    expect(result).toContain('Science Fiction');
    expect(result).toContain('Fantasy');
  });

  // Alias and edge tests (5)
  it('maps sci-fi alias to Science Fiction', () => {
    expect(mapOpenLibrarySubjects(['sci-fi'])).toEqual(['Science Fiction']);
  });

  it('maps YA alias case-insensitively to Young Adult', () => {
    expect(mapOpenLibrarySubjects(['YA'])).toEqual(['Young Adult']);
  });

  it('maps love & romance alias to Romance', () => {
    expect(mapOpenLibrarySubjects(['love & romance'])).toEqual(['Romance']);
  });

  it('drops machine-generated prefix tags silently', () => {
    expect(
      mapOpenLibrarySubjects([
        'nyt:bestseller-2020-01-01',
        'collectionID:Foo',
        'series:Wheel_of_Time',
      ])
    ).toEqual([]);
  });

  it('drops denylisted fragment inside a compound and keeps the matching one', () => {
    expect(mapOpenLibrarySubjects(['Fantasy, General'])).toEqual(['Fantasy']);
  });
});
