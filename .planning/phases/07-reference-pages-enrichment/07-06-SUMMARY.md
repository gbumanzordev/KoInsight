---
phase: 07-reference-pages-enrichment
plan: 06
subsystem: web UI + project conventions
tags: [web, ui, mantine, docs, refpages-04, d-15, d-17]
requires:
  - 07-01 (DbBook type with reference_pages: number | null)
  - 07-05 (server side returns honest NULLs in totals)
provides:
  - book-page RingProgress NULL-aware affordance ("Page count missing")
  - week-stats inline D-15 documentation comment on the guard
  - CLAUDE.md Conventions bullet codifying the reference_pages data-quality stance (D-17)
affects:
  - apps/web/src/pages/book-page/book-page.tsx
  - apps/web/src/pages/stats-page/week-stats.tsx
  - CLAUDE.md
tech-stack:
  added: []
  patterns:
    - UI honors backend NULL: no synthetic 0% / no device-pages fallback in the dashboard
    - dimmed Mantine `c="dimmed"` Text used as a missing-data affordance, consistent with the rest of the page
key-files:
  created: []
  modified:
    - apps/web/src/pages/book-page/book-page.tsx
    - apps/web/src/pages/stats-page/week-stats.tsx
    - CLAUDE.md
decisions:
  - bookPages is now `book?.reference_pages ?? null`; the device_data Math.max fallback is gone
  - Empty `sections={[]}` on RingProgress avoids NaN division and renders a clean unfilled ring
  - week-stats keeps the existing truthy `?.reference_pages` guard; only a comment was added (no behavior change)
metrics:
  tasks_completed: 1
  files_created: 0
  files_modified: 3
  duration: ~5 minutes
  completed_date: 2026-04-27
---

# Phase 7 Plan 6: NULL-aware book-page UI + D-17 doc note Summary

One-liner: book-page RingProgress now shows a dimmed "Page count missing" label instead of synthesizing a 0% completion ring, week-stats self-documents its D-15 fall-through, and CLAUDE.md captures the reference_pages convention.

## Outcome

Closes the visibility loop on REFPAGES-04 / D-15. With plan 05 the server returns honest NULLs in completion-based totals; with plan 06 the dashboard surfaces those NULLs as an explicit affordance instead of confusing 0% rings. D-17 is now documented in the project's CLAUDE.md so future contributors see the policy at the same place they read formatting and Zod conventions.

## Final shape (book-page.tsx StatsCard)

`bookPages` declaration:

```tsx
const bookPages = book?.reference_pages ?? null;
```

RingProgress label + sections (only the conditional block; surrounding props unchanged):

```tsx
label={
  bookPages === null ? (
    <Text size="xs" c="dimmed" ta="center">
      Page count
      <br />
      missing
    </Text>
  ) : (
    <Stack gap={0} align="center">
      <Text size="xl" fw={700} ta="center">
        {Math.round((book.unique_read_pages / bookPages) * 100)}%
      </Text>
      <Text size="xs" c="dimmed" ta="center" fw="bold">
        {book.unique_read_pages} / {bookPages} <br /> pages read
      </Text>
    </Stack>
  )
}
sections={
  bookPages === null
    ? []
    : [
        {
          value: (book.unique_read_pages / bookPages) * 100,
          color: 'koinsight',
        },
      ]
}
```

No new Mantine imports were required. `Text` and `Stack` were already imported from `@mantine/core` at the top of the file.

## week-stats.tsx comment

Inserted directly above the existing truthy guard (line 64):

```ts
// D-15: books with NULL reference_pages fall through to `acc + 1` (raw page-turn count).
// This under-counts unenriched books in the weekly estimate; accepted data-quality stance.
```

No structural change. The second similar reduce inside `avgPagesPerDay` uses the same guard but was left without a duplicate comment, since the pattern is identical and the single comment establishes the rationale for the file.

## CLAUDE.md bullet

Appended to the Conventions section:

```markdown
- Reading metrics are derived from `book.reference_pages`; books with NULL are excluded from completion-based predicates and surfaced as Unknown in coverage. Trigger enrichment or use the per-book manual edit to populate.
```

Plain ASCII, no em dashes, consistent with global rule and project rule.

## Verification

- `npm --workspace=web run build` exits 0 (vite production build, 6.4s, no type errors).
- `npx prettier --check` on the three modified files exits 0 (write was a no-op).
- `grep` acceptance checks all return the expected matches:
  - `book?.reference_pages ?? null` present in book-page.tsx (1 match)
  - `device_data.reduce` removed from book-page.tsx (no matches in bookPages context)
  - `Page count` present in book-page.tsx
  - `D-15` present in week-stats.tsx
  - `reference_pages` bullet present in CLAUDE.md

### Browser smoke test

Started `npm --workspace=web run dev`, confirmed Vite booted on http://localhost:3000/ and HTTP 200 for the index, then stopped the server. I did NOT drive a real browser session against a book whose `reference_pages` is NULL, so the rendered "Page count missing" affordance is verified by code-review of the conditional and a clean type-check, not by a visual diff. Recommend a manual visual smoke before tagging the milestone (load any unenriched book on a populated dev DB), but the type-check is the formal gate per the plan.

## Deviations from Plan

None. Plan executed exactly as written.

## Self-Check: PASSED

- FOUND: apps/web/src/pages/book-page/book-page.tsx (modified)
- FOUND: apps/web/src/pages/stats-page/week-stats.tsx (modified)
- FOUND: CLAUDE.md (modified)
- FOUND: commit 91801e7 in git log

## Threat Flags

None. The plan's `<threat_model>` (T-07-19/20/21) is fully addressed by the conditional rendering: NaN is impossible because the `bookPages === null` branch short-circuits before any division, the rendered text is a React node (auto-escaped, no innerHTML), and the missing-data affordance is explicit instead of fabricated.

## Next Step

Phase 7 is feature-complete (plans 01 through 06 shipped). Recommended next action: `/gsd-verify-work 7`, then advance to Phase 8 (RETRY + POLISH-01 cluster) per the v1.1 roadmap.
