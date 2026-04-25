import { describe, expect, it } from 'vitest';

import { yearBoundsInZone } from '../tz';

/**
 * Expected values are computed independently of the helper:
 * each case constructs the known UTC instant that corresponds to
 * `year-01-01T00:00:00` in the given IANA zone.
 *
 * Note: page_stat.start_time is stored in epoch SECONDS, so the helper
 * returns SECONDS (Pitfall 1 in 06-RESEARCH.md).
 */

type Case = {
  name: string;
  year: number;
  zone: string;
  // UTC ISO instants that correspond to local Jan 1 00:00 in that zone
  startUtcIso: string;
  endUtcIso: string;
};

const cases: Case[] = [
  {
    name: 'UTC 2024',
    year: 2024,
    zone: 'UTC',
    startUtcIso: '2024-01-01T00:00:00Z',
    endUtcIso: '2025-01-01T00:00:00Z',
  },
  {
    name: 'America/Los_Angeles 2024 (PST UTC-8 in January)',
    year: 2024,
    zone: 'America/Los_Angeles',
    startUtcIso: '2024-01-01T08:00:00Z',
    endUtcIso: '2025-01-01T08:00:00Z',
  },
  {
    name: 'Asia/Tokyo 2024 (JST UTC+9, no DST)',
    year: 2024,
    zone: 'Asia/Tokyo',
    startUtcIso: '2023-12-31T15:00:00Z',
    endUtcIso: '2024-12-31T15:00:00Z',
  },
  {
    name: 'America/New_York 2024 (EST UTC-5 in January, NOT EDT)',
    year: 2024,
    zone: 'America/New_York',
    startUtcIso: '2024-01-01T05:00:00Z',
    endUtcIso: '2025-01-01T05:00:00Z',
  },
];

describe('yearBoundsInZone', () => {
  for (const c of cases) {
    it(`computes [startSec, endSec) for ${c.name}`, () => {
      const expectedStart = Math.floor(Date.parse(c.startUtcIso) / 1000);
      const expectedEnd = Math.floor(Date.parse(c.endUtcIso) / 1000);

      const { startSec, endSec } = yearBoundsInZone(c.year, c.zone);

      expect(startSec).toBe(expectedStart);
      expect(endSec).toBe(expectedEnd);
    });
  }

  it('UTC 2024 startSec equals 1704067200 and endSec equals 1735689600', () => {
    const { startSec, endSec } = yearBoundsInZone(2024, 'UTC');
    expect(startSec).toBe(1704067200);
    expect(endSec).toBe(1735689600);
  });

  it('uses the January (EST) offset for America/New_York, not the July (EDT) offset', () => {
    // If the helper had used the July UTC-4 offset, endSec would be at
    // 2025-01-01T04:00:00Z (1735704000), not 05:00:00Z (1735707600).
    const { endSec } = yearBoundsInZone(2024, 'America/New_York');
    const wrongDstEnd = Math.floor(Date.parse('2025-01-01T04:00:00Z') / 1000);
    const correctEstEnd = Math.floor(Date.parse('2025-01-01T05:00:00Z') / 1000);
    expect(endSec).toBe(correctEstEnd);
    expect(endSec).not.toBe(wrongDstEnd);
  });

  it('throws RangeError for an invalid IANA zone', () => {
    expect(() => yearBoundsInZone(2024, 'Not/A_Zone')).toThrow(RangeError);
  });

  it('boundary semantics: start-1 is previous year, start and end-1 are this year, end is next year', () => {
    const { startSec, endSec } = yearBoundsInZone(2024, 'UTC');

    // Encode the half-open [startSec, endSec) contract as a small assertion table
    const table: Array<{ ts: number; expected: 'previous' | 'this' | 'next' }> = [
      { ts: startSec - 1, expected: 'previous' },
      { ts: startSec, expected: 'this' },
      { ts: endSec - 1, expected: 'this' },
      { ts: endSec, expected: 'next' },
    ];

    for (const row of table) {
      const isThisYear = row.ts >= startSec && row.ts < endSec;
      const isPrevYear = row.ts < startSec;
      const isNextYear = row.ts >= endSec;

      if (row.expected === 'this') {
        expect(isThisYear).toBe(true);
      } else if (row.expected === 'previous') {
        expect(isPrevYear).toBe(true);
      } else {
        expect(isNextYear).toBe(true);
      }
    }
  });
});
