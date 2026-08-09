---
id: SPEC-TEMPLATE
title: One sentence, in the language a librarian would use
status: draft
wave: 0
depends_on: []
owns:
  - src/domain/<context>/<thing>.ts
  - src/application/use-cases/<verb-the-noun>.ts
  - tests/unit/domain/<thing>.test.ts
shared_contracts:
  - src/domain/shared/errors.ts (append new ErrorCode entries at the end only; never reorder)
estimated_tests: 12
---

<!--
FRONTMATTER RULES — a validator parses this block, so keep it boring.

Delimited by `---` on its own line, top of file. Three forms are parseable and
no others:

    key: scalar
    key: []
    key:
      - item
      - item

No inline arrays (`[a, b]`), no nested maps, no quotes needed, no comments
inside the block.

  id                 Must equal the filename prefix, and be unique across specs/.
  title              Sentence case. What a user gets, not what a module is called.
  status             draft | ready | in-progress | done. Only `ready` may be dispatched.
  wave               Non-negative integer. Everything in wave N merges before N+1 starts.
  depends_on         Spec IDs whose merged output this needs. Each must exist and sit
                     in a STRICTLY earlier wave. Prefer zero. Three is a smell.
  owns               Non-empty. Every path this spec may create or modify. No two specs
                     in the same wave may claim the same path — the validator refuses it.
  shared_contracts   Paths this spec must touch but does not own, each with its
                     append-only rule stated inline in parentheses.
  estimated_tests    Rough count. 8–20 is a healthy slice; far outside that, resize.
-->

# SPEC-00N — Title

## Context

Two to four sentences. Why this exists and what a person is actually trying to
do when they reach for it. Name the operational problem, not the technical one:
"a librarian scans a returned book and needs it back on the shelf" beats "the
loan aggregate requires a state transition".

## Behaviour

The rules, in prose, in domain language. Name the invariants — the statements
that must be true before and after, whatever the code looks like.

Say which layer owns which decision when it is not obvious (a rule belongs in
`src/domain`; orchestration in `src/application`; translation in
`src/adapters`). Do **not** prescribe function signatures, module layout beyond
the `owns` list, data structures, or algorithms. The implementer has the
compiler in front of them and will design better than you can from here.

State the failure modes here too, with the error code each one produces, and
what state the system is left in when they fire.

## Acceptance criteria

Each line is one behaviour, phrased so a test name falls out of it. The test for
a criterion: **could someone who has not read the code tell whether it passed?**

A good criterion names an observable outcome, the exact error code where it
fails, and — for failures — what did *not* change. That last part is what
catches a use case that fails halfway and leaves debris behind.

    ✗ - [ ] Handles errors gracefully
    ✗ - [ ] Returns work correctly
    ✗ - [ ] Reasonable validation on the input

    ✓ - [ ] Returning a loan sets `returnedAt` to the clock's instant and moves the copy to `available`
    ✓ - [ ] Returning an already-closed loan fails with `LOAN_ALREADY_CLOSED` and leaves the copy's status unchanged
    ✓ - [ ] A page beyond the last result returns an empty list with the unchanged total and HTTP 200

Cover the boundaries explicitly: zero, one, exactly at the limit, one past it,
empty, duplicate, and the value that is valid but ugly. At least three criteria,
or this is part of another spec.

- [ ] First behaviour, with its observable outcome
- [ ] Second behaviour, with its error code and what stayed unchanged
- [ ] The boundary case, stated as a number

## Out of scope

What this deliberately does not do, each with the spec ID that covers it where
one exists. This section stops an agent gold-plating past its boundary and stops
a reviewer assuming something was forgotten.

- Neighbouring behaviour X — SPEC-00M.
- Neighbouring behaviour Y — no spec yet; deliberately deferred because <reason>.

## Notes for the implementer

- File ownership: what in `owns` already exists and is being taken over, and
  what is new.
- The append-only rule for every `shared_contracts` entry: exactly what may be
  added and what must not be altered.
- Any non-obvious design constraint — a decision forced by another spec's
  ownership, a shape that must stay compatible with an existing test builder, a
  deliberate rejection of an obvious-looking approach and why.
- Anything the quality gate will fail on if it is missed.
