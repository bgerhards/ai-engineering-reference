---
id: SPEC-005
title: Search the catalogue by title, author or ISBN
status: ready
wave: 1
depends_on:
  - SPEC-001
owns:
  - src/application/ports/book-repository.ts
  - src/adapters/outbound/memory/in-memory-book-repository.ts
  - src/application/use-cases/search-catalog.ts
  - src/adapters/inbound/http/routes/catalog-routes.ts
  - tests/contract/book-repository.contract.ts
  - tests/contract/in-memory-book-repository.test.ts
  - tests/unit/application/search-catalog.test.ts
  - tests/integration/catalog-routes.http.test.ts
shared_contracts:
  - src/composition/container.ts (append the new route and its wiring to the end of the route array; change nothing else)
  - tests/support/builders.ts (append a book builder at the end; do not change any existing builder's defaults)
estimated_tests: 17
---

# SPEC-005 — Search the catalogue by title, author or ISBN

## Context

Somebody at a terminal in the lobby wants to know whether the library has a
book, and neither they nor the librarian knows its identifier. They type part
of a title, part of an author's name, or an ISBN copied off the back of a
paperback. The system has a `Book` type and no way whatsoever to find one: there
is no book repository, and nothing has ever read the catalogue.

## Behaviour

**Two ways to ask.** A free-text query matches a substring of the title *or* the
author, case-insensitively, with surrounding whitespace trimmed. An ISBN query
matches exactly one book or none; hyphens and spaces in the input are
formatting, and an ISBN whose checksum does not verify is a typo, not a search
that happens to find nothing.

**One question per request.** A request supplies free text or an ISBN, not
both, and not neither. Supplying neither is `INVALID_INPUT` — an unbounded
"give me everything" is a different feature with different performance
characteristics, and quietly returning the whole catalogue for an empty box is
how a search endpoint becomes a denial-of-service. A free-text query that is
empty or only whitespace after trimming is also `INVALID_INPUT`. A
single-character query is valid.

**A total order, always.** Results are sorted by title, then by author, then by
book identifier, all ascending, compared case-insensitively for title and
author. The identifier tiebreaker is what makes the order *total*: without it,
two books sharing a title and author could swap places between requests, and
page 2 could repeat or skip a row that page 1 already showed. Pagination is
meaningless without a stable total order, and this is the reason.

**Pages.** Pages are 1-based. Page size defaults to 20 and is capped at 100. A
page number or page size that is not a positive whole number, or a page size
above the cap, is `INVALID_INPUT` — clamping silently would give the caller a
page of a different size than they asked for and no way to know. A page beyond
the last result is not an error: it returns an empty list, the same total, and
HTTP 200. Callers page until they get nothing back, and turning the last page
into a 404 breaks that loop.

**The result is a page, not a list.** Every response reports the items on this
page, the page number, the page size, and the total number of matches across all
pages — so a caller can render "page 2 of 7" without a second request.

**A new port.** The application gains a book repository expressed in the
application's vocabulary: find the page of books matching this criteria, in the
catalogue's canonical order, and tell me how many matched in total. **Paging and
ordering belong inside the port**, not in the use case: a SQL adapter must be
able to answer with `LIMIT`/`OFFSET` and an `ORDER BY` rather than loading the
whole catalogue into memory to slice it. The test for whether a port method is
in the right layer is whether switching database would change it — this one
would not.

The port's real definition is its contract suite, which every adapter must
pass: the matching rules, the ordering rule including the identifier
tiebreaker, and the paging arithmetic including the empty page past the end.

**HTTP surface.** `GET /books` with query parameters `q`, `isbn`, `page`, and
`pageSize`. Success is 200 with the page view. Everything invalid is 400
problem details with code `INVALID_INPUT`. There is no 404: a search that
matches nothing succeeded and found nothing.

## Acceptance criteria

- [ ] A free-text query matches a substring of the title, case-insensitively, and returns every matching book
- [ ] The same query matches a substring of the author, and a book matching on both title and author appears exactly once
- [ ] A query matching nothing returns an empty list with a total of 0 and HTTP 200
- [ ] A missing query — neither free text nor ISBN — fails with `INVALID_INPUT`
- [ ] A free-text query that is empty or whitespace-only fails with `INVALID_INPUT`; a single-character query is accepted
- [ ] Supplying both free text and an ISBN fails with `INVALID_INPUT`
- [ ] An ISBN query returns the one book with that ISBN, and matches whether the input is hyphenated, spaced, or bare
- [ ] An ISBN query whose checksum does not verify fails with `INVALID_INPUT` rather than returning an empty result
- [ ] An ISBN query for a valid ISBN not in the catalogue returns an empty list with a total of 0
- [ ] Results are ordered by title, then author, then book id, all ascending and case-insensitively for the text fields; two books with identical title and author come back in book-id order on every run
- [ ] With 25 matches and the default page size, page 1 returns 20 items and page 2 returns 5, with a total of 25 on both
- [ ] The same 25 matches paged at size 10 yield pages of 10, 10 and 5 with no item appearing on two pages and none missing
- [ ] Page 4 of a 25-item result at page size 10 returns an empty list, a total of 25, and HTTP 200
- [ ] Page 0, a negative page, a fractional page, and a non-numeric page each fail with `INVALID_INPUT`
- [ ] Page size 0 and page size 101 each fail with `INVALID_INPUT`; page size 1 and page size 100 are accepted
- [ ] The in-memory adapter passes the `BookRepository` contract suite unmodified
- [ ] `GET /books?q=…` returns 200 with items, page, pageSize and total; a malformed `pageSize` returns 400 problem details with code `INVALID_INPUT`

## Out of scope

- **Do not edit `src/domain/catalog/book.ts`.** It already has everything this
  spec needs — the `Book` type, `parseBookId`, and `parseIsbn13` with its
  checksum. Import them; do not extend them. No ranking score, no normalised
  search field, no full-text index on the entity.
- Adding books to the catalogue. The repository is read-only, and fixtures are
  seeded directly through the adapter. No spec covers cataloguing yet.
- Reporting how many copies of a book exist or whether any are available. That
  joins the catalogue to lending and belongs with holds — SPEC-007.
- Relevance ranking, fuzzy matching, stemming, accent folding, and
  language-aware collation. Deliberately deferred: substring matching is what a
  library terminal actually needs, and everything above it is a search-engine
  project.
- Sorting by anything other than the canonical order, and any client-chosen
  sort. No spec covers this.
- Cursor-based pagination. Offset paging is correct here because the total
  order is stable and the catalogue is small.

## Notes for the implementer

**Everything you own is new.** No file in your `owns` list exists yet, which
makes this the least contended spec in wave 1. Keep it that way.

**Your port goes in its own file.** `src/application/ports/book-repository.ts`,
not `repositories.ts`. That file is already appended to by SPEC-004 in this
wave and by SPEC-003 and SPEC-006 in the next; a fourth writer would guarantee
a conflict for no benefit. The same reasoning puts your adapter in
`in-memory-book-repository.ts` rather than in the existing
`in-memory-repositories.ts`, which SPEC-004 is editing right now.

**Seeding.** Your adapter needs a way for tests to put books in, in the same
spirit as the existing `add` helpers. Keep it off the port interface — it is an
adapter affordance, not part of the application's vocabulary, and SPEC-008's
SQLite adapter must not be forced to implement it.

**Contract suite shape.** `tests/contract/book-repository.contract.ts` exports
a reusable suite parameterised by a factory that produces a fresh, seeded
adapter; `vitest.config.ts` excludes `*.contract.ts` from collection, so the
suite runs only through a binding file — yours is
`tests/contract/in-memory-book-repository.test.ts`. Express the suite purely in
terms of the port plus the seeding factory you accept as a parameter, because
SPEC-008 binds this exact file to SQLite and may not edit it.

**Append-only rules.**

- `src/composition/container.ts` — append your route to the end of the array,
  and construct the book repository alongside the other adapters in
  `createDefaultAdapters`. Add fields; do not reorder or rename the existing
  ones.
- `tests/support/builders.ts` — append a book builder with valid defaults,
  including a checksum-valid ISBN. Do not change `aMember`, `aBookCopy`, or
  `aLoan`; SPEC-002 and SPEC-004 are using them in this wave.

**You need no new error codes.** Everything this spec rejects is
`INVALID_INPUT`, which means you never have to open
`src/adapters/inbound/http/problem.ts` — the file most likely to conflict in
this wave. That is a deliberate design choice, not an accident: prefer an
existing code over a new one unless the caller would genuinely act differently.

Query parameters arrive as strings in `request.query`. Parsing and validating
them is adapter work in the sense of translation, but the *rules* — the page
size cap, the 1-based page numbering — are policy and belong where the use case
can test them without an HTTP request.
