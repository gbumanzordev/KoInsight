import { z } from 'zod';

// === Search result ===
// Per OL-01 + 03-RESEARCH §Domain Overview
export const SearchDocSchema = z.object({
  key: z.string().regex(/^\/works\/OL[0-9]+W$/),
  title: z.string(),
  author_name: z.array(z.string()).optional(),
  author_key: z.array(z.string()).optional(),
  first_publish_year: z.number().int().optional(),
  isbn: z.array(z.string()).optional(),
  cover_i: z.number().optional(),
});
export type OpenLibrarySearchDoc = z.infer<typeof SearchDocSchema>;

export const SearchResultSchema = z.object({
  numFound: z.number(),
  docs: z.array(SearchDocSchema),
});
export type OpenLibrarySearchResult = z.infer<typeof SearchResultSchema>;

// === Work ===
// Per OL-05: subjects live HERE (not on Edition).
export const WorkSchema = z.object({
  key: z.string(),
  title: z.string(),
  subjects: z.array(z.string()).optional().default([]),
  authors: z
    .array(
      z.object({
        author: z.object({ key: z.string() }),
      })
    )
    .optional()
    .default([]),
  first_publish_date: z.string().optional(),
});
export type OpenLibraryWork = z.infer<typeof WorkSchema>;

// === Edition ===
// Per 03-RESEARCH: subjects on editions are typically empty/sparse; resolver must walk to Work.
export const EditionSchema = z.object({
  key: z.string(),
  works: z.array(z.object({ key: z.string() })).min(1),
  title: z.string().optional(),
  subjects: z.array(z.string()).optional().default([]),
  publish_date: z.string().optional(),
  languages: z.array(z.object({ key: z.string() })).optional(),
  isbn_13: z.array(z.string()).optional(),
  isbn_10: z.array(z.string()).optional(),
  number_of_pages: z.number().int().optional(),
});
export type OpenLibraryEdition = z.infer<typeof EditionSchema>;

// === Author ===
// Per 03-RESEARCH §Pitfall 6: bio is string | {type, value} — union with optional.
// Per WD-01: remote_ids.wikidata may be missing; optional everything except key+name.
const BioSchema = z
  .union([z.string(), z.object({ type: z.string(), value: z.string() })])
  .optional();

export const AuthorSchema = z.object({
  key: z.string(),
  name: z.string(),
  personal_name: z.string().optional(),
  birth_date: z.string().optional(),
  death_date: z.string().optional(),
  bio: BioSchema,
  remote_ids: z
    .object({
      wikidata: z
        .string()
        .regex(/^Q[0-9]+$/)
        .optional(),
      viaf: z.string().optional(),
      isni: z.string().optional(),
    })
    .partial()
    .optional(),
});
export type OpenLibraryAuthor = z.infer<typeof AuthorSchema>;
