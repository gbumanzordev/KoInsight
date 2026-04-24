// Per D-03 (locked): historical entities (USSR Q15180, GDR Q16957, Czechoslovakia Q33946, Yugoslavia Q36704)
// are deliberately omitted -> countryQidToAlpha2 returns null -> Phase 6 'Unknown' bucket.
// Per D-05 (locked): hand-curated ~30 high-frequency entries; no i18n-iso-countries dep
// (the lib does not provide the QID->alpha-2 direction we need anyway).
// Plan 04 (WikidataClient) populates the runtime cache for any QID not pre-seeded here by
// fetching the country entity's P297 claim.
export const COUNTRY_QID_TO_ALPHA2 = {
  Q30: 'US', // United States
  Q145: 'GB', // United Kingdom
  Q142: 'FR', // France
  Q183: 'DE', // Germany
  Q17: 'JP', // Japan
  Q148: 'CN', // China (PRC)
  Q865: 'TW', // Taiwan
  Q408: 'AU', // Australia
  Q16: 'CA', // Canada
  Q159: 'RU', // Russia
  Q38: 'IT', // Italy
  Q29: 'ES', // Spain
  Q155: 'BR', // Brazil
  Q96: 'MX', // Mexico
  Q668: 'IN', // India
  Q884: 'KR', // South Korea
  Q20: 'NO', // Norway
  Q34: 'SE', // Sweden
  Q35: 'DK', // Denmark
  Q33: 'FI', // Finland
  Q27: 'IE', // Ireland
  Q55: 'NL', // Netherlands
  Q31: 'BE', // Belgium
  Q213: 'CZ', // Czech Republic (modern)
  Q36: 'PL', // Poland
  Q40: 'AT', // Austria
  Q39: 'CH', // Switzerland
  Q414: 'AR', // Argentina
  Q298: 'CL', // Chile
  Q419: 'PE', // Peru
  Q43: 'TR', // Turkey
  Q794: 'IR', // Iran
} as const satisfies Record<string, string>;

// Runtime cache; seeded at module load from the static map. Plan 04 can extend it via cacheCountryQidAlpha2.
const runtimeCache = new Map<string, string>(Object.entries(COUNTRY_QID_TO_ALPHA2));

export function countryQidToAlpha2(qid: string): string | null {
  return runtimeCache.get(qid) ?? null;
}

export function cacheCountryQidAlpha2(qid: string, alpha2: string): void {
  runtimeCache.set(qid, alpha2);
}
