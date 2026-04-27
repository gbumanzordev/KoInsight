import { describe, expect, it } from 'vitest';
import entityDeprecated from '../fixtures/entity-deprecated-rank.json';
import entityEndTime from '../fixtures/entity-end-time.json';
import entityNoValue from '../fixtures/entity-novalue.json';
import entityPreferred from '../fixtures/entity-preferred.json';
import type { P27Claim } from '../wikidata-schemas';

function extractClaims(entityFixture: {
  entities: Record<string, { claims?: { P27?: unknown[] } }>;
}): P27Claim[] {
  const first = Object.values(entityFixture.entities)[0];
  return (first.claims?.P27 ?? []) as P27Claim[];
}

describe('resolveP27Claim', () => {
  it('returns null for empty claims array', async () => {
    const { resolveP27Claim } = await import('../p27-resolver');
    expect(resolveP27Claim([])).toBeNull();
  });

  it('returns country QID for a single normal claim with datavalue', async () => {
    const { resolveP27Claim } = await import('../p27-resolver');
    const claims: P27Claim[] = [
      {
        mainsnak: {
          snaktype: 'value',
          property: 'P27',
          datavalue: { value: { id: 'Q30' }, type: 'wikibase-entityid' },
        },
        rank: 'normal',
      },
    ];
    expect(resolveP27Claim(claims)).toBe('Q30');
  });

  it('drops deprecated-rank claims and returns null if no candidates remain', async () => {
    const { resolveP27Claim } = await import('../p27-resolver');
    const claims = extractClaims(entityDeprecated);
    expect(resolveP27Claim(claims)).toBeNull();
  });

  it('drops claims with qualifiers.P582 (end-time) and picks the non-expired sibling', async () => {
    const { resolveP27Claim } = await import('../p27-resolver');
    const claims = extractClaims(entityEndTime);
    expect(resolveP27Claim(claims)).toBe('Q145');
  });

  it('prefers preferred rank over normal when both present', async () => {
    const { resolveP27Claim } = await import('../p27-resolver');
    const claims = extractClaims(entityPreferred);
    expect(resolveP27Claim(claims)).toBe('Q183');
  });

  it('returns null when only all-expired claims remain', async () => {
    const { resolveP27Claim } = await import('../p27-resolver');
    const claims: P27Claim[] = [
      {
        mainsnak: {
          snaktype: 'value',
          property: 'P27',
          datavalue: { value: { id: 'Q142' }, type: 'wikibase-entityid' },
        },
        rank: 'normal',
        qualifiers: { P582: [{}] },
      },
    ];
    expect(resolveP27Claim(claims)).toBeNull();
  });

  it('ignores claims with snaktype novalue (no datavalue)', async () => {
    const { resolveP27Claim } = await import('../p27-resolver');
    const claims = extractClaims(entityNoValue);
    expect(resolveP27Claim(claims)).toBeNull();
  });
});
