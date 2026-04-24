import { z } from 'zod';

// Phase 5 Plan 01 (EDIT-01, EDIT-02):
// Shared Zod schema for PATCH /api/books/:bookId/metadata. Server validates the
// raw request body via metadataPatchSchema.safeParse(); the same schema is
// reused in the web edit form via mantine-form-zod-resolver.
//
// Strict mode rejects unknown keys at the boundary (T-05-01 mass-assignment
// mitigation: id, md5, enrichment_status, *_source columns are not in the
// schema, so they cannot be written through this endpoint).

export const authorEditSchema = z.object({
  name: z.string().trim().min(1, 'Author name is required'),
  nationality: z
    .string()
    .regex(/^[A-Z]{2}$/, 'Nationality must be ISO 3166-1 alpha-2')
    .nullable()
    .optional(),
  // D-05: OL key is read-only on the form; null = explicit unlink. Users cannot
  // type a new key, but the schema accepts whatever the form submits unchanged.
  openlibrary_key: z.string().nullable().optional(),
});

export const metadataPatchSchema = z
  .object({
    authors: z.array(authorEditSchema).min(1).max(50).optional(),
    genres: z.array(z.string()).max(50).optional(),
    publication_year: z
      .number()
      .int()
      .min(1000, 'Year must be between 1000 and 2100')
      .max(2100, 'Year must be between 1000 and 2100')
      .nullable()
      .optional(),
    original_language: z
      .string()
      .regex(/^[a-z]{2}$/, 'Original language must be ISO 639-1 lowercase')
      .nullable()
      .optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: 'No fields to update' });

export type AuthorEdit = z.infer<typeof authorEditSchema>;
export type MetadataPatch = z.infer<typeof metadataPatchSchema>;
