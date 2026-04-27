# Phase 2: Canonical Genre Vocabulary - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md, this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 02-canonical-genre-vocabulary
**Areas discussed:** Canonical list source + taxonomy

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Canonical list source + taxonomy | What's in the list? BISAC/LoC-derived, hand-curated, or hybrid? Size and style. | yes |
| Mapping ruleset design | Exact vs alias vs regex; compound subjects; collisions. | no |
| Denylist policy | Fixed strings vs patterns; where it lives; how it grows. | no |
| Return shape + module layout + seed strategy | Where CANONICAL_GENRES lives; return type; seed vs migration. | no |

**User choice:** Only discussed taxonomy/source. Everything else delegated to Claude's Discretion with anchors recorded in CONTEXT.md.

---

## Canonical list source + taxonomy

### Q1: Where does the canonical list come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Hand-curated from common OL subjects (Recommended) | Frequency scan of real OL subjects, collapse marketing noise, pick ~50-100. Tailored, high signal. | yes |
| BISAC top-level headings | Industry-standard category codes; stable but verbose and publisher-shaped. | no |
| LCSH subset | Thorough but verbose and misaligned with OL tag style. | no |
| Hybrid: hand-curated backbone + LCSH/BISAC cross-reference | Curation with a standards backstop. | no |

**User's choice:** Hand-curated from common OL subjects.

### Q2: Roughly how many canonical genres?

| Option | Description | Selected |
|--------|-------------|----------|
| ~60-80 (Recommended) | Enough granularity for distinct yearly-report slices, no long tail. | yes |
| ~25-30 (coarse) | Big buckets only. Cleaner but loses texture. | no |
| ~100-120 (fine) | More sub-genres, risks sparse buckets. | no |

**User's choice:** ~60-80.

### Q3: How should genre names be cased/styled?

| Option | Description | Selected |
|--------|-------------|----------|
| Title Case (Recommended) | "Science Fiction", matches existing seed + genre table style. | yes |
| Sentence case | Closer to OL native but inconsistent. | no |
| lowercase-kebab id + display name | Robust but adds a schema column. | no |

**User's choice:** Title Case.

### Q4: Flat list or hierarchical?

| Option | Description | Selected |
|--------|-------------|----------|
| Flat list (Recommended) | No parent_id, no schema churn; peers coexist. | yes |
| Parent/child hierarchy | Better rollups but adds schema work + disambiguation. | no |

**User's choice:** Flat list.

---

## Wrap-up

| Option | Description | Selected |
|--------|-------------|----------|
| I'm ready for context | Write CONTEXT.md now. | yes |
| Explore one more gray area | Pick another of the deferred areas. | no |
| More questions on list+taxonomy | Drill deeper on the same area. | no |

**User's choice:** I'm ready for context.

---

## Claude's Discretion

The user explicitly delegated these to downstream agents with anchors in CONTEXT.md:

- Mapping ruleset design (exact+alias approach is the anchor; full alias map is Claude's).
- Denylist policy (hard Set with seed entries is the anchor; full list is Claude's).
- Module layout + seed strategy + return shape (module location and exports anchored in D-16..D-20).

## Deferred Ideas

- Genre parent/child hierarchy (revisit if Phase 6 rollups get painful).
- Non-English / multi-lingual names (deferred indefinitely).
- Auto-prune obsolete genres (not needed; INSERT OR IGNORE only grows).
- Denylist via config/admin UI (not needed while code-edit is fine).
