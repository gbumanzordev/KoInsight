# Phase 1: Schema Foundations + Provenance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 01-schema-foundations-provenance
**Areas discussed:** Migration granularity, Author backfill parser, Author dedup key, Defaults + types layout

---

## Migration granularity

### Q1: How should the Phase 1 schema changes be split across Knex migration files?

| Option | Description | Selected |
|--------|-------------|----------|
| One migration per concern | Separate files for author+junction, enrichment_job, book columns, and a data-only backfill. Matches existing per-table style. | ✓ |
| One migration per table | One file per table; book column additions combined with backfill. | |
| Single combined migration | Everything in one file. Atomic up/down; diverges from repo style. | |

**User's choice:** One migration per concern (Recommended)

### Q2: Should the deterministic author string-split backfill live in its own migration or ride along with schema DDL?

| Option | Description | Selected |
|--------|-------------|----------|
| Separate data-only migration | Keeps DDL migrations free of row iteration; SCHEMA-07 grep test stays unambiguous. | ✓ |
| Inside the author/book_author migration | Co-located with the tables it populates. Mixes DDL + row iteration. | |

**User's choice:** Separate data-only migration (Recommended)

**Notes:** 4 migrations total: (1) author + book_author, (2) enrichment_job + partial index, (3) book column additions, (4) author backfill (data-only).

---

## Author backfill parser

### Q1: How should the parser handle 'Last, First' vs list separators?

| Option | Description | Selected |
|--------|-------------|----------|
| Treat commas as list separators only | Never reorder. Simple, deterministic. | |
| Heuristic LN-FN detection | Flip `Last, First` to `First Last` under specific conditions. | ✓ |
| Split on `&` and `;` only | Safest against LN-FN false positives, but misses `A, B` multi-author form. | |

**User's choice:** Heuristic LN-FN detection

### Q2: Initials, periods, and 'and' inside names?

| Option | Description | Selected |
|--------|-------------|----------|
| Standard split + whitespace normalize | Split on `/\s*(?:&|;|,|\band\b)\s*/i`; trim; collapse whitespace. | ✓ |
| Conservative: only &/; | Skip comma and 'and'. | |

**User's choice:** Standard split + whitespace normalize (Recommended)

### Q3: Suspicious segments (empty, single char, all punctuation)?

| Option | Description | Selected |
|--------|-------------|----------|
| Drop silently, contiguous positions | Skip empties and garbage; position 0..N with no gaps. | ✓ |
| Keep whatever non-empty tokens remain | More faithful; more noise. | |
| Fall back to whole string | Safest but loses multi-author normalization. | |

**User's choice:** Drop silently, preserve position gaps closed (Recommended)

### Q4 (follow-up): LN-FN flip rule?

| Option | Description | Selected |
|--------|-------------|----------|
| Flip only when second token is initials | Narrow and safe. Ambiguous `Smith, Jones` stays as 2 authors. | |
| Flip when exactly 2 comma-separated tokens AND no other separators | Broader; catches `Strunk, William` but also `Smith, Jones`. | ✓ |
| Flip based on given-name dictionary | Highest accuracy; adds data dependency. | |

**User's choice:** Flip when exactly 2 comma-separated tokens AND no other separators

### Q5 (follow-up): Suffix handling?

| Option | Description | Selected |
|--------|-------------|----------|
| No special handling | `Strunk, Jr., William` → 3 authors. Simple, imperfect. | |
| Recognize suffix whitelist (Jr., Sr., II, III, IV, PhD, MD) | Merge suffix back into preceding segment. | ✓ |

**User's choice:** Recognize suffix whitelist

**Notes:** Suffix merge must run BEFORE the LN-FN flip so `Strunk, Jr., William` → `[Strunk Jr., William]` → `William Strunk Jr.`.

---

## Author dedup key

### Q1: Normalization for name comparison?

| Option | Description | Selected |
|--------|-------------|----------|
| Case-insensitive + whitespace collapse | `trim` + collapse `\s+` + `toLowerCase`. | ✓ |
| Also strip internal periods/punctuation | Also merges `J.K. Rowling` ↔ `J. K. Rowling`. | |
| Normalize unicode + strip diacritics | Library-grade; adds complexity. | |

**User's choice:** Case-insensitive + whitespace collapse (Recommended)

### Q2: UNIQUE index on author.name?

| Option | Description | Selected |
|--------|-------------|----------|
| UNIQUE on raw name + app-layer dedup by normalized key | Matches existing `genre` table pattern. | ✓ |
| Add normalized_name column with UNIQUE | Schema enforces dedup; extra column. | |
| No UNIQUE index | App-layer only; fragile. | |

**User's choice:** UNIQUE on raw name + app-layer dedup by normalized key (Recommended)

### Q3: OL key vs name identity?

| Option | Description | Selected |
|--------|-------------|----------|
| OL key authoritative when present | Phase 1: partial UNIQUE on `openlibrary_key WHERE NOT NULL`. Merge logic is Phase 4. | ✓ |
| Ignore OL key for identity | Name is the only identity. | |

**User's choice:** OL key is the authoritative identity when present (Recommended)

---

## Defaults + types layout

### Q1: enrichment_status default for pre-existing rows?

| Option | Description | Selected |
|--------|-------------|----------|
| 'pending' | Explicit enqueue. Simplest Phase 4 bootstrap query. | ✓ |
| NULL (treat NULL as pending) | Saves an UPDATE; adds NULL-handling. | |

**User's choice:** 'pending' (Recommended)

### Q2: *_source default for pre-existing rows?

| Option | Description | Selected |
|--------|-------------|----------|
| NULL for all *_source | NULL = never touched by provenance. Clean semantic. | ✓ |
| 'openlibrary' default | Wrong provenance claim. | |
| New 'plugin' value | Extra union member to carry. | |

**User's choice:** NULL for all *_source on pre-existing rows (Recommended)

### Q3: Shared types file layout?

| Option | Description | Selected |
|--------|-------------|----------|
| New files per domain | `author.ts`, `enrichment.ts`; extend `book.ts`. Matches convention. | ✓ |
| Fold into book.ts | Fewer files; breaks convention. | |

**User's choice:** New files per domain (Recommended)

### Q4: Book type extension?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend DbBook/Book in place | Add new nullable fields directly. | ✓ |
| Introduce EnrichedBook alias | Separation; extra ceremony downstream. | |

**User's choice:** Extend DbBook/Book in place (Recommended)

---

## Claude's Discretion

- Knex column builder calls and migration file timestamps — follow existing style.
- Index naming — Knex defaults unless conflict.
- Whether CHECK constraints or TS-only unions — prefer CHECK where SQLite supports cleanly.
- Whether the `UPDATE book SET enrichment_status = 'pending'` runs as a second statement in migration 3 or as a column default.

## Deferred Ideas

- Duplicate-author merge via OL key — Phase 4 responsibility.
- Zod schemas for new shared types — Phase 3 / Phase 5.
- LN-FN heuristic weaknesses on `Smith, Jones`-style pairs — accepted; Phase 5 manual edit is the recovery path.
- `KoReaderBook` plugin type changes — out of scope this milestone.
