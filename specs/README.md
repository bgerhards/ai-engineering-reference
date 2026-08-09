# Specs

Every change to `src/` starts here. A spec is a contract with an agent that
cannot ask a follow-up question, which is why the format is strict and why
`npm run validate:specs` checks it mechanically rather than trusting it.

Start with `SPEC-TEMPLATE.md` for the schema and `SPEC-001-checkout-copy.md` for
the reference standard of voice, granularity and criteria style.

## Index

| ID | Title | Status | Wave | Depends on | Est. tests |
| --- | --- | --- | --- | --- | --- |
| SPEC-001 | Check a copy out to a member | done | 0 | — | 62 |
| SPEC-002 | Return a borrowed copy | ready | 1 | SPEC-001 | 16 |
| SPEC-004 | Register a member, suspend and reinstate them | ready | 1 | SPEC-001 | 18 |
| SPEC-005 | Search the catalogue by title, author or ISBN | ready | 1 | SPEC-001 | 17 |
| SPEC-003 | Renew a loan and extend its due date | ready | 2 | SPEC-002 | 16 |
| SPEC-006 | Assess what a member owes in overdue fines | ready | 2 | SPEC-002 | 16 |
| SPEC-007 | Place a hold on a book and fulfil it on return | ready | 2 | SPEC-002 | 20 |
| SPEC-008 | Persist everything in SQLite behind the existing ports | ready | 3 | SPEC-002…007 | 18 |

Numbering follows the order the specs were written, not the order they run. The
`wave` field is the schedule; the ID is just a name.

## Waves

A wave is a set of specs that can run simultaneously. Everything in wave N
merges and the gate goes green before wave N+1 starts.

| Wave | Specs | Agents | Why these group |
| --- | --- | --- | --- |
| 0 | SPEC-001 | — | The founding slice, already built. It establishes the vocabulary, the `Result` discipline, the injected `Clock`, the port/adapter split and the problem-details format that everything else inherits. Nothing can start until it exists, and nothing else belongs beside it. |
| 1 | SPEC-002, SPEC-004, SPEC-005 | 3 | Three different aggregates, three different corners of the tree. Returns touch loans and copies; registration touches members; search touches nothing that exists — it is all new files. Their `owns` sets are disjoint and none depends on another. The shared touchpoints are the error enum, the status map and the route list, all append-only. |
| 2 | SPEC-003, SPEC-006, SPEC-007 | 3 | All three need SPEC-002's closed-loan concept, so none could run in wave 1, and none depends on another. The interesting work here was keeping them apart: three specs all wanted the return path, the loan entity, and `repositories.ts`. See the conflict register — two of the three collisions were designed out rather than merged through. |
| 3 | SPEC-008 | 1 | An adapter follows the ports, and waves 1 and 2 change the ports. SPEC-008 implements six of them; putting anything beside it would mean implementing a moving target. The spec explains this at length because it is the most useful lesson in the set. |

Why not a wave of six? Because a wave of three that genuinely cannot collide
beats a wave of six that probably will not. The cost of a conflict is never the
merge — it is the review, the re-run, and the chance the resolution was subtly
wrong.

## Critical path

```
SPEC-001 ──▶ SPEC-002 ──▶ SPEC-007 ──▶ SPEC-008
 (done)       wave 1       wave 2       wave 3
```

Four nodes, three of them still to run. Every other chain is shorter or the same
length: SPEC-001 → SPEC-004 → SPEC-008 and SPEC-001 → SPEC-005 → SPEC-008 are
three, and SPEC-001 → SPEC-002 → SPEC-003 → SPEC-008 is four.

What that implies:

- **Elapsed time is three rounds, not seven specs.** Seven agents on a
  three-round critical path is still three rounds of dispatch, merge and gate.
  Buying a fourth agent for wave 1 would buy nothing; there is no fourth spec
  that could run there.
- **Each round costs the slowest spec in it, plus the merge.** Wave 1 finishes
  when SPEC-004 finishes (18 tests, a new port method, a contract suite); wave 2
  when SPEC-007 finishes (20 tests, a new port, a use case takeover). Sizing the
  laggard down is worth more than adding a sibling.
- **Wave 3 is one agent doing 18 tests alone.** That is the price of a spec
  whose inputs are six other specs' outputs, and it is visible in the plan
  rather than discovered on merge day.
- **The chain is real, not assumed.** SPEC-003, SPEC-006 and SPEC-007 all need
  `returnedAt` to mean something, and SPEC-008 needs every port to have stopped
  moving. The only soft link is SPEC-005, which depends on SPEC-001 for the
  `Book` type alone and could have run in wave 0 had wave 0 not already been
  built.

## Conflict register

Every file more than one spec touches, and the rule that keeps it mergeable. The
pattern is always the same: **append, never restructure.** Git merges two
appends to different regions cleanly; it does not merge a reformat.

| Touchpoint | Touched by | Rule | Risk |
| --- | --- | --- | --- |
| `src/adapters/inbound/http/problem.ts` | SPEC-002, 004 (w1); SPEC-003, 007 (w2) | Append one `STATUS_BY_CODE` entry per new code, in the same order the codes were added to the enum. Never reorder. | **Highest.** `Record<ErrorCode, number>` means adding a code *forces* a change here — the file will not compile until every code is mapped. Two specs per wave append to the same closing brace, so a textual conflict is near-certain in both waves 1 and 2. Resolution is always keep both sides. |
| `src/domain/shared/errors.ts` | SPEC-002, 004 (w1); SPEC-003, 007 (w2) | Append `ErrorCode` entries at the end. Never reorder, rename or remove. Reuse an existing code rather than adding a near-duplicate. | High, and mechanically linked to the row above: eleven new codes across the plan, every one of which drags `problem.ts` with it. |
| `src/composition/container.ts` | SPEC-002, 004, 005 (w1); SPEC-003, 006, 007 (w2); SPEC-008 (w3) | Append routes to the end of the route array; add adapter fields without reordering existing ones. The comment marking the array as the coordination point stays. | High by frequency, low by damage. Every spec in the plan touches it and all six wave-1 and wave-2 changes are single-line appends. |
| `src/application/ports/repositories.ts` | SPEC-004 (w1); SPEC-003, 006, 007 (w2) | Append methods at the end of *one* interface, one method per line. | High in wave 2, and worth being honest about: **SPEC-003 appends `findById` and SPEC-006 appends `findByMember` to the same `LoanRepository` interface, in the same wave.** A trivial textual conflict at the end of that block is likely. The resolution is *keep both lines*, then run `npm run gate` — a clean textual merge of two independent changes can still fail the type checker. SPEC-007 was deliberately steered to a different region (`BookCopyRepository`) and to its own port file, so it does not make it a three-way conflict. |
| `src/adapters/outbound/memory/in-memory-repositories.ts` | SPEC-004 (w1); SPEC-003, 006, 007 (w2); SPEC-008 (w3) | Add methods to the one class that needs them; leave the others untouched. | Mirrors the row above, class for class. SPEC-003 and SPEC-006 both extend `InMemoryLoanRepository` — keep both. SPEC-007 extends `InMemoryBookCopyRepository`, a different region. |
| `src/application/ports/id-generator.ts`, `src/adapters/outbound/system/random-id-generator.ts`, `tests/support/fakes.ts` | SPEC-007 (w2) | Append `nextHoldId`; implement it in both the production and the test generator; leave `nextLoanId`'s counter behaviour exactly as it is. | Low — one writer — but it is a *ripple*: widening the interface breaks every implementation until all three files move together. Other specs' tests assert on `loan-1`, `loan-2`; give holds their own counter. |
| `tests/support/builders.ts` | SPEC-005 (w1); SPEC-007 (w2) | Append new builders at the end. Never change an existing builder's defaults. | Low by contention, high by blast radius: every test in the repository depends on those defaults. SPEC-004 must additionally keep `aMember()` type-checking without editing it — see its notes. |
| `tests/contract/*.contract.ts` | Written by SPEC-004, 005, 007; **read-only** for SPEC-008 | A contract suite is the port's real definition. SPEC-008 binds them to SQLite and may not edit them. | Low, and deliberately so. If SPEC-008 cannot pass a suite without editing it, that is a finding to report, not a conflict to resolve — either the suite encoded an in-memory accident or the port is not implementation-independent. |
| `package.json` | SPEC-008 (w3) | Prefer not to. At most one dependency and one script, reported explicitly. Raising the `engines` floor for `node:sqlite` counts as a change. | Low — a single writer in a single-spec wave — but it is the one file where "I just added a line" can change what every other agent's environment does. |
| `src/domain/catalog/book.ts` | Nobody | SPEC-005 reads `Book`, `parseBookId` and `parseIsbn13` and **must not edit them**. | Listed because it is the obvious file for a search spec to reach into, and it already has everything needed. |

**Ownership handovers.** Five paths change owner between waves. A `done` spec's
`owns` list is a historical record of what its slice created; from wave 1 onward
the live owner of a path is the highest-wave spec that claims it. The validator
only enforces disjointness *within* a wave, which is the property that matters
for parallel work.

| Path | Handover |
| --- | --- |
| `src/domain/lending/loan.ts` | SPEC-001 → SPEC-002 (w1) |
| `src/domain/catalog/book-copy.ts` | SPEC-001 → SPEC-002 (w1) |
| `src/domain/lending/member.ts` | SPEC-001 → SPEC-004 (w1) |
| `src/application/use-cases/return-copy.ts` | SPEC-002 (w1) → SPEC-007 (w2) |
| `src/application/use-cases/checkout-copy.ts` | SPEC-001 → SPEC-008 (w3) |

**Conflicts designed out rather than merged through.** Three collisions were
removed from the plan instead of being managed:

- SPEC-006 and SPEC-007 both wanted `return-copy.ts` — one to write a fine at
  return time, the other to fulfil a hold. Resolved by making fines *derived
  from loan data on demand and never written at return time*. That is a better
  design on its own merits (the number can never drift from the loans it came
  from, and a policy change re-prices history correctly) and it happens to leave
  the return path with a single writer.
- SPEC-003 wanted a `renewalCount` field on `Loan`, owned by SPEC-002 and read
  by both wave-2 siblings. Resolved by deriving the count from the invariant
  `dueAt = checkedOutAt + loan period + renewals × renewal period`, in a module
  SPEC-003 owns outright. The limitation is stated in the spec: a variable
  renewal period breaks the derivation and would need a real counter.
- SPEC-007 wanted its port in `repositories.ts`, which SPEC-003 and SPEC-006
  are already contending over. Resolved by giving holds their own port file, at
  the cost of one extra import in the container.

**Known deferred coupling.** "A loan cannot be renewed while another member is
waiting for the book" is a real rule that neither wave-2 spec may implement:
SPEC-003 owns `renew-loan.ts` and SPEC-007 owns the hold model, in the same
wave. SPEC-007 provides the predicate; wiring it into the renewal guard belongs
to a follow-up spec once both have merged. Both specs say so in their Out of
scope sections. Until then a renewal can jump the hold queue — accepted, not
overlooked.

**Known baseline gap.** Five test files listed in SPEC-001's `owns` are not in
the tree: unit tests for `loan.ts`, `member.ts` and `lending-policy.ts`, a use
case test for `checkout-copy.ts`, and an HTTP integration test for the checkout
route. `vitest.config.ts` holds `src/domain/**` to 100% coverage, so the gate
cannot be green until they land. **Close this before dispatching wave 1** — a
wave started from a red baseline makes every subsequent failure ambiguous.

## How to run a wave

Before dispatching anything:

```bash
npm run validate:specs      # ownership collisions and unmet dependencies
npm run gate                # the baseline must be green, and the tree clean
```

If the validator reports a collision, fix the *plan* — do not dispatch into it.
Dispatching into a broken plan wastes every agent at once.

Then send one `tdd-implementer` per spec, **all in a single message** so they run
concurrently. Each agent gets exactly this shape of brief:

```
Implement SPEC-004 from specs/SPEC-004-member-registration.md, under strict TDD.

You may create or modify only the paths in that spec's `owns` list.
Anything in `shared_contracts` is append-only — follow the rule stated
inline for each one, and touch nothing else in those files.

Do not edit another spec's files, another spec's tests, or specs/ itself.

`npm run gate` must be green before you report done. Report: the spec ID,
what you built, every shared_contract you appended to, and any ownership
conflict you had to work around.
```

Or, equivalently, `/wave 1`.

Merging:

1. Merge specs **one at a time**, running `npm run gate` after each. A gate run
   after three merges tells you something broke without telling you which spec
   broke it.
2. Expect textual conflicts in `errors.ts`, `problem.ts`, `container.ts` and
   `repositories.ts`. The resolution is almost always keep both sides. If you
   find yourself *choosing* between two changes, the wave was planned wrong —
   say so in the report.
3. Run `boundary-guardian` over the combined diff. Three individually clean
   changes can be collectively incoherent; three reasonable port methods can add
   up to a port that no longer describes one thing.
4. Run `test-critic` over the new tests.
5. Set each spec to `status: done` and update the table at the top of this file.
