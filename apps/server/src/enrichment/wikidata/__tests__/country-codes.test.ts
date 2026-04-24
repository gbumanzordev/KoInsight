import { describe, expect, it } from 'vitest';

describe('country-codes', () => {
  describe('countryQidToAlpha2', () => {
    it('returns US for Q30', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q30')).toBe('US');
    });
    it('returns GB for Q145', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q145')).toBe('GB');
    });
    it('returns FR for Q142', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q142')).toBe('FR');
    });
    it('returns DE for Q183', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q183')).toBe('DE');
    });
    it('returns JP for Q17', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q17')).toBe('JP');
    });
    it('returns null for USSR (Q15180), historical entity per D-03', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q15180')).toBeNull();
    });
    it('returns null for GDR (Q16957)', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q16957')).toBeNull();
    });
    it('returns null for Czechoslovakia (Q33946)', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q33946')).toBeNull();
    });
    it('returns null for Yugoslavia (Q36704)', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q36704')).toBeNull();
    });
    it('returns null for unknown QID without network', async () => {
      const { countryQidToAlpha2 } = await import('../country-codes');
      expect(countryQidToAlpha2('Q99999999')).toBeNull();
    });
  });

  describe('COUNTRY_QID_TO_ALPHA2', () => {
    it('has at least 30 hand-curated entries', async () => {
      const { COUNTRY_QID_TO_ALPHA2 } = await import('../country-codes');
      expect(Object.keys(COUNTRY_QID_TO_ALPHA2).length).toBeGreaterThanOrEqual(30);
    });
    it('contains only 2-character values (ISO alpha-2)', async () => {
      const { COUNTRY_QID_TO_ALPHA2 } = await import('../country-codes');
      for (const v of Object.values(COUNTRY_QID_TO_ALPHA2)) {
        expect(v).toHaveLength(2);
      }
    });
    it('contains only uppercase ASCII values', async () => {
      const { COUNTRY_QID_TO_ALPHA2 } = await import('../country-codes');
      for (const v of Object.values(COUNTRY_QID_TO_ALPHA2)) {
        expect(v).toBe(v.toUpperCase());
        expect(v).toMatch(/^[A-Z]{2}$/);
      }
    });
  });

  describe('cacheCountryQidAlpha2', () => {
    it('write-through: cached value is returned on subsequent lookup', async () => {
      const { cacheCountryQidAlpha2, countryQidToAlpha2 } = await import('../country-codes');
      cacheCountryQidAlpha2('Q99999999', 'ZZ');
      expect(countryQidToAlpha2('Q99999999')).toBe('ZZ');
    });
    it('does not mutate the static COUNTRY_QID_TO_ALPHA2 object', async () => {
      const { cacheCountryQidAlpha2, COUNTRY_QID_TO_ALPHA2 } = await import('../country-codes');
      const before = Object.keys(COUNTRY_QID_TO_ALPHA2).length;
      cacheCountryQidAlpha2('Q99999998', 'YY');
      const after = Object.keys(COUNTRY_QID_TO_ALPHA2).length;
      expect(after).toBe(before);
    });
  });
});
