# Feature Research

**Domain:** Book metadata enrichment + yearly reading reports (KOReader stats dashboard)
**Researched:** 2026-04-23
**Confidence:** MEDIUM-HIGH (competitor behavior verified via product docs/roadmaps/user forums; nationality-sourcing claims are MEDIUM because Wikidata/OpenLibrary integration details change)

## Scope Reminder

Base reading-tracker features (per-session stats, annotations, dashboard) already exist. This research covers **only** two new capability areas for the next milestone:

1. Metadata enrichment (OpenLibrary-sourced) with manual-edit fallback
2. Yearly reports surfaced as a dashboard section (genre, author nationality, publication year, etc.)

Competitor reference set: Goodreads, StoryGraph, Hardcover, Literal, Bookly, BookTrack, Libib, Calibre (metadata flow reference).

---

## Feature Landscape

### Table Stakes — Metadata Enrichment

These are what users assume "just works" when a book lands in the library. Missing any of them makes the reports section feel broken.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Automatic match on import | Calibre, Goodreads, StoryGraph all auto-populate from ISBN/title+author with no user action. A dashboard that requires per-book manual entry is a non-starter for libraries of 100+ books. | MEDIUM | KOReader sidecars usually carry title+author; ISBN is often absent. Match pipeline: ISBN -> title+author -> fuzzy. |
| ISBN-first lookup when available | Calibre docs: "If you fill in the ISBN field first, it will be used in preference to the title and author." This is the canonical pattern. | LOW | OpenLibrary supports `?isbn=` direct lookup. |
| Fallback to title + author fuzzy match | Most KOReader sidecars lack ISBN. Users expect the system to still find the book. | MEDIUM | OpenLibrary search API returns ranked `work` results; pick top with author-name agreement. |
| Canonical work vs edition disambiguation | Users expect "The Hobbit" to be one book in their stats, not 14 editions. Goodreads/StoryGraph edition grouping confusion is the single most-complained-about metadata issue in librarian forums. | HIGH | OpenLibrary `work` is the stable identifier; `edition` carries ISBN/language. Always resolve edition -> work for aggregation, but keep edition for language/pub-year fidelity. |
| Author as first-class entity | Required to attach nationality and to answer "how many Japanese authors did I read". Every competitor that surfaces author stats (StoryGraph author stats, Hardcover) has an author entity under the hood. | MEDIUM | OpenLibrary `/authors/OL...A` keys. |
| Multi-author support | Co-authored books and translations are normal. Storing author as a single string (KoInsight today) breaks co-author books immediately. | MEDIUM | Junction table (already in PROJECT.md active requirements). |
| Publication year (original, not edition) | Required for "publication-year distribution" chart. OpenLibrary `work.first_publish_date` is the canonical field; edition `publish_date` is wrong for reprints. | LOW | Trivial field but semantically easy to get wrong. |
| Language of original work | Required so "I read N translated books" is answerable. Edition `languages` is often the *translation* language, not the original. | MEDIUM | Pull `original_languages` from work; fall back to edition only if missing. |
| Visible match confidence / "unmatched" flag | Users must be able to find books that failed to match. StoryGraph exposes "Report missing/incorrect book information"; Calibre shows blank metadata fields. | LOW | A `metadata_status` enum on `book` is enough (unmatched / auto / manual / stale). |
| Cover image | Already shipped in KoInsight. Listed here because users count a book as "unmatched" if the cover is missing, even if other metadata is fine. | — | Existing. |

### Table Stakes — Yearly Reports

Derived from what Goodreads "Year in Books" and StoryGraph year-wrap / Stats V5 actually display. If the yearly section is missing any of these, a user coming from those products will feel it's undercooked.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Year selector (any year with data) | StoryGraph lets users view any year; Goodreads "Year in Books" exists per year. Dashboard must not be "current year only". | LOW | Already in PROJECT.md. |
| Total books + total pages read | The universal headline stat. Goodreads shows "books read" + "pages read" at the top of Year in Books. | LOW | Already computable from existing `page_stat`. |
| Average book length + longest/shortest book | Goodreads shows average length, longest book, shortest book explicitly on Year in Books. | LOW | Aggregate over finished-books-this-year. |
| Genre breakdown (pie or bar) | StoryGraph's genre pie chart is its flagship visual. Arguably the single chart users most want from enrichment. | MEDIUM | Depends on enriched genre data; relies on curated whitelist from PROJECT.md. |
| Fiction vs nonfiction split | StoryGraph surfaces this as a distinct top-level stat alongside genre. | LOW | Derivable from genre whitelist tags. |
| Pages-per-month / books-per-month timeline | StoryGraph has a monthly bar chart; Goodreads has a reading timeline. Table stakes for "how did my year pace". | LOW | Existing `page_stat` already supports this. |
| Publication-year distribution | Already in PROJECT.md. Pattern: histogram with buckets (pre-1950, decades). Shows "do I read contemporary or backlist". | LOW | Requires enriched `publication_year`. |
| Author nationality breakdown | Already in PROJECT.md. This is the product's core differentiator for the milestone; making it robust is table stakes for *this* product even though competitors rarely ship it. | HIGH | Requires nationality sourcing pipeline; see section below. |
| Average rating / rating distribution | Goodreads and StoryGraph both chart rating distribution. Gated by whether KoInsight even captures ratings (check schema). | LOW-MED | Skip if no rating capture; otherwise trivial chart. |

### Differentiators — In Scope or Near-Scope

Features that would set KoInsight apart. Some may be reachable this milestone with low marginal cost; most are candidates for Out-of-Scope.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| "Read around the world" map view | Nationality stats visualized on a world map. Genuinely compelling because no mainstream tracker does this well; Read-Around-The-World-Challenge uses external spreadsheets. Directly leverages data this milestone is already building. | MEDIUM | Possible add-on chart; Mantine + a GeoJSON layer. Consider for this milestone. |
| Original-language breakdown | "You read N books translated from Japanese". Builds on data already being enriched (`original_languages`). Very low marginal cost once enrichment exists. | LOW | Recommend including this milestone. |
| Translated vs original-language read | Derived from language + user's preferred language. Bookish-diversity crowd specifically asks for this. | LOW | Small feature, big signal for "diverse reading" crowd. |
| Decade-of-publication breakdown | A cleaner presentation of publication-year distribution. StoryGraph does not have this; it's a differentiator. | LOW | Small variant on pub-year histogram. |
| Unmatched-books inbox | A dedicated list of books where enrichment failed, with one-click "fix". Calibre's bulk metadata dialog is the closest analog. Reduces the data-quality death spiral that kills reports. | MEDIUM | Strong recommend in scope; required for trust in yearly reports. |
| Re-run enrichment per book / bulk | User action: "this is wrong, try again" or "re-fetch all stale metadata". Calibre has this; StoryGraph's "switch to edition" is the spiritual equivalent. | MEDIUM | Needed for the manual-edit UX to feel forgiving. |
| Nationality override (per-book or per-author) | Ishiguro / Nabokov / Conrad cases: user overrides the auto-assigned nationality. | LOW | Junction-table column or `author_nationality_override` on author. |
| Year-over-year comparison | "You read 40% more fiction in 2025 than 2024." StoryGraph has a YoY stats request on their roadmap but has not shipped it. | MEDIUM | Defer unless trivial. |

### Differentiators — Out of Scope (Name Them to Defer Cleanly)

Features competitors ship that KoInsight could build later. Listed so they can be explicitly deferred with reasoning.

| Feature | Who Ships It | Why Defer |
|---------|--------------|-----------|
| Shareable "Wrapped"-style image/slideshow | StoryGraph end-of-year wrap-up page; Goodreads Year in Books shareable card | Already in PROJECT.md Out-of-Scope. Requires image-rendering pipeline; UX polish-heavy; not needed to validate enrichment correctness. |
| Author biography / author detail page | StoryGraph, Hardcover, Goodreads all have author pages | Already in PROJECT.md Out-of-Scope. Nationality is a column, not a page. Author-centric UI is a future milestone. |
| Reading goal tracking (N books/year) | Goodreads, StoryGraph, Hardcover, Bookly | Orthogonal to enrichment; not tied to this milestone's value hypothesis. |
| Genre/author recommendations | StoryGraph, Hardcover | Requires a recommender that is a product of its own. |
| TBR (to-be-read) list | Every consumer tracker | KoInsight is a KOReader stats dashboard, not a cataloguing app. Books appear when read. |
| Social features (friends, feed) | Goodreads, StoryGraph, Hardcover, Literal | Self-hosted single-user context; out of product scope. |
| Cross-reader comparisons | Goodreads Compare Books | Requires social graph; out of scope. |
| Mood / pace tagging | StoryGraph's signature differentiator | Requires subjective per-book user input; not derivable from OpenLibrary. Huge data-entry cost. Defer indefinitely. |
| Half-star / quarter-star ratings | StoryGraph, Hardcover | KoInsight is KOReader-driven; KOReader does not capture ratings at all. Would require new input surface. |
| Custom tags / shelves | Goodreads shelves, StoryGraph custom tags | Nice to have but orthogonal to automated enrichment. |
| Book-of-the-year / top-books highlights | Goodreads Year in Books | Needs ratings first; derivative feature. |

### Anti-Features — Deliberately Do Not Build

Features competitors ship that actively hurt a self-hosted, data-integrity-focused product.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Rating aggregation / community averages | Goodreads' headline feature: "Goodreads avg rating 3.87" | Requires a social graph, rating ingestion pipeline, and spam/botting defenses. Off-mission for a self-hosted dashboard. Also the Goodreads rating corpus is widely criticized as gamed/review-bombed. | None. Personal stats don't need a community baseline. |
| Gamification (streaks, badges, points) | Bookly's core hook; StoryGraph has reading-streak requests | Turns a reflective activity into a FOMO loop; encourages users to skim books to keep streaks. Incompatible with KoInsight's "measure reality, don't distort it" ethos. Also creates edge cases around KOReader offline sync (did a streak "break" because the plugin didn't sync?). | Plain honest stats. The data itself is the reward. |
| LLM / AI enrichment fallback | Trendy; cheap-feeling | Non-deterministic; invents nationalities; confabulates publication years; costs per-book tokens. Already in PROJECT.md Out-of-Scope and should stay there. | OpenLibrary + manual edit. |
| Hidden / inferred "reading personality" labels | StoryGraph-style "you're a moody eclectic reader" | Labels are subjective, non-falsifiable, and erode user trust when wrong. High effort, low signal. | Let charts speak for themselves. |
| Paywalled stats tier | StoryGraph Plus gates custom charts | Self-hosted product; no monetization surface; anti-pattern for open-source. | All stats free. |
| Auto-posting to social networks | Goodreads/StoryGraph share-to-Twitter flows | Requires OAuth to third parties; privacy-hostile for a self-hosted product. | Export as image if Wrapped-style cards ship later. |
| Silent metadata overwrites on re-sync | Goodreads auto-imports from Amazon and overwrites user edits; widely complained about in the Goodreads Librarians forums | Destroys user manual corrections. Users stop trusting the system after one lost edit. | Manual edits are sticky: once a field is user-edited, auto-enrichment must not overwrite it. `manual_edit` flag per field or per book. |
| Edition merging on behalf of the user | StoryGraph "merge editions" request queue | Merging is destructive and hard to undo. Errors propagate across every user's library. | Resolve to `work` at ingest; never merge editions silently. |
| Fractional nationality credit for co-authors | Read-diversity bloggers ask for "0.5 Japanese, 0.5 British" | Statistically meaningless; creates non-integer charts; confusing UX. Already excluded in PROJECT.md. | Report by primary author OR count each co-author's nationality once (pick one, document it). |

---

## Edge Cases: What Users Actually Complain About

Synthesized from Goodreads Librarians Group forums (most threads are literally titled "Book linked to wrong author" or "wrong metadata"), StoryGraph roadmap requests, and Calibre community docs.

| Edge Case | Real-World Frequency | What Competitors Do | Recommendation for KoInsight |
|-----------|---------------------|---------------------|------------------------------|
| Two authors with the same name (e.g. "Michael Scott") | Very common; #1 complaint in Goodreads Librarians threads | Goodreads relies on librarians to disambiguate manually; auto-imports from Amazon frequently misattribute | Use OpenLibrary author key (`OL...A`), not author name string, as the canonical identity. When author name matches multiple keys, flag book as `match_needs_review`. |
| Translator credited as author | Frequent for translated fiction (Japanese, Scandi-noir). Goodreads forums have dedicated threads. | StoryGraph: report-incorrect-info ticket; Goodreads: librarians | OpenLibrary separates `authors` from `contributors`. Only use `authors` role; explicitly discard `contributors[role=translator]`. Store translator separately if captured, never as author. |
| Multi-author books, mixed nationalities | Reading-diversity bloggers flag this specifically | No mainstream tracker reports nationality at all; spreadsheet users pick primary | Already decided in PROJECT.md: primary-author OR per-contributor (defer exact choice). Document whichever is picked in the chart tooltip so users can interpret. |
| Edition vs work confusion (Hobbit has 14 editions, stats split across them) | The single most-requested StoryGraph fix ("Merge Editions" has its own roadmap thread) | StoryGraph: manual "switch to this edition"; Calibre: identifier-based grouping | Always resolve edition -> work at ingest. Aggregate stats by work. Keep edition for language/pub-year of the specific copy read. |
| Self-published / small-press books missing from OpenLibrary | Common complaint on r/selfpublish and Goodreads author forums | Goodreads accepts author-submitted metadata (which causes its own problems); StoryGraph lets users add editions | Expose "create manual book" path. A book with zero OpenLibrary match should still be viewable and editable, just flagged `metadata_status=manual`. |
| Non-English titles / non-Latin scripts | Translated fiction, manga, foreign-language editions | OpenLibrary handles Unicode but search ranking is Anglocentric | Use ISBN when available; otherwise try original-script title then romanization. Show both on the book page. |
| Author pseudonyms / pen names (Stephen King <-> Richard Bachman) | Well-known author issue | Goodreads/OpenLibrary have "alternate_names"; StoryGraph links pen names via edition | Store `openlibrary_author_key`; if the user reads both pen names as "one author", a merge-authors manual action is needed. Likely defer merge UI. |
| Author deceased / nationality changed over lifetime (Soviet authors, pre-partition India, Yugoslavia) | Edge case but recurring on reading-diversity blogs | No tracker handles this | Nationality is a *current-citizenship-at-death-or-today* simplification. Document this explicitly in the report tooltip. Provide override field for users who disagree. |
| Expatriates (Ishiguro, Nabokov, Conrad, Beckett) | Philosophically contested. Ishiguro considers himself British; classifiers split. | No tracker handles this | Use Wikidata `country of citizenship` (P27); if multiple, use the most-recently-asserted or the one with `end time` unset. Expose override. Accept that this will never be 100% right. |
| OpenLibrary subjects are noisy (50+ tags including marketing copy, "read-in-2019", library shelving labels) | Well-documented in OL GitHub issues | Not a tracker problem directly; but Calibre's community complains about Amazon tag noise | Already addressed in PROJECT.md: curated whitelist of ~50-100 canonical genres with a mapping ruleset. Do not display raw OL subjects in reports. |
| Reprints showing wrong "publication year" | Common; edition `publish_date` is often a 2015 reprint of a 1952 book | Goodreads shows "Original Publication Year" separately | Use `work.first_publish_date`, not `edition.publish_date`, for the publication-year chart. |

---

## Manual-Edit UX: What Must Be Editable

Inferred from Calibre's "Edit metadata" dialog (the gold standard for metadata editing) and StoryGraph's "switch to edition" + "report incorrect info" flows.

### Must Be Editable

| Field | Editable Because | Notes |
|-------|------------------|-------|
| Title | OL title is sometimes wrong or in a different language | Free text. |
| Authors (add/remove/reorder) | Wrong-author match is the #1 complaint | Author picker: search existing authors in DB or create new. Preserve order (primary-author semantics). |
| Genres | Curated whitelist is imperfect; user must be able to correct | Multi-select from the canonical genre list. No free-text to avoid re-introducing noise. |
| Publication year | Reprints vs first editions | Number input with reasonable bounds. |
| Original language | Frequent translation mis-labelling | Dropdown of ISO 639 languages. |
| Author nationality (per-author override) | Expatriate authors, Wikidata gaps | Dropdown (ISO 3166); "unknown" is valid. |
| OpenLibrary work key (re-match) | The "this book was misidentified" action. StoryGraph's "switch to edition" equivalent. | See re-match UX below. |

### Should NOT Be Editable (or: Should Be Derived)

- Aggregate stats (page counts, session counts). These come from KOReader sync; editing them breaks the audit trail.
- Author OpenLibrary key directly (user should pick an author, not type a key).

### The "Re-match" Flow

This is the critical UX pattern. Mirrors StoryGraph's `Editions -> Switch to this edition`.

1. On the book detail page, show a `Re-match from OpenLibrary` action.
2. Opens a modal with current best-guess match highlighted.
3. Shows top N OpenLibrary search results (title + author + pub year + cover).
4. User clicks one -> book's `openlibrary_work_key` is updated, metadata re-pulled.
5. **User-edited fields are preserved** (sticky-edit flag). This is the single most important detail; Goodreads' silent-overwrite behavior is the most-hated "feature" in its history.
6. If no result matches, escape hatch: `None of these -> Edit manually`.

### The "Unmatched Inbox"

A dashboard view listing all books with `metadata_status in (unmatched, match_needs_review)`. Sorted by most-recently-read first (those distort current-year reports most). Each row: one-click "Re-match" or "Edit manually".

---

## Author Nationality Sourcing

This is the technically riskiest enrichment axis. Dedicated section because PROJECT.md flags it and no mainstream tracker does it.

### Sources Ranked

| Source | Coverage | Accuracy | Accessibility |
|--------|----------|----------|---------------|
| **Wikidata `country of citizenship` (P27)** | Best available for notable authors; multilingual; structured | High when present; explicitly modelled for multiple citizenships with start/end dates | Free SPARQL + JSON API; no key; rate-limited. Link from OpenLibrary via `remote_ids.wikidata`. |
| OpenLibrary author bio (free-text) | Present for many authors | Unstructured; requires NLP to extract "British" / "Japanese-born" | Free; direct from already-integrated API. Low-signal; do not rely on. |
| VIAF / ISNI `nationalityOfEntity` | Structured; library-community-curated | High but coverage skews to academics/authors-with-LCCNs | Free API. Linked from OpenLibrary `remote_ids` for ~7% of authors (per OL stats). |
| Wikipedia infobox (scraping) | Broad | Inconsistent field names across languages | Fragile; avoid. Prefer Wikidata which is the structured mirror. |

### Recommended Pipeline

1. Resolve author -> OpenLibrary author key.
2. Fetch `remote_ids.wikidata` from OpenLibrary.
3. If present, query Wikidata for P27 (country of citizenship). Pick:
   - The claim with no `end time` qualifier (i.e., current citizenship), OR
   - If multiple current, the one with `preferred` rank, OR
   - If still multiple, the first and store the full list for display ("British; Japanese"; user picks via override).
4. If no Wikidata link or no P27, mark nationality `unknown`; do not guess from name or place-of-birth.
5. Always allow per-author manual override.

**Critical:** coverage will be spotty. OpenLibrary reports only 7% of authors have Wikidata `remote_ids` populated. Many mid-list authors will land as `unknown`. The UI must treat `unknown` as a first-class bucket in the nationality chart, not hide it.

### Ambiguity Cases — Documented Answers

| Case | Handling |
|------|----------|
| Ishiguro (JP-born, British citizen since 1982) | Wikidata P27 = United Kingdom. Report as British. Provide override for users who disagree. Tooltip: "citizenship at time of most recent publication". |
| Nabokov (Russian-born, French-resident, US citizen from 1945) | Wikidata P27 = Russia, USA (two claims). Display the one without `end time`, i.e. USA. Store list for override. |
| Conrad (Polish-born, British citizen) | Wikidata P27 = UK. Same pattern as Ishiguro. |
| Pseudonyms (Elena Ferrante, anonymous) | Wikidata usually has "unknown nationality"; report as `unknown`; do not infer. |
| Author collectives (James S.A. Corey = two people) | Treat as multiple authors per book; each contributes their own nationality. |
| Pre-modern / ancient authors (Homer, Confucius) | Wikidata has "country of origin" (P495) for works; skip for authors or map to historical polity. Report as `unknown` or `historical`. |

---

## Feature Dependencies

```
Canonical work-vs-edition resolution
    └──requires──> OpenLibrary work/edition lookup in enrichment service
                          └──requires──> OpenLibrary integration expansion
                                                (already scaffolded for covers)

Author entity + book_author junction
    └──requires──> Data migration from current book.authors string
    └──enables──> Author nationality
                     └──requires──> Wikidata link via OL remote_ids
                                      └──enables──> Nationality breakdown chart
                                      └──enables──> Per-author nationality override

Curated genre whitelist + mapping rules
    └──requires──> Analysis of OpenLibrary subjects corpus (already done by OL devs; see issue #11610)
    └──enables──> Genre breakdown chart
    └──enables──> Fiction-vs-nonfiction split (derived from whitelist tags)

Manual edit UI
    └──requires──> metadata_status enum + sticky-edit flag per field
    └──enables──> Unmatched-books inbox
    └──enables──> Re-match flow (trust: users only re-match if edits are preserved)

Yearly report section
    └──requires──> ALL of the above (enrichment data quality gates every chart)
    └──enables──> Year selector
    └──enables──> All per-year breakdowns

Backfill job
    └──requires──> Enrichment pipeline stable for new books
    └──blocks-on──> Rate-limit handling for OpenLibrary
```

### Dependency Notes

- **Reports depend on enrichment quality, not the other way around.** Ship enrichment + manual-edit UI before any chart that depends on enriched fields. A genre pie chart on 40% unmatched data is worse than no chart.
- **Manual-edit UI gates trust in the whole report section.** Users who cannot fix wrong matches stop trusting aggregate numbers. This feature is NOT a polish item; it is load-bearing.
- **Nationality is an enrichment long-tail.** Do not block the milestone on 100% nationality coverage. `unknown` must be a valid bucket.
- **Sticky-edit flag conflicts with the backfill job.** Backfill must skip books where the user has manually edited any field, or it will overwrite user corrections (the Goodreads anti-pattern).

---

## MVP Definition (for this milestone)

### Launch With (milestone v1)

- [ ] OpenLibrary work/edition/author lookup in enrichment service — load-bearing for everything else
- [ ] `author` entity + `book_author` junction + data migration — prerequisite for nationality
- [ ] Curated genre whitelist + OL subject mapping — prerequisite for genre chart
- [ ] Auto-enrich on sync (ISBN -> title+author fallback, work-level resolution)
- [ ] One-time deploy backfill that respects manual-edit flag
- [ ] `metadata_status` enum and unmatched-books inbox view
- [ ] Manual edit UI with sticky-per-field-edit preservation
- [ ] Re-match flow (pick from top-N OpenLibrary results)
- [ ] Nationality sourcing via OpenLibrary -> Wikidata P27, with `unknown` as valid bucket and per-author override
- [ ] Yearly report section with year selector, and charts: genre breakdown, author nationality breakdown, publication-year distribution, fiction-vs-nonfiction, books/pages per month
- [ ] Total books + total pages + average length headline stats

### Add After Validation (v1.x)

- [ ] Original-language breakdown chart — one extra chart, data already available, trivial addition
- [ ] Translated vs original-language split — derived; add after users ask
- [ ] "Read around the world" map view — attractive; defer unless low-effort with Mantine + GeoJSON
- [ ] Bulk re-enrich action — add if unmatched-inbox volume justifies

### Future Consideration (v2+)

- [ ] Shareable Wrapped-style card — explicitly deferred in PROJECT.md
- [ ] Author detail page — explicitly deferred in PROJECT.md
- [ ] Year-over-year comparisons — defer; StoryGraph itself hasn't shipped this yet
- [ ] Author-merge UI (pseudonyms) — defer unless users report pain
- [ ] Reading goals — orthogonal to this milestone

---

## Feature Prioritization Matrix

| Feature | User Value | Impl Cost | Priority |
|---------|------------|-----------|----------|
| OpenLibrary enrichment pipeline (work + author + genre) | HIGH | HIGH | P1 |
| Author entity migration | HIGH | MED | P1 |
| Curated genre whitelist | HIGH | MED | P1 |
| Manual edit UI with sticky-edits | HIGH | MED | P1 |
| Unmatched inbox | HIGH | LOW | P1 |
| Re-match flow | HIGH | MED | P1 |
| Nationality via Wikidata | HIGH | MED | P1 |
| Per-author nationality override | MED | LOW | P1 |
| Genre breakdown chart | HIGH | LOW | P1 |
| Nationality breakdown chart | HIGH | LOW | P1 |
| Publication-year distribution | MED | LOW | P1 |
| Fiction-vs-nonfiction split | MED | LOW | P1 |
| Books/pages-per-month chart | MED | LOW | P1 |
| Backfill job | HIGH | MED | P1 |
| Original-language breakdown | MED | LOW | P2 |
| "Read around the world" map | MED | MED | P2 |
| Decade-of-publication chart | LOW | LOW | P2 |
| Year-over-year comparison | MED | MED | P3 |
| Shareable Wrapped card | MED | HIGH | P3 |

---

## Competitor Feature Analysis

| Feature | Goodreads | StoryGraph | Hardcover | Calibre | KoInsight Plan |
|---------|-----------|------------|-----------|---------|----------------|
| Auto-match on import | Amazon-driven, frequent mis-attribution | ISBN + title/author; report-bad-match ticket | Import from GR/SG | ISBN-first; Google Books / Amazon | OpenLibrary-only; ISBN-first; sticky user edits |
| Edition vs work | Edition-based; confused stats | Work-based; "switch to edition" | Work-based | Identifier-based grouping | Work-based aggregation; edition retained for pub-year/language |
| Wrong-match fix UX | Librarian request queue (slow) | "Switch to this edition" on book page | Edit flow | Edit-metadata dialog | Re-match modal with top-N OL results |
| Genre source | User shelves (noisy) | Curated + crowd mood/pace tags | Curated + user tags | User-entered | Curated whitelist mapped from OL subjects |
| Author nationality | Not tracked | Not tracked | Not tracked | Not tracked | Wikidata P27 via OL remote_ids + override |
| Year in review | Shareable page with 5-6 stats | Full stats page + end-of-year wrap | Basic yearly goal progress | N/A | Dashboard section with year selector + 5-7 charts |
| Genre chart | Shelves-based bar (noisy) | Genre pie chart (flagship visual) | Present | N/A | Curated-whitelist pie/bar |
| Publication-year stat | Shown as "original publication year" | Decade breakdown | Present | Sort/filter | Histogram by decade |
| Overwrite-user-edits behavior | Yes, on Amazon re-import (hated) | No | No | User-controlled | No. Sticky-edit flag strictly enforced. |
| Paywall on stats | No | Custom charts gated by Plus | No | N/A | No. Self-hosted, no paywall. |

---

## Sources

- [Goodreads: How do I view and share my Year in Books](https://help.goodreads.com/s/article/How-do-I-view-my-Year-in-Books)
- [Goodreads: My year in books statistics discussion](https://help.goodreads.com/s/question/0D58V00007INVxESAX/year-in-books-2023)
- [Goodreads blog: your stats](https://www.goodreads.com/blog/show/226-your-stats)
- [Goodreads Librarians: Book linked to wrong author (144 threads)](https://www.goodreads.com/topic/show/2224978-book-linked-to-wrong-author-authors-have-same-name)
- [Goodreads Librarians: Incorrect metadata](https://www.goodreads.com/topic/show/22503068-incorrect-metadata)
- [StoryGraph: How to switch editions/formats](https://thestorygraph.freshdesk.com/support/solutions/articles/79000141927-switching-editions-formats-on-the-storygraph)
- [StoryGraph roadmap: Stats V5](https://roadmap.thestorygraph.com/features/posts/stats-v5)
- [StoryGraph roadmap: End-of-year review page](https://roadmap.thestorygraph.com/requests-ideas/posts/the-storygraph-s-end-of-year-review-page)
- [StoryGraph roadmap: Merge editions](https://roadmap.thestorygraph.com/requests-ideas/posts/merge-editions)
- [StoryGraph roadmap: Author stats](https://roadmap.thestorygraph.com/features/posts/author-stats)
- [StoryGraph roadmap: YoY stats](https://roadmap.thestorygraph.com/requests-ideas/posts/mood-pace-page-number-etc-year-over-year-stats)
- [StoryGraph Plus features](https://app.thestorygraph.com/plus)
- [Hardcover.app overview](https://mwm.ai/apps/hardcover-app/1663379893)
- [Bibliolifestyle: Best book-tracking apps 2026](https://bibliolifestyle.com/best-book-tracking-apps-for-readers/)
- [Bookish Brews: reading trackers for diversity tracking](https://bookishbrews.com/reading-trackers-the-best-way-to-track-diversity/)
- [Book Tracker: reading statistics tutorial](https://booktrack.app/tutorial/how-to-view-and-understand-your-reading-statistics/)
- [Calibre manual: Editing e-book metadata](https://manual.calibre-ebook.com/metadata.html)
- [Calibre manual: fetch-ebook-metadata](https://manual.calibre-ebook.com/generated/en/fetch-ebook-metadata.html)
- [OpenLibrary: Subjects overview](https://openlibrary.org/subjects)
- [OpenLibrary: Using subjects](https://openlibrary.org/tour/subjects)
- [OpenLibrary GH #11610: RFC add `genres` field to Work records](https://github.com/internetarchive/openlibrary/issues/11610)
- [OpenLibrary data exploration (skeptric)](https://skeptric.com/openlibrary-exploration/)
- [OpenLibrary: data dumps and Wikidata linkage](https://openlibrary.org/developers/dumps)
- [Wikidata: Open Library ID property](https://www.wikidata.org/wiki/Property:P648)
- [Wikipedia: Kazuo Ishiguro](https://en.wikipedia.org/wiki/Kazuo_Ishiguro)
- [Wikipedia: Vladimir Nabokov](https://en.wikipedia.org/wiki/Vladimir_Nabokov)
- [Read Around The World Challenge](https://readaroundtheworldchallenge.com/)

---
*Feature research for: KoInsight book-metadata-enrichment + yearly-reports milestone*
*Researched: 2026-04-23*
