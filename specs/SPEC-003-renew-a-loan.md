---
id: SPEC-003
title: Renew a loan and extend its due date
status: ready
wave: 2
depends_on:
  - SPEC-002
owns:
  - src/domain/lending/renewal.ts
  - src/application/use-cases/renew-loan.ts
  - src/adapters/inbound/http/routes/renew-route.ts
  - tests/unit/domain/renewal.test.ts
  - tests/unit/application/renew-loan.test.ts
  - tests/integration/renew-loan.http.test.ts
shared_contracts:
  - src/application/ports/repositories.ts (append findById at the end of LoanRepository only; do not touch the other interfaces)
  - src/adapters/outbound/memory/in-memory-repositories.ts (implement the new method on InMemoryLoanRepository only)
  - src/domain/shared/errors.ts (append new ErrorCode entries at the end only; never reorder or rename existing ones)
  - src/adapters/inbound/http/problem.ts (append one status mapping per new code, in the same order as the enum)
  - src/composition/container.ts (append the new route to the end of the route array; change nothing else)
estimated_tests: 16
---

# SPEC-003 — Renew a loan and extend its due date

## Context

A member is halfway through a book and the due date is coming up. They phone
the desk, or click a button, and want another three weeks without carrying the
book back in. Renewal is the cheapest thing a library can offer, and the rules
around it are entirely about protecting everyone else: a book cannot be renewed
indefinitely, and it cannot be renewed once the borrower has already broken the
deal by keeping it too long.

## Behaviour

**A renewal moves the due date, nothing else.** The new due date is the current
due date plus one renewal period — not *now* plus a period. Renewing three days
early must not cost the member those three days, and renewing must never be a
way to shorten a loan.

**Renewal policy is data**, in the same spirit as `LendingPolicy`: a maximum
number of renewals per loan (2) and a renewal period in whole days, which
defaults to the lending policy's loan period (21 days). Tests construct absurd
policies cheaply; a branch library changes a value, not a line of code.

**Counting renewals without changing the loan.** `Loan` has no renewal counter
and this spec does not add one — see the notes for why. Instead the count is
*derived*, from the invariant:

> `dueAt` = `checkedOutAt` + loan period + (renewals used × renewal period)

Renewals used is therefore a pure function of a loan and a policy, and the
renewal module is a pure function over `Loan`: it takes a loan, a policy and the
current instant, and answers either "here is the new due date" or "here is why
not". Nothing about a loan's shape changes.

The derivation is only sound while the arithmetic divides evenly. A loan whose
due date is not a whole number of renewal periods past its original due date is
inconsistent with the policy it is being judged against — that is a data
integrity problem, and renewal refuses it with `INVALID_INPUT` rather than
guessing a count.

**The refusals.** Order matters, as it does for borrowing allowance: the most
explanatory reason wins.

- The loan does not exist — `LOAN_NOT_FOUND`.
- The loan is already closed — `LOAN_ALREADY_CLOSED`. A returned book has no
  due date to extend.
- The member is suspended — `MEMBER_SUSPENDED`. A membership that may not
  borrow may not extend either.
- The loan is overdue at the moment of the request — `LOAN_OVERDUE`. Overdue
  means past the due date, strictly: a loan due at exactly the current instant
  is still renewable. This is the rule that stops renewal being used to
  retroactively erase lateness.
- The loan has already used its renewals — `RENEWAL_LIMIT_REACHED`, with the
  limit and the number used in the error details so the desk can explain it.

Every refusal leaves the loan's due date exactly as it was, and writes nothing.

**Orchestration.** Parse the loan id, load the loan, load its member, ask the
renewal rule to decide, persist the loan with its new due date, return a plain
view carrying the loan id, the previous due date, the new due date, the number
of renewals used, and how many remain.

**HTTP surface.** `POST /loans/:loanId/renewals`, no body. Success is 200 with
the renewal view.

## Acceptance criteria

- [ ] Renewing a loan due in five days moves its due date forward by exactly one renewal period from the *existing* due date, not from the current instant
- [ ] A loan that has never been renewed reports zero renewals used and the full allowance remaining
- [ ] Renewals used is derived correctly for a loan whose due date is one, and then two, renewal periods past its original due date
- [ ] Renewing twice succeeds both times; the third attempt fails with `RENEWAL_LIMIT_REACHED`, carrying the limit and the count used in the error details, and the due date is unchanged
- [ ] A loan whose due date is not a whole number of renewal periods past its original due date is refused with `INVALID_INPUT` rather than being assigned a guessed renewal count
- [ ] A loan due at exactly the current instant is renewable; one second past its due date fails with `LOAN_OVERDUE` and the due date is unchanged
- [ ] Renewing a closed loan fails with `LOAN_ALREADY_CLOSED`; its due date and return instant are unchanged
- [ ] Renewing a loan belonging to a suspended member fails with `MEMBER_SUSPENDED` and nothing is written
- [ ] Renewing an unknown loan fails with `LOAN_NOT_FOUND` and nothing is written
- [ ] A malformed loan id fails with `INVALID_INPUT` before any repository is consulted
- [ ] A successful renewal is readable back from the loan repository with the new due date, and its checkout instant, member, copy and return instant are untouched
- [ ] Renewal does not change the copy's status: a copy `on-loan` before the renewal is still `on-loan` after it
- [ ] Renewal does not change the member's active-loan count
- [ ] A renewal policy allowing zero renewals refuses the first attempt with `RENEWAL_LIMIT_REACHED`
- [ ] `POST /loans/:loanId/renewals` returns 200 with the renewal view; an unknown loan returns 404 with code `LOAN_NOT_FOUND`; an overdue loan returns 409 with code `LOAN_OVERDUE`; a loan at its renewal limit returns 409 with code `RENEWAL_LIMIT_REACHED`

## Out of scope

- **Blocking renewal when another member is waiting for the book.** This is a
  real rule and it is deliberately not implemented here. Holds arrive in
  SPEC-007, which runs in this same wave and owns the hold model; SPEC-003 owns
  `renew-loan.ts` and SPEC-007 may not edit it, so wiring the two together
  belongs to a follow-up spec once both have merged. SPEC-007 exposes the
  predicate ("does an outstanding hold by another member block renewal of this
  book?") precisely so that follow-up is a small change to the guard sequence
  here and nothing else. Until then, a renewal can jump a hold queue — a known,
  accepted gap, not an oversight.
- Charging for the renewal, or for the lateness that made it impossible —
  SPEC-006.
- Renewing every loan a member holds in one request. No spec covers this.
- Any limit on renewals expressed in total elapsed days rather than a count. No
  spec covers this.
- Notifying the member that their loan was renewed, or that it is about to
  expire. No spec covers notifications at all.

## Notes for the implementer

**Do not edit `src/domain/lending/loan.ts`.** It belongs to SPEC-002 and has
merged; SPEC-006 and SPEC-007 are reading it in this wave. Your module lives
beside it in `renewal.ts` and takes a `Loan` as an argument. This is the
constraint that shapes the whole spec, so it is worth stating what it cost and
why it was still the right call.

The obvious design is a `renewalCount` field on `Loan`. It was rejected because
adding it means editing a file this spec does not own, in a wave where two
sibling specs read that file — and because the information is already in the
data. The due date *is* the record of renewals when each renewal extends by a
fixed period, so deriving the count is not a workaround; it removes a field that
could disagree with the dates.

The honest limitation: the derivation assumes a fixed renewal period. If a
later spec makes the renewal period variable, or lets a librarian grant an
arbitrary extension, the invariant breaks and `Loan` genuinely needs an explicit
counter. When that day comes, the change is a spec that owns `loan.ts`, a
migration in SPEC-008's schema, and the deletion of the derivation — not a patch
on top of it. Write the derivation as one named, separately tested function so
that removal stays cheap.

**Append-only rules.**

- `src/domain/shared/errors.ts` — append `LOAN_NOT_FOUND`,
  `RENEWAL_LIMIT_REACHED`, and `LOAN_OVERDUE` at the end. `LOAN_ALREADY_CLOSED`
  and `MEMBER_SUSPENDED` already exist from SPEC-002 and SPEC-001 — reuse them,
  do not add near-duplicates. SPEC-007 is appending its own codes in this wave;
  expect a conflict at the end of the object and keep both sides.
- `src/adapters/inbound/http/problem.ts` — `LOAN_NOT_FOUND` is 404;
  `RENEWAL_LIMIT_REACHED` and `LOAN_OVERDUE` are 409. `Record<ErrorCode,
  number>` will not compile until you map all three.
- `src/application/ports/repositories.ts` — append `findById` at the end of
  `LoanRepository`, one method per line. **SPEC-006 is appending a different
  method to the same interface in this wave.** A textual conflict here is
  likely and expected; the resolution is *keep both lines*. If you find
  yourself choosing between them, stop — something is wrong with the plan.
- `src/adapters/outbound/memory/in-memory-repositories.ts` — implement your new
  method on `InMemoryLoanRepository` only. Same conflict, same resolution.
  SPEC-007 is appending to `InMemoryBookCopyRepository` in the same file; that
  is a different region and should merge cleanly.
- `src/composition/container.ts` — append your route to the end of the array.

`FixedClock` from `tests/support/fakes.ts` is how you test "one second past the
due date". The architecture validator fails the build on `new Date()` outside
adapters, and the domain must stay free of `node:*` entirely.
