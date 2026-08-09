---
id: SPEC-001
title: Check a copy out to a member
status: done
wave: 0
depends_on: []
owns:
  - src/domain/shared/result.ts
  - src/domain/shared/errors.ts
  - src/domain/shared/clock.ts
  - src/domain/shared/date.ts
  - src/domain/shared/identifier.ts
  - src/domain/catalog/book.ts
  - src/domain/catalog/book-copy.ts
  - src/domain/lending/member.ts
  - src/domain/lending/loan.ts
  - src/domain/lending/lending-policy.ts
  - src/application/ports/id-generator.ts
  - src/application/ports/repositories.ts
  - src/application/use-cases/checkout-copy.ts
  - src/adapters/inbound/http/router.ts
  - src/adapters/inbound/http/problem.ts
  - src/adapters/inbound/http/server.ts
  - src/adapters/inbound/http/routes/checkout-route.ts
  - src/adapters/outbound/memory/in-memory-repositories.ts
  - src/adapters/outbound/system/system-clock.ts
  - src/adapters/outbound/system/random-id-generator.ts
  - src/composition/container.ts
  - src/main.ts
  - tests/support/builders.ts
  - tests/support/fakes.ts
  - tests/unit/domain/result.test.ts
  - tests/unit/domain/errors.test.ts
  - tests/unit/domain/date.test.ts
  - tests/unit/domain/identifier.test.ts
  - tests/unit/domain/book.test.ts
  - tests/unit/domain/book-copy.test.ts
  - tests/unit/domain/loan.test.ts
  - tests/unit/domain/member.test.ts
  - tests/unit/domain/lending-policy.test.ts
  - tests/unit/application/checkout-copy.test.ts
  - tests/integration/http/checkout.test.ts
shared_contracts: []
estimated_tests: 62
---

# SPEC-001 — Check a copy out to a member

## Context

A member brings a physical book to the desk and wants to take it home. The
librarian needs a single answer — yes with a due date, or no with a reason they
can say out loud. This is the founding vertical slice: it establishes the
domain vocabulary, the `Result`-not-exceptions failure discipline, the injected
`Clock`, the port/adapter split, and the HTTP problem-details format that every
later spec inherits. It is documented retroactively so it can serve as the
worked example the rest of the set copies.

## Behaviour

**Identity.** Every identifier in the system is a branded string validated in
one place: 1–64 characters of letters, digits, hyphens or underscores, trimmed,
never empty. A `MemberId` and a `BookCopyId` are indistinguishable at runtime
and unswappable at compile time.

**The catalogue.** A book carries an ISBN-13 whose checksum is verified at the
boundary, plus a non-empty title and author with surrounding whitespace
removed. Hyphens and spaces inside an ISBN are formatting, not data.

**Copies.** A physical copy is `available`, `on-loan`, or `withdrawn`. State
transitions live with the entity, never in a use case: it must be impossible
for orchestration code to put a withdrawn copy back into circulation by
assigning a field. A withdrawn copy and an already-lent copy are *different*
operational problems — one needs a librarian, the other needs patience — so
they report different codes.

**Borrowing allowance.** The complete answer to "may this member take another
book out?" is one domain decision, evaluated in a deliberate order so that the
most explanatory reason wins: suspended membership first, then overdue items,
then the active-loan limit. A member told they are at the limit when they are
actually suspended has been given a useless answer.

**The policy is data.** Maximum active loans (5) and loan period (21 days) are
fields on a `LendingPolicy` value, not literals scattered through the code, so a
branch can run different rules without a code change and a test can construct an
absurd policy cheaply.

**Loans.** Opening a loan records the member, the copy, the instant it left the
building, and a due date derived from that instant plus the policy period. A
loan period must be a positive whole number of days. `returnedAt` is `null`
while the copy is out. A loan is overdue when it is still open and its due date
is strictly in the past.

**Time.** Nothing in `src/domain` or `src/application` calls `new Date()`. The
current instant arrives through a `Clock` port, which is what makes "this loan
is overdue" testable without waiting three weeks.

**Orchestration.** The use case parses input, loads state through ports, asks
the domain to decide, persists the decision, and returns a plain serialisable
view — never a domain entity. It contains no business `if`. Persistence order is
load-bearing: the copy is saved before the loan, because a copy marked on-loan
with no loan record is recoverable by an audit job, whereas a loan pointing at
an available copy would let the same book be lent twice.

**Failures.** Every expected outcome is a `Result` carrying a `DomainError` with
a code from a closed enum. The HTTP layer maps every code to a status
exhaustively, by construction: adding a code without deciding its status is a
compile error rather than a 500 in production. Failures are rendered as RFC 9457
problem details with `content-type: application/problem+json`.

## Acceptance criteria

- [ ] `parseIdentifier` accepts letters, digits, hyphens and underscores, trims surrounding whitespace, and names the offending brand in the error `details`
- [ ] An identifier of exactly 64 characters is accepted; 65 characters, an empty string, a leading hyphen, an embedded space, a slash, and a non-ASCII letter are each rejected with `INVALID_INPUT`
- [ ] A checksum-valid ISBN-13 is accepted and normalised, stripping hyphens and spaces; a 10-digit value, thirteen non-digits, and a mistyped final digit are each rejected with `INVALID_INPUT` and a message naming the digit count or the checksum
- [ ] `createBook` trims title and author, and rejects a whitespace-only title or author with a message naming the offending field
- [ ] `markOnLoan` moves an `available` copy to `on-loan` and returns a new object without mutating the original
- [ ] `markOnLoan` on an `on-loan` copy fails with `COPY_NOT_AVAILABLE`; on a `withdrawn` copy it fails with `COPY_WITHDRAWN`, and the two are distinguishable
- [ ] `openLoan` sets `checkedOutAt` to the supplied instant, `dueAt` to that instant plus the policy period, and `returnedAt` to `null`
- [ ] `openLoan` rejects a loan period that is zero, negative, or fractional with `INVALID_INPUT`
- [ ] A loan is overdue only when it is open and its due date is strictly earlier than now; a loan due at exactly the current instant is not overdue, and a returned loan is never overdue
- [ ] `checkBorrowingAllowance` reports `MEMBER_SUSPENDED` for a suspended member even when that member is also over the limit and holds overdue items
- [ ] `checkBorrowingAllowance` reports `MEMBER_HAS_OVERDUE_LOANS` when any active loan is overdue, with the overdue count in `details`
- [ ] `checkBorrowingAllowance` permits a member holding exactly four active loans under a limit of five, and reports `LOAN_LIMIT_REACHED` at exactly five
- [ ] Checking out an available copy to a member in good standing persists the copy as `on-loan` and a loan readable back from the loan repository, and returns a view carrying the loan id, member id, copy id, and both instants as ISO-8601 strings
- [ ] Checking out fails with `MEMBER_NOT_FOUND` for an unknown member and `COPY_NOT_FOUND` for an unknown copy, and in both cases nothing is written to either repository
- [ ] A failed allowance check leaves the copy `available` and creates no loan
- [ ] A malformed `memberId` or `copyId` fails with `INVALID_INPUT` before any repository is consulted
- [ ] `domainError` omits the `details` key entirely — not merely sets it to `undefined` — when no details are supplied
- [ ] `POST /loans` with a valid body returns 201 with a `location` header of `/loans/{loanId}` and the loan view as JSON
- [ ] `POST /loans` with a body that is not an object, or whose `memberId`/`copyId` is not a string, returns 400 problem details with code `INVALID_INPUT`
- [ ] Every `ErrorCode` maps to a status: `INVALID_INPUT` 400, `MEMBER_SUSPENDED` 403, `MEMBER_NOT_FOUND` and `COPY_NOT_FOUND` 404, and `MEMBER_HAS_OVERDUE_LOANS`, `LOAN_LIMIT_REACHED`, `COPY_NOT_AVAILABLE`, `COPY_WITHDRAWN` 409
- [ ] The router returns 404 for an unknown path and 405 for a known path with the wrong method, and binds `:name` segments into `request.params` with percent-decoding
- [ ] `GET /health` returns 200

## Out of scope

- Returning a copy — SPEC-002.
- Renewing a loan — SPEC-003.
- Creating, suspending, or reinstating members; the repository only reads them — SPEC-004.
- Searching the catalogue; there is no `BookRepository` yet — SPEC-005.
- Fines for overdue items — SPEC-006.
- Holds and reservations — SPEC-007.
- Durable storage; the only adapters are in-memory and the process holds all state — SPEC-008.
- Authentication, authorisation, and any notion of who the librarian is. No spec covers this; it is deliberately deferred until there is a second actor in the system.

## Notes for the implementer

This spec is `done`. It exists as documentation and as the reference standard
for voice, granularity, and criteria style. Do not re-implement it.

**Known gap — read this before dispatching wave 1.** Three test files in `owns`
are not yet in the tree: `tests/unit/domain/loan.test.ts`,
`tests/unit/domain/member.test.ts`, `tests/unit/domain/lending-policy.test.ts`,
`tests/unit/application/checkout-copy.test.ts`, and
`tests/integration/http/checkout.test.ts`. `vitest.config.ts` holds
`src/domain/**` to 100% coverage, so the baseline gate cannot be green until
they land. They are listed in `owns` so ownership is unambiguous — they belong
to this slice, not to whichever wave-1 spec happens to touch the module next.
Close the gap first: a wave dispatched from a red baseline makes every
subsequent failure ambiguous.

**Ownership handover.** Several paths here are re-claimed by later specs:
`src/domain/lending/loan.ts` and `src/domain/catalog/book-copy.ts` pass to
SPEC-002, `src/domain/lending/member.ts` to SPEC-004, and
`src/application/use-cases/checkout-copy.ts` to SPEC-008. A `done` spec's `owns`
list is a historical record of what its slice created; from wave 1 onward the
live owner of a path is the highest-wave spec that claims it. The validator only
enforces disjointness *within* a wave, which is the property that actually
matters for parallel work.

**Shared touchpoints this spec created**, which every later spec must treat as
append-only: `src/domain/shared/errors.ts` (the `ErrorCode` enum),
`src/adapters/inbound/http/problem.ts` (the `Record<ErrorCode, number>` status
map), `src/composition/container.ts` (the route array),
`src/application/ports/repositories.ts`, and `tests/support/builders.ts`. The
route array already carries the comment marking it as the coordination point;
keep it.

The `in-memory-repositories.ts` header comment refers to "SPEC-007's SQLite
adapter". In this plan SQLite is SPEC-008. Correct the comment the next time
that file is legitimately edited — do not open it just for that.
