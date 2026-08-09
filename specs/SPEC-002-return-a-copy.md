---
id: SPEC-002
title: Return a borrowed copy
status: ready
wave: 1
depends_on:
  - SPEC-001
owns:
  - src/domain/lending/loan.ts
  - src/domain/catalog/book-copy.ts
  - src/application/use-cases/return-copy.ts
  - src/adapters/inbound/http/routes/return-route.ts
  - tests/unit/domain/loan-return.test.ts
  - tests/unit/domain/book-copy-return.test.ts
  - tests/unit/application/return-copy.test.ts
  - tests/integration/return-copy.http.test.ts
shared_contracts:
  - src/domain/shared/errors.ts (append new ErrorCode entries at the end only; never reorder or rename existing ones)
  - src/adapters/inbound/http/problem.ts (append one status mapping per new code, in the same order as the enum)
  - src/composition/container.ts (append the new route to the end of the route array; change nothing else)
estimated_tests: 16
---

# SPEC-002 — Return a borrowed copy

## Context

A member drops a book through the letterbox or hands it back at the desk. The
librarian scans the barcode on the copy — not a loan reference, which nobody
carries — and the copy has to go back on the shelf while the member's record
stops counting it against their limit. Returns also have to survive the messy
cases: the same book scanned twice, a book that was never out, and a book that
was withdrawn from circulation while a member had it at home.

## Behaviour

**Returns are keyed by the copy.** The gesture at the desk is "scan this book",
so the operation identifies a copy and finds the loan, not the other way round.
There is exactly one open loan per copy at any time; that is the invariant the
whole flow rests on, and it is already guaranteed by SPEC-001 refusing to lend a
copy that is not `available`.

**Closing a loan.** Closing sets the loan's return instant from the injected
`Clock` and is a one-way transition: a loan carries a return instant or it does
not, and once it does the value never changes. Attempting to close a loan that
already carries one is a domain failure, not a silent no-op — a librarian
scanning the same book twice deserves to be told the second scan did nothing.
The return instant must not be earlier than the checkout instant.

**Releasing the copy.** A copy that is `on-loan` becomes `available`. A copy
that is `withdrawn` stays `withdrawn`: withdrawal is a decision about the
physical item, and it outlives the loan. The copy comes back, the loan closes,
and the item does not return to circulation. A copy that is already `available`
cannot be released — it was never out.

**Orchestration and failure.** The use case parses the copy id, loads the copy,
finds the open loan for it, asks the domain to close the loan and release the
copy, then persists. Failures leave nothing behind:

- unparseable copy id — `INVALID_INPUT`, no repository consulted
- no such copy — `COPY_NOT_FOUND`
- no open loan for that copy — `COPY_NOT_ON_LOAN` (new code); this is what a
  second scan of the same book produces, and what a book that was never
  borrowed produces
- a loan that already carries a return instant — `LOAN_ALREADY_CLOSED` (new
  code) at the domain level; the use case cannot normally reach it, because a
  closed loan is not an open loan, but the domain rule is stated and tested
  independently of the use case that happens to call it

**Persistence order is the mirror image of checkout.** The loan closure is
written before the copy is released. If the process dies between the two, the
system holds a closed loan and a copy still marked `on-loan`: the book is
temporarily unavailable and an audit job can fix it. The opposite order would
leave an available copy with an open loan against it, which lets the same copy
be lent twice and leaves a member permanently one loan over.

**HTTP surface.** `POST /returns` with a JSON body carrying a string `copyId`.
Success is 200 with a view of the closed loan — its id, member, copy, the return
instant, and whether it was returned late — as ISO-8601 strings. A body that is
not an object, or whose `copyId` is not a string, is `INVALID_INPUT`.

## Acceptance criteria

- [ ] Closing an open loan sets its return instant to the clock's instant, returns a new object, and does not mutate the original
- [ ] Closing a loan that already carries a return instant fails with `LOAN_ALREADY_CLOSED` and returns the loan unchanged
- [ ] Closing a loan with an instant earlier than its checkout instant fails with `INVALID_INPUT`
- [ ] A closed loan is no longer active and is never reported as overdue, however far past its due date the clock has moved
- [ ] Releasing an `on-loan` copy yields an `available` copy without mutating the original
- [ ] Releasing a `withdrawn` copy succeeds and the copy stays `withdrawn` — it does not become `available`
- [ ] Releasing an `available` copy fails with `COPY_NOT_ON_LOAN`
- [ ] Returning a borrowed copy closes its loan, marks the copy `available`, and both are readable back from their repositories
- [ ] After a successful return the member's active-loan count drops by one, so a member at the limit of five can immediately borrow again
- [ ] Returning the same copy twice: the second attempt fails with `COPY_NOT_ON_LOAN`, the loan's return instant keeps its original value, and the copy stays `available`
- [ ] Returning a copy that was never borrowed fails with `COPY_NOT_ON_LOAN` and writes nothing
- [ ] Returning an unknown copy fails with `COPY_NOT_FOUND` and writes nothing
- [ ] Returning a copy whose id is malformed fails with `INVALID_INPUT` before any repository is consulted
- [ ] Returning a copy that was withdrawn while on loan closes the loan and leaves the copy `withdrawn`
- [ ] Returning a copy after its due date succeeds and the result reports the return as late; returning on the due date reports it as not late
- [ ] `POST /returns` returns 200 with the closed-loan view; an unknown copy returns 404 problem details with code `COPY_NOT_FOUND`, and a copy that is not out returns 409 with code `COPY_NOT_ON_LOAN`

## Out of scope

- Charging anything for a late return. The result reports *that* a return was
  late; it computes no money. Fines are derived on demand and never written at
  return time — SPEC-006.
- Fulfilling a waiting hold with the returned copy — SPEC-007, which takes over
  `return-copy.ts` in wave 2.
- Extending a due date instead of returning — SPEC-003.
- Marking a copy lost or damaged, and any state beyond the three that exist. No
  spec covers this yet.
- Bulk returns of several copies in one request. No spec covers this; a single
  scan is the real gesture.

## Notes for the implementer

**Files you take over.** `src/domain/lending/loan.ts` and
`src/domain/catalog/book-copy.ts` were created by SPEC-001, which is `done`.
You own them now. Add to them; do not restructure them. In particular
`openLoan`, `isActive`, `isOverdue`, `markOnLoan`, and `isAvailable` are called
from `checkout-copy.ts`, which you do not own — their behaviour must not
change.

**Do not rename `returnedAt`.** `tests/support/builders.ts` sets it, SPEC-006
reads it to compute fines, and SPEC-008 maps it to a column. Its type stays
`Date | null`.

**Append-only rules.**

- `src/domain/shared/errors.ts` — append `LOAN_ALREADY_CLOSED` and
  `COPY_NOT_ON_LOAN` at the end of the `ErrorCode` object. Do not reorder,
  rename, or remove entries; SPEC-004 is appending to the same file in this
  wave and a reorder turns a clean merge into a rewrite.
- `src/adapters/inbound/http/problem.ts` — `STATUS_BY_CODE` is a
  `Record<ErrorCode, number>`, so your two new codes make this file a *compile
  error* until you map them. Both are 409. Append the entries at the end in
  the same order you added them to the enum. This is the highest-risk file in
  the repository for a parallel wave; touch nothing else in it.
- `src/composition/container.ts` — append your route to the end of the array
  and wire the use case above it, in the same style as `checkoutCopy`.

**You need no new port methods.** `LoanRepository.findActiveByCopy` already
exists and is exactly the query this use case wants. Resist adding one:
`src/application/ports/repositories.ts` is already contended in wave 2, and
staying off it entirely is worth more than a marginally tidier call site.

**Test placement.** Your unit tests go in new files, not into
`tests/unit/domain/loan.test.ts` or `tests/unit/domain/book-copy.test.ts` —
those belong to SPEC-001 and its own criteria assert against them. Use
`loan-return.test.ts` and `book-copy-return.test.ts`.

Use `FixedClock` from `tests/support/fakes.ts` for anything time-dependent; the
architecture validator fails the build on `new Date()` outside adapters.
