import { describe, expect, it } from 'vitest';
import { metadataPatchSchema, authorEditSchema } from './books-edit-api';

describe('authorEditSchema', () => {
  it('rejects empty author name', () => {
    const result = authorEditSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a minimal author with only name', () => {
    const result = authorEditSchema.safeParse({ name: 'Asimov' });
    expect(result.success).toBe(true);
  });

  it('rejects lowercase nationality', () => {
    const result = authorEditSchema.safeParse({ name: 'Asimov', nationality: 'usa' });
    expect(result.success).toBe(false);
  });
});

describe('metadataPatchSchema', () => {
  it('accepts valid publication_year', () => {
    const result = metadataPatchSchema.safeParse({ publication_year: 1953 });
    expect(result.success).toBe(true);
  });

  it('rejects publication_year below 1000', () => {
    const result = metadataPatchSchema.safeParse({ publication_year: 999 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('between 1000 and 2100');
    }
  });

  it('rejects publication_year above 2100', () => {
    const result = metadataPatchSchema.safeParse({ publication_year: 2101 });
    expect(result.success).toBe(false);
  });

  it('rejects uppercase original_language', () => {
    const result = metadataPatchSchema.safeParse({ original_language: 'EN' });
    expect(result.success).toBe(false);
  });

  it('accepts lowercase original_language', () => {
    const result = metadataPatchSchema.safeParse({ original_language: 'en' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown fields (strict mode)', () => {
    const result = metadataPatchSchema.safeParse({ unknown_field: 'x' });
    expect(result.success).toBe(false);
  });

  it('rejects empty body via refine', () => {
    const result = metadataPatchSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('No fields to update');
    }
  });

  it('accepts authors with only name (no nationality / OL key)', () => {
    const result = metadataPatchSchema.safeParse({ authors: [{ name: 'Asimov' }] });
    expect(result.success).toBe(true);
  });

  it('rejects author with bad nationality format', () => {
    const result = metadataPatchSchema.safeParse({
      authors: [{ name: 'Asimov', nationality: 'usa' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects author with empty name', () => {
    const result = metadataPatchSchema.safeParse({ authors: [{ name: '' }] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(JSON.stringify(result.error.issues)).toContain('Author name is required');
    }
  });

  it('rejects empty authors array (min 1)', () => {
    const result = metadataPatchSchema.safeParse({ authors: [] });
    expect(result.success).toBe(false);
  });

  it('rejects authors array longer than 50', () => {
    const result = metadataPatchSchema.safeParse({
      authors: new Array(51).fill({ name: 'x' }),
    });
    expect(result.success).toBe(false);
  });

  it('accepts genres as array of strings', () => {
    const result = metadataPatchSchema.safeParse({ genres: ['Science Fiction'] });
    expect(result.success).toBe(true);
  });

  it('accepts publication_year=null (explicit clear)', () => {
    const result = metadataPatchSchema.safeParse({ publication_year: null });
    expect(result.success).toBe(true);
  });
});
