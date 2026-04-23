export type ParsedAuthor = {
  name: string;
  position: number;
};

const SUFFIX_WHITELIST = ['jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md'];
const SEPARATOR_RE = /\s*(?:&|;|,|\band\b)\s*/i;
const COMMA_ONLY_RE = /^[^&;]*$/;
const HAS_AND_RE = /\band\b/i;
const PUNCT_OR_SINGLE_NONLETTER_RE = /^[^A-Za-z]*$/;

function isSuffix(segment: string): boolean {
  const stripped = segment.trim().replace(/\.$/, '').toLowerCase();
  return SUFFIX_WHITELIST.includes(stripped);
}

export function parseAuthors(input: string | null | undefined): ParsedAuthor[] {
  if (input == null) return [];
  const original = input;
  const segments = original
    .split(SEPARATOR_RE)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 0);

  // D-05: suffix merge (runs before flip)
  const merged: string[] = [];
  for (const seg of segments) {
    if (merged.length > 0 && isSuffix(seg)) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${seg}`;
    } else {
      merged.push(seg);
    }
  }

  // D-04: LN-FN flip when ORIGINAL had only commas as separators AND we end up with exactly 2 segments
  const onlyCommas = COMMA_ONLY_RE.test(original) && !HAS_AND_RE.test(original);
  let finalNames = merged;
  if (onlyCommas && merged.length === 2) {
    finalNames = [`${merged[1]} ${merged[0]}`];
  }

  // D-06: drop suspicious segments (no letters)
  const cleaned = finalNames.filter((s) => !PUNCT_OR_SINGLE_NONLETTER_RE.test(s));

  return cleaned.map((name, position) => ({ name, position }));
}
