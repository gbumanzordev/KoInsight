import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Per OL-02: identified UA unlocks OpenLibrary's 3 req/s tier.
// Per D-01 (locked): homepage is https://github.com/gbumanzordev/koinsight; version read from
// apps/server/package.json at module load, leading 'v' stripped.
function buildUserAgent(): string {
  const pkgPath = join(__dirname, '..', '..', '..', 'package.json');
  const raw = readFileSync(pkgPath, 'utf8');
  const { version } = JSON.parse(raw) as { version: string };
  const cleanVersion = version.replace(/^v/, '');
  return `KoInsight/${cleanVersion} (+https://github.com/gbumanzordev/koinsight)`;
}

export const USER_AGENT = buildUserAgent();
