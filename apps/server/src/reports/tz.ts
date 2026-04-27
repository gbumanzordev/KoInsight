// apps/server/src/reports/tz.ts
//
// Pure timezone helper: compute the [start, end) epoch-second pair for
// "year Y in IANA zone TZ".
//
// IMPORTANT (Pitfall 1): page_stat.start_time in this codebase is stored
// in epoch SECONDS, not milliseconds. This helper therefore returns
// SECONDS so callers can compare directly against start_time.
//
// Works for any IANA zone available in the Node ICU build (Node >=22 ships
// full ICU by default). Handles DST boundaries because Intl applies the
// correct offset per UTC instant.
//
// Dependency-free: no `db` import, no `config` import. Caller (the report
// service) supplies the timezone string.

export function yearBoundsInZone(
  year: number,
  timeZone: string
): { startSec: number; endSec: number } {
  return {
    startSec: localMidnightToEpochSec(year, 0, 1, timeZone),
    endSec: localMidnightToEpochSec(year + 1, 0, 1, timeZone),
  };
}

function localMidnightToEpochSec(
  year: number,
  monthIndex: number,
  day: number,
  timeZone: string
): number {
  // Initial guess: pretend the local time IS UTC.
  let utcMs = Date.UTC(year, monthIndex, day, 0, 0, 0, 0);
  // Correct twice (handles DST near boundaries).
  for (let i = 0; i < 2; i++) {
    const offsetMin = getZoneOffsetMinutes(utcMs, timeZone);
    utcMs = Date.UTC(year, monthIndex, day, 0, -offsetMin, 0, 0);
  }
  return Math.floor(utcMs / 1000);
}

function getZoneOffsetMinutes(utcMs: number, timeZone: string): number {
  // Use the longOffset format ("GMT-08:00") to read the zone's offset for
  // this instant. Throws RangeError for invalid IANA zones (caller handles).
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const tzPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  // tzPart looks like "GMT-08:00", "GMT+09:00", or bare "GMT" for UTC.
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(tzPart);
  if (!match) return 0;
  const sign = match[1] === '+' ? 1 : -1;
  const hours = Number(match[2]);
  const mins = Number(match[3]);
  return sign * (hours * 60 + mins);
}
