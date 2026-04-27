# Phase 5: Manual Edit + Unmatched Inbox - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md; this log preserves alternatives considered.

**Date:** 2026-04-24
**Phase:** 05-manual-edit-unmatched-inbox
**Areas discussed:** Edit form surface + author UX, Unmatched inbox placement, Re-enrich feedback UX, Provenance badge + status counters

---

## Edit form surface + author UX

### Q: Where should the metadata edit form live?

| Option | Description | Selected |
|--------|-------------|----------|
| Modal over book page | Matches existing Modal + useDisclosure pattern; no new route | ✓ |
| New 'Edit' tab | URL-addressable; diverges from Manage tab | |
| Dedicated /books/:id/edit route | Full page, deep-linkable, most work | |

**User's choice:** Modal over book page (Recommended)

### Q: How should authors be edited given EDIT-01 needs per-author OL key + nationality overrides?

| Option | Description | Selected |
|--------|-------------|----------|
| Row-per-author editor | Name + nationality + OL key per row with add/remove/reorder | ✓ |
| TagsInput + expandable nationality panel | Quick tag entry, accordion for details | |
| TagsInput only, nationality edited elsewhere | Split across two UIs | |

**User's choice:** Row-per-author editor (Recommended)

### Q: Cancel behavior with unsaved changes?

| Option | Description | Selected |
|--------|-------------|----------|
| Close silently | Discard state, no prompt | ✓ |
| Confirm if dirty | Prompt before discard | |

**User's choice:** Close silently (Recommended)

### Q: OL key editability?

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only + unlink button | Display only, clear to null for re-resolution | ✓ |
| Editable TextInput with regex validation | Power-user manual entry | |

**User's choice:** Read-only (Recommended)

---

## Unmatched inbox placement

### Q: Where does the unmatched-books inbox live?

| Option | Description | Selected |
|--------|-------------|----------|
| Top-level nav 'Unmatched' with badge | New RoutePath entry, Indicator badge | |
| Sub-route /books/unmatched | Reuse Books shell, filter tab | |
| Dedicated /settings or /admin section | Group with future admin views | ✓ |

**User's choice:** Dedicated /settings section
**Notes:** User expanded the idea: Settings should be a new page with multiple sections (user/password + unmatched). Layout can be tabs, subsections, or blocks. User/password flagged as scope creep.

### Q: Zero-count badge behavior?

| Option | Description | Selected |
|--------|-------------|----------|
| Hide badge at 0 | Attention signal only when work exists | ✓ |
| Show '0' badge | Always visible | |
| Hide nav item entirely at 0 | Minimal | |

**User's choice:** Hide badge (Recommended)

### Q: Settings shell scope for Phase 5?

| Option | Description | Selected |
|--------|-------------|----------|
| Shell + Unmatched only, user/password deferred | Keep phase shippable | ✓ |
| Include user/password stub | Placeholder UI | |
| Do user/password NOW as extra scope | Large expansion | |

**User's choice:** Shell + Unmatched only (Recommended). User/password captured as deferred idea.

### Q: Settings layout?

| Option | Description | Selected |
|--------|-------------|----------|
| Vertical side-nav + content pane | Scales cleanly | ✓ |
| Stacked blocks on one page | Simplest for few sections | |
| Horizontal tabs | Clean for 3-5 sections | |

**User's choice:** Vertical side-nav (Recommended)

### Q: Badge location?

| Option | Description | Selected |
|--------|-------------|----------|
| On Settings nav item | Count next to click target | ✓ |
| Per-book marker on Books page | Item-level marker | |
| Both nav badge + per-book marker | Max visibility | |

**User's choice:** On Settings nav item (Recommended)

---

## Re-enrich feedback UX

### Q: User experience on Re-enrich click?

| Option | Description | Selected |
|--------|-------------|----------|
| Toast + SWR poll while running | 202 + poll until terminal | ✓ |
| Blocking spinner until done | Long-poll server | |
| Optimistic + background revalidate | Instant UI update | |

**User's choice:** Toast + SWR poll (Recommended)

### Q: Polling interval and stop condition?

| Option | Description | Selected |
|--------|-------------|----------|
| 2s, stop when status ≠ pending/running | Balanced | ✓ |
| 1s, stop on terminal | Snappier, more load | |
| 5s, stop on terminal | Gentler, laggier | |
| Claude picks during planning | Defer to planner | |

**User's choice:** 2s interval (Recommended)

### Q: Double-fire while job is open?

| Option | Description | Selected |
|--------|-------------|----------|
| Disable button, server idempotent | UI + server defense in depth | ✓ |
| Allow click, 409 on open job | Explicit conflict surfaced | |
| Allow click, server no-ops idempotently | Simplest UX | |

**User's choice:** Disable button (Recommended)

### Q: Inbox-row Re-enrich polling?

| Option | Description | Selected |
|--------|-------------|----------|
| Fire-and-forget + list-level SWR refresh | One poll for whole list | ✓ |
| Per-row polling | Rich feedback, N SWR loops | |
| Manual refresh button only | Lazy | |

**User's choice:** Fire-and-forget + list refresh (Recommended)

---

## Provenance badge + status counters

### Q: Field-level provenance render?

| Option | Description | Selected |
|--------|-------------|----------|
| Mantine Badge next to label | Text chip, yellow/blue | ✓ |
| Icon + tooltip | Dense, less scannable | |
| Color highlight on input border | Visual-only | |

**User's choice:** Badge next to label (Recommended)

### Q: Status counters surface?

| Option | Description | Selected |
|--------|-------------|----------|
| Unmatched section in Settings only | Scoped to recovery surface | ✓ |
| Settings + strip on Books page | More visibility | |
| Persistent global bar | Max visibility, intrusive | |

**User's choice:** Unmatched section only (Recommended)

### Q: NULL/unset provenance rendering?

| Option | Description | Selected |
|--------|-------------|----------|
| No badge shown | Cleanest | ✓ |
| 'unset' / 'not enriched' badge | Explicit, noisier | |

**User's choice:** No badge (Recommended)

---

## Claude's Discretion

- Section routing inside /settings (nested route vs query param)
- Exact inbox SWR refreshInterval (default 5000 ms suggestion)
- Orphan author garbage collection policy
- Drag-reorder vs up/down buttons for author rows
- Toast copy and error-message wording
- Spinner on inbox rows with enrichment_status = 'running' during poll

## Deferred Ideas

- User and password management in Settings (new capability, future phase)
- Import debug / backfill status admin views
- Inbox filters beyond `failed` (pending/running/enriched filtering)
- Per-row spinner during poll cycles
