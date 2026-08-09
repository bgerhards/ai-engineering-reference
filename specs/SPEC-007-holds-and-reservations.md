---
id: SPEC-007
title: Place a hold on a book and fulfil it on return
status: ready
wave: 2
depends_on:
  - SPEC-002
owns:
  - src/domain/lending/hold.ts
  - src/application/ports/hold-repository.ts
  - src/adapters/outbound/memory/in-memory-hold-repository.ts
  - src/application/use-cases/place-hold.ts
  - src/application/use-cases/return-copy.ts
  - src/adapters/inbound/http/routes/hold-routes.ts
  - tests/contract/hold-repository.contract.ts
  - tests/contract/in-memory-hold-repository.test.ts
  - tests/unit/domain/hold.test.ts
  - tests/unit/application/place-hold.test.ts
  - tests/unit/application/return-copy-fulfils-hold.test.ts
  - tests/integration/hold-routes.http.test.ts
shared_contracts:
  - src/application/ports/repositories.ts (append findByBook at the end of BookCopyRepository only; do not touch LoanRepository)
  - src/adapters/outbound/memory/in-memory-repositories.ts (implement the new method on InMemoryBookCopyRepository only)
  - src/application/ports/id-generator.ts (append nextHoldId at the end of the interface)
  - src/adapters/outbound/system/random-id-generator.ts (implement the new method; leave nextLoanId untouched)
  - tests/support/fakes.ts (implement the new method on SequentialIdGenerator; do not change nextLoanId's numbering)
  - tests/support/builders.ts (append a hold builder at the end; do not change any existing builder's defaults)
  - src/domain/shared/errors.ts (append new ErrorCode entries at the end only; never reorder or rename existing ones)
  - src/adapters/inbound/http/problem.ts (append one status mapping per new code, in the same order as the enum)
  - src/composition/container.ts (append the new routes and the hold repository to the wiring; change nothing else)
estimated_tests: 20
---

# SPEC-007 — Place a hold on a book and fulfil it on return

## Context

Every copy of a popular book is out, and a member wants to be told when one
comes back rather than checking the shelf twice a week. A hold is a promise
about a place in a queue: first asked, first served, and the promise expires if
the member does not come and collect. The queue is the only part of a library
system that members compare with each other, so its fairness has to be
mechanical and its order has to be reproducible.

## Behaviour

**A hold is on a book, not a copy.** A member does not care which physical copy
they get. A hold names the book, the member, and the instant it was placed. It
acquires a copy only when one becomes available.

**The queue is FIFO, and totally ordered.** Outstanding holds for a book are
served in the order they were placed, with the hold identifier as tiebreaker so
that two holds placed in the same millisecond still have a definite order. There
is no priority, no seniority, and no way to jump.

**Hold states.** A hold is *waiting* until a copy is assigned to it; then it is
*ready*, carrying the copy it was assigned, the instant it became ready, and an
expiry instant one shelf period later (default 7 days). A ready hold that is
collected becomes *fulfilled*. A ready hold whose expiry instant has passed is
*expired*: it has lost its place and no longer counts.

**Expiry is derived, not scheduled.** There is no background job. Whether a hold
is outstanding at a given instant is a pure question about its stored state, its
expiry instant, and the clock — evaluated every time the queue is read. A
scheduler that had to run for the data to be correct would be a source of
"correct only if cron ran" bugs, and there is no way to test it without waiting.

**Placing a hold.** In refusal order, most explanatory first:

- Malformed book id or member id — `INVALID_INPUT`, before any repository is
  consulted.
- Unknown member — `MEMBER_NOT_FOUND`. Suspended member — `MEMBER_SUSPENDED`; a
  membership that may not borrow may not queue.
- A book the library holds no copies of — `BOOK_NOT_FOUND`.
- At least one copy is `available` — `HOLD_NOT_NEEDED`. Go and borrow it; a
  queue for a book on the shelf is a queue nobody will ever be called from.
- No copy is `on-loan` — every copy is withdrawn, so nothing can ever come back
  — `HOLD_UNFULFILLABLE`. This is a different problem from the last one and a
  librarian acts on it differently.
- The member already has a copy of this book out on loan —
  `MEMBER_ALREADY_HAS_COPY`. They are queueing for a book they are holding.
- The member already has an outstanding hold on this book —
  `HOLD_ALREADY_PLACED`. Placing twice must not buy two places in the queue.

A successful hold is created *waiting*, at the back of the queue, and is
readable back with its position.

**Returning a copy fulfils the next hold.** After a return releases a copy, the
earliest outstanding waiting hold for that copy's book is assigned that copy and
becomes ready, with its expiry set one shelf period after the return instant.
Expired holds are skipped — the copy passes to the next member still waiting.
If nobody is waiting, the return behaves exactly as SPEC-002 specified.

**Fulfilment never blocks a return.** If the hold repository fails or the queue
is in some state the code did not expect, the copy still comes back and the loan
still closes. A return that fails because of a hold would leave a member holding
a book they tried to give back, which is worse than a hold that is served late.

**The assigned copy stays `available`.** Marking it otherwise would make it
invisible to a librarian looking for it on the reservations shelf, and SPEC-002
guarantees a returned copy is available. That another member can still walk up
and borrow a copy promised to somebody else is a real gap, named in Out of
scope.

**Its own port.** The hold repository is a separate port file, not another
interface in `repositories.ts`. It must answer: fetch a hold by id; save a
hold; list the outstanding holds for a book in queue order; list a member's
outstanding holds. Its behavioural promise — especially the queue ordering and
the tiebreaker — is defined by a contract suite every adapter must pass.

**HTTP surface.** `POST /books/:bookId/holds` with a JSON body carrying a string
`memberId`, returning 201 with a `location` header of `/holds/{holdId}` and a
hold view including its queue position. `GET /books/:bookId/holds` returns the
queue in order, excluding expired holds.

## Acceptance criteria

- [ ] Placing a hold on a book whose copies are all on loan creates a waiting hold at position 1, readable back from the repository
- [ ] A second member placing a hold on the same book gets position 2, and the queue reports the two in the order they were placed
- [ ] Two holds placed at the same instant are ordered by hold identifier, and the queue returns the same order on every read
- [ ] Placing a hold on a book with an available copy fails with `HOLD_NOT_NEEDED` and creates nothing
- [ ] Placing a hold on a book whose only copies are withdrawn fails with `HOLD_UNFULFILLABLE`
- [ ] Placing a hold on a book the library holds no copies of fails with `BOOK_NOT_FOUND`
- [ ] Placing a second hold on the same book as the same member fails with `HOLD_ALREADY_PLACED`, and the original hold keeps its position
- [ ] Placing a hold on a book the member already has out on loan fails with `MEMBER_ALREADY_HAS_COPY`
- [ ] Placing a hold as a suspended member fails with `MEMBER_SUSPENDED`; as an unknown member, `MEMBER_NOT_FOUND`; with a malformed book or member id, `INVALID_INPUT` before any repository is consulted
- [ ] A member may hold a different book while already holding one, and may hold a book they returned earlier
- [ ] Returning a copy with one waiting hold marks that hold ready against the returned copy, sets its expiry one shelf period after the return instant, and leaves the copy `available`
- [ ] Returning a copy with two waiting holds marks only the earliest ready; the second stays waiting at position 1 of the remaining queue
- [ ] Returning a copy with no waiting holds behaves exactly as SPEC-002 specifies: the loan closes, the copy is available, and no hold is created or changed
- [ ] A ready hold is outstanding up to and including its expiry instant, and not outstanding one second after it
- [ ] Returning a copy whose earliest hold has expired assigns the copy to the next member still waiting, and the expired hold is not made ready
- [ ] Returning a copy when every waiting hold has expired leaves the copy available with no hold made ready
- [ ] A return still closes the loan and releases the copy when hold fulfilment fails, and the failure is not reported to the caller as an error
- [ ] Returning a withdrawn copy fulfils no hold — a withdrawn copy is not going back into circulation
- [ ] The in-memory adapter passes the `HoldRepository` contract suite unmodified, including the queue order, the identifier tiebreaker, and the exclusion of expired holds
- [ ] `POST /books/:bookId/holds` returns 201 with a `location` header of `/holds/{holdId}` and the hold's queue position; a book with an available copy returns 409 with code `HOLD_NOT_NEEDED`; a duplicate returns 409 with code `HOLD_ALREADY_PLACED`
- [ ] `GET /books/:bookId/holds` returns the queue in order and omits expired holds

## Out of scope

- **Blocking a checkout of a copy that is promised to a waiting member.** The
  copy stays `available`, so anyone can borrow it. Closing this gap means
  editing SPEC-001's `checkout-copy.ts`, which no spec in this wave owns; it
  belongs to a follow-up spec. Named here so nobody assumes it was missed.
- **Blocking a renewal when somebody else is waiting.** SPEC-003 states the
  rule and defers it here; this spec cannot implement it either, because
  SPEC-003 owns `renew-loan.ts` in this same wave. What this spec *does*
  provide is the domain predicate — "does an outstanding hold by another member
  block renewal of this book?" — fully specified and tested here, so the
  follow-up that wires it into the renewal guard sequence is a few lines and no
  new thinking.
- Cancelling a hold, by the member or by a librarian. No spec covers this.
- Collecting a ready hold — the transition from ready to fulfilled at the moment
  the member actually checks the copy out. The state exists in the model; the
  path that reaches it does not, because it runs through
  `checkout-copy.ts`. No spec covers this.
- Notifying a member that their hold is ready. No spec covers notifications.
- Holds on a specific copy rather than on a book, and holds across branches. No
  spec covers either.
- Charging for a hold, or fining an expired one — SPEC-006 computes overdue
  fines only.

## Notes for the implementer

**You take over `src/application/use-cases/return-copy.ts`** from SPEC-002,
which merged in wave 1. Everything SPEC-002 specified about returns must keep
passing unchanged — its unit, integration and domain tests are its own, and you
may not edit them. Add your fulfilment step after the existing return succeeds,
and put your own tests in
`tests/unit/application/return-copy-fulfils-hold.test.ts`.

**Do not touch `loan.ts`, `book-copy.ts`, `member.ts`, `renew-loan.ts`,
`fine-policy.ts`, or `assess-member-fines.ts`.** The first three belong to
merged wave-1 specs and are read by your wave siblings; the last three belong to
SPEC-003 and SPEC-006, running right now.

**Your port lives in its own file** — `src/application/ports/hold-repository.ts`
— and this is deliberate. SPEC-003 and SPEC-006 are both appending to
`LoanRepository` in `repositories.ts` in this wave and will collide with each
other; a third appender in the same file would turn a two-line "keep both"
resolution into a three-way one. The cost is one more import in the container.

**Getting a book's copies without a third `LoanRepository` append.** You do need
one method on the shared port file: `findByBook` on `BookCopyRepository`. Append
it at the end of *that* interface — a different region of the file from the
`LoanRepository` block your siblings are editing, so git merges the three
changes cleanly. Same rule in `in-memory-repositories.ts`: your method goes on
`InMemoryBookCopyRepository`, theirs on `InMemoryLoanRepository`.

You need no other query. "Does this member already have this book out?" is
answered by intersecting the copies of the book with the member's active loans,
both of which you can already fetch.

**The id generator ripples.** Appending `nextHoldId` to the `IdGenerator`
interface breaks every implementation until it is updated: the production
`randomIdGenerator` and `SequentialIdGenerator` in `tests/support/fakes.ts`.
Update both; keep `nextLoanId`'s existing counter behaviour exactly as it is,
because other specs' tests assert on `loan-1`, `loan-2` and so on. Give holds
their own counter.

**Append-only rules.**

- `src/domain/shared/errors.ts` — append `BOOK_NOT_FOUND`, `HOLD_NOT_NEEDED`,
  `HOLD_UNFULFILLABLE`, `HOLD_ALREADY_PLACED`, and `MEMBER_ALREADY_HAS_COPY` at
  the end. Reuse `MEMBER_NOT_FOUND`, `MEMBER_SUSPENDED` and `INVALID_INPUT` —
  do not add near-duplicates. SPEC-003 is appending three codes here too;
  expect a conflict at the end of the object and keep both sides.
- `src/adapters/inbound/http/problem.ts` — `BOOK_NOT_FOUND` is 404; the other
  four are 409. This file will not compile until every new code is mapped, and
  it is the single most conflict-prone file in the repository. Append only, in
  the same order you added the codes to the enum.
- `src/composition/container.ts` — append your routes to the end of the array
  and add the hold repository and the hold shelf period to the adapters record.

**Contract suite shape.** `tests/contract/hold-repository.contract.ts` exports a
reusable suite parameterised by a factory producing a fresh adapter;
`vitest.config.ts` excludes `*.contract.ts` from collection, so it runs only
through your binding file. SPEC-008 binds this exact file to SQLite and may not
edit it — so express the suite purely in terms of the port and an injected
clock, with no in-memory-specific helpers.

The domain layer must stay free of `node:*` and of `new Date()`; expiry is
decided by comparing stored instants against a clock instant passed in.
