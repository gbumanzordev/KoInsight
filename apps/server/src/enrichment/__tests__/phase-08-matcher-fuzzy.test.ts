import { describe, expect, it } from 'vitest';

// Phase 8 RED tests for D-07 (NFKD + subtitle + Last,First) and D-08 (Dice >= 0.85).
// These helpers are exported by matcher.ts in Wave 1 (Plan 02). Until then the
// imports will fail; the @ts-expect-error pragma lets the file parse so vitest
// reports failing assertions rather than a compile error.

// @ts-expect-error: normalizeTitleForFuzzy lands in Wave 1 (Plan 02)
import { normalizeTitleForFuzzy, swapLastFirst, diceCoefficient, DICE_THRESHOLD } from '../matcher';

describe('normalizeTitleForFuzzy (D-07)', () => {
  it('strips diacritics via NFKD + \\p{M} (Resolução -> resolucao)', () => {
    expect(normalizeTitleForFuzzy('Resolução')).toBe('resolucao');
  });

  it('strips subtitle on colon separator (Sapiens: A Brief History -> sapiens)', () => {
    expect(normalizeTitleForFuzzy('Sapiens: A Brief History')).toBe('sapiens');
  });

  it('strips subtitle on em-dash with surrounding spaces (Sapiens — A Brief -> sapiens)', () => {
    expect(normalizeTitleForFuzzy('Sapiens — A Brief History')).toBe('sapiens');
  });

  it('strips subtitle on spaced hyphen (Sapiens - A Brief -> sapiens)', () => {
    expect(normalizeTitleForFuzzy('Sapiens - A Brief History')).toBe('sapiens');
  });

  it('lowercases output', () => {
    expect(normalizeTitleForFuzzy('FOO BAR')).toBe('foo bar');
  });

  it('returns plain ASCII for already-normalized input', () => {
    expect(normalizeTitleForFuzzy('foo bar')).toBe('foo bar');
  });
});

describe('swapLastFirst (D-07)', () => {
  it('swaps "Tolkien, J. R. R." -> "J. R. R. Tolkien"', () => {
    expect(swapLastFirst('Tolkien, J. R. R.')).toBe('J. R. R. Tolkien');
  });

  it('returns null when no comma present', () => {
    expect(swapLastFirst('J. R. R. Tolkien')).toBeNull();
  });

  it('returns null when one side of the split is empty', () => {
    expect(swapLastFirst('Tolkien,')).toBeNull();
    expect(swapLastFirst(', Tolkien')).toBeNull();
  });
});

describe('diceCoefficient (D-08)', () => {
  it('returns 1 for identical strings', () => {
    expect(diceCoefficient('foo', 'foo')).toBe(1);
  });

  it('returns 0 when either input has < 2 bigrams (short-string fallback per Pitfall 3)', () => {
    expect(diceCoefficient('It', 'Itz')).toBe(0);
    expect(diceCoefficient('a', 'abc')).toBe(0);
  });

  it('long-overlap titles cross the 0.85 threshold', () => {
    const score = diceCoefficient('the lord of the rings', 'lord of the rings');
    expect(score).toBeGreaterThanOrEqual(0.85);
  });

  it('low-overlap titles fall below the threshold', () => {
    const score = diceCoefficient('hamlet', 'macbeth');
    expect(score).toBeLessThan(0.85);
  });
});

describe('DICE_THRESHOLD (D-08)', () => {
  it('is exactly 0.85', () => {
    expect(DICE_THRESHOLD).toBe(0.85);
  });
});
