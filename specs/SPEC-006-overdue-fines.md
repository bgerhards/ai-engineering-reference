---
id: SPEC-006
title: Assess what a member owes in overdue fines
status: ready
wave: 2
depends_on:
  - SPEC-002
owns:
  - src/domain/lending/fine-policy.ts
  - src/application/use-cases/assess-member-fines.ts
  - src/adapters/inbound/http/routes/fines-route.ts
  - tests/unit/domain/fine-policy.test.ts
  - tests/unit/application/assess-member-fines.test.ts
  - tests/integration/fines-route.http.test.ts
shared_contracts:
  - src/application/ports/repositories.ts (append findByMember at the end of LoanRepository only; do not touch the other interfaces)
  - src/adapters/outbound/memory/in-memory-repositories.ts (implement the new method on InMemoryLoanRepository only)
  - src/composition/container.ts (append the new route and the fine policy to the wiring; change nothing else)
estimated_tests: 16
---

# SPEC-006 — Assess what a member owes in overdue fines

## Context

A member arrives at the desk and the librarian needs a number: what do you owe,
and for which books. Some of those books are still at home and the debt is
still growing; others came back late last month and the debt stopped there. The
answer has to be the same whether it is asked now, in an hour, or from a
different terminal, and it has to be arithmetic somebody can check on paper
while the member is standing there.

## Behaviour

**Fines are derived, never stored.** There is no fine record, no balance field,
and nothing is written when a copy comes back. Asking what a member owes reads
their loans and computes the answer from the dates. This is the central
constraint of the spec and it earns its keep three times over: the number can
never drift out of step with the loans it came from; changing the policy
re-prices history correctly instead of leaving a stratum of loans priced under
the old rules; and — see the notes — it is what keeps this spec out of
`return-copy.ts`, which SPEC-007 is editing in the same wave.

**Money is whole minor units.** Every amount is an integer count of the smallest
unit of the currency — pence, cents — and the policy carries the currency code.
No floating-point arithmetic appears anywhere in the calculation. A rate of 25
per day for 7 days is 175, exactly, always, and never 174.99999999999997.

**The policy is data**, like `LendingPolicy` before it: a daily rate in minor
units, a grace period in whole days, a per-loan cap in minor units, and a
currency code. Defaults: 25 minor units per day, 3 days of grace, a cap of 1500
minor units per loan, currency GBP.

**Per loan.** The number of days a loan ran late is counted from its due date to
its reference instant, in whole days, truncated — a book eleven hours late is
not a day late.

- For a loan that has come back, the reference instant is its return instant.
  The debt froze when the book arrived; it does not keep growing.
- For a loan still open, the reference instant is now. The debt is still
  growing, and the same query tomorrow gives a larger number. That is correct,
  and it is why nothing is stored.

Days late at or below the grace period cost nothing. Beyond it, each further
whole day costs the daily rate. The total for one loan is capped: once a loan
reaches the cap it stays there however long the book is missing, so a lost book
does not accrue an unbounded and uncollectable debt. An amount is never
negative — a book returned early or on time owes nothing.

**Per member.** The assessment covers every loan the member has ever held, open
or closed. It reports the currency, the total owed across all loans, and a
per-loan breakdown for every loan carrying a non-zero amount: the loan, the
copy, the due date, the return instant if there is one, the number of chargeable
days, and the amount. A member with nothing owing gets a total of zero and an
empty breakdown — that is a successful answer, not an error.

**Failures.** An unknown member is `MEMBER_NOT_FOUND`. A malformed member id is
`INVALID_INPUT`, before any repository is consulted. There are no other failure
modes, because computing a number cannot fail.

**HTTP surface.** `GET /members/:memberId/fines`, returning 200 with the
assessment. A member who owes nothing still returns 200.

## Acceptance criteria

- [ ] A loan returned on its due date owes nothing, and so does one returned early
- [ ] A loan returned exactly at the end of the grace period — 3 days late — owes nothing; one day further owes exactly one daily rate
- [ ] A loan 10 days late owes 7 chargeable days at the daily rate, computed as an exact integer
- [ ] A loan eleven hours past its due date owes nothing: part days are truncated, not rounded up
- [ ] A loan late enough to reach the per-loan cap owes exactly the cap, and a loan late for ten times as long owes exactly the same cap
- [ ] Every amount the calculation produces is a whole number; no intermediate or final value is fractional
- [ ] An open loan is priced to the current instant, so the same loan assessed a day later owes exactly one more daily rate
- [ ] A returned loan is priced to its return instant, so advancing the clock by a month does not change what it owes
- [ ] An open loan that is not yet due owes nothing
- [ ] A policy with a zero grace period charges from the first whole day late; a policy with a zero daily rate owes nothing however late the loan
- [ ] A member with no loans at all is assessed successfully with a total of zero and an empty breakdown
- [ ] A member whose every loan was returned on time is assessed with a total of zero and an empty breakdown
- [ ] A member with three qualifying loans is assessed with a total equal to the sum of the three amounts, and a breakdown entry for each, each carrying its loan id, copy id, chargeable days and amount
- [ ] Loans owing nothing are excluded from the breakdown but do not affect the total
- [ ] Assessing an unknown member fails with `MEMBER_NOT_FOUND`; a malformed member id fails with `INVALID_INPUT` before any repository is consulted
- [ ] `GET /members/:memberId/fines` returns 200 with the currency, total and breakdown; an unknown member returns 404 problem details with code `MEMBER_NOT_FOUND`
- [ ] Returning an overdue copy writes no fine anywhere: after the return, the assessment still computes the same amount from the loan's dates

## Out of scope

- **Recording, collecting, waiving, or refunding a payment.** There is no ledger
  and no balance. No spec covers this; when one does, it will add a payments
  concept alongside this calculation rather than replacing it, and this use case
  becomes "what was charged" minus "what was paid".
- Writing a fine at return time. Explicitly rejected — see Behaviour and the
  notes.
- Suspending a member automatically once they owe more than some threshold.
  SPEC-004 provides suspension; nothing triggers it automatically, and no spec
  covers a trigger.
- Charging for a lost or damaged copy, as opposed to a late one. The per-loan
  cap exists so a never-returned book has a bounded overdue charge; a
  replacement charge is a different thing and no spec covers it.
- Refusing to lend to a member who owes money. SPEC-001's borrowing allowance is
  unchanged, and this spec does not touch it.
- Currency conversion, or more than one currency in a single assessment. The
  policy carries one currency code.
- Calendar-aware grace — closed days, bank holidays, weekends. Deliberately
  deferred: it needs an opening-hours calendar the system does not have.

## Notes for the implementer

**Why you must not touch `return-copy.ts`.** The tempting design is to compute
the fine when the copy comes back and store it on the loan. Do not. SPEC-007 is
editing `src/application/use-cases/return-copy.ts` in this same wave to fulfil
holds, and it owns that file. Two specs editing one use case is not a merge
problem to be managed, it is a broken plan — and here the plan is not broken
precisely because "derive on demand" makes the return path irrelevant to you.
The constraint is a design improvement that happens to also buy parallelism;
keep it that way. The last acceptance criterion exists to prove you did.

**Do not touch `loan.ts` either.** It belongs to SPEC-002 and has merged. You
need `dueAt` and `returnedAt`, both of which are already there. No `fineAmount`
field, no `assessedAt`, nothing.

**Where the arithmetic lives.** The rate table, the grace comparison and the cap
are librarians' rules — they go in `src/domain/lending/fine-policy.ts` as pure
functions over a loan, a policy and an instant. The use case loads loans, calls
them, and sums. A use case containing `if (daysLate > policy.graceDays)` has
stolen a rule from the domain; the architecture review will say so.

`daysBetween` in `src/domain/shared/date.ts` already truncates toward zero,
which is exactly the part-day rule this spec wants. Use it rather than writing
new date arithmetic. Do not edit it.

**Append-only rules.**

- `src/application/ports/repositories.ts` — append `findByMember` at the end of
  `LoanRepository`. It returns *every* loan for the member, open and closed;
  `findActiveByMember` already exists and is not the same query, so leave it
  alone. **SPEC-003 is appending `findById` to this same interface in this
  wave.** A textual conflict is likely and the resolution is *keep both lines*,
  then run the gate — a clean merge of two independent changes can still fail
  the type checker.
- `src/adapters/outbound/memory/in-memory-repositories.ts` — implement the new
  method on `InMemoryLoanRepository` only. Same conflict, same resolution.
- `src/composition/container.ts` — append the route to the end of the array and
  add the default fine policy alongside `defaultLendingPolicy` in the adapters
  record. Add fields; do not reorder existing ones.

**You need no new error codes**, which means you never open
`src/adapters/inbound/http/problem.ts` — the highest-risk file in the wave.
`MEMBER_NOT_FOUND` and `INVALID_INPUT` already cover everything. Resist the urge
to add a code for "member owes nothing"; that is a successful result.

**Route paths.** Yours is `/members/:memberId/fines`. SPEC-004 already
registered `/members/:memberId/suspension` in a different file; the router
matches segment by segment, so the two coexist. Do not add your handler to
SPEC-004's `member-routes.ts` — that file is not yours.
