---
name: spec-driven-delivery
description: How work is specified in this repository — the machine-checked frontmatter schema, what makes an acceptance criterion executable, file-ownership declarations, and the spec lifecycle. Use when writing a spec, picking one up to implement, or deciding whether a spec is ready to hand to an agent.
---

# Specs

A spec is a contract between whoever wants the change and whoever builds it. In this repo the builder is usually an agent working alone, in parallel with several others, with no ability to ask a follow-up question. That constraint is what makes the format strict.

## Frontmatter

Parsed by `scripts/validate/specs.mjs` with a deliberately tiny parser. Three forms only: `key: scalar`, `key: []`, and block lists.

```yaml
---
id: SPEC-002
title: Return a borrowed copy
status: ready              # draft | ready | in-progress | done
wave: 1
depends_on:
  - SPEC-001
owns:
  - src/domain/lending/loan.ts
  - src/application/use-cases/return-copy.ts
  - tests/unit/application/return-copy.test.ts
shared_contracts:
  - src/domain/shared/errors.ts (append ErrorCode entries only; never reorder)
estimated_tests: 12
---
```

`owns` is the important one. It is the set of paths this spec may create or modify, and the validator refuses to let two specs in the same wave claim the same path. Ownership is checked, not trusted, because "I'll just quickly edit that other file" is how parallel work turns into an afternoon of merge conflicts.

`shared_contracts` covers the files everyone must touch — the error enum, the route list, the port interfaces. They are not owned; they are *appended to*, under a rule the spec states explicitly. Two agents appending different lines to the end of a list merge cleanly. Two agents reformatting it do not.

## Acceptance criteria

Each criterion is one behaviour, phrased so that a test name falls out of it. The test is: could someone who has not read the code tell whether this passed?

```
✗ - [ ] Handles errors gracefully
✗ - [ ] Returns work correctly
✗ - [ ] Good test coverage

✓ - [ ] Returning a loan sets `returnedAt` to the current instant and moves the copy to `available`
✓ - [ ] Returning an already-returned loan fails with `LOAN_ALREADY_CLOSED` and leaves the copy's status unchanged
✓ - [ ] Returning a withdrawn copy succeeds; the copy stays `withdrawn` rather than becoming `available`
```

Note what the good ones have in common: an observable outcome, a named error code, and a statement about what *did not* change. The last part is what catches use cases that fail halfway and leave debris.

Specify failure modes as carefully as the happy path. Cover boundaries explicitly — zero, one, exactly at the limit, one past it, empty, duplicate.

## What a spec does not contain

Function signatures, file contents, algorithms, or a step-by-step implementation plan. Those are the implementer's decisions, and a spec that makes them is a spec that will be wrong. Describe the behaviour and the invariants; let the person with the compiler in front of them design the code.

The exception is `owns` and `shared_contracts`, which are about coordination rather than design.

## Out of scope

Every spec carries one, naming the neighbouring work it deliberately excludes and the spec ID that covers it. This section prevents two failures at once: an agent gold-plating past its boundary, and a reviewer assuming something was missed.

## Lifecycle

`draft` → `ready` → `in-progress` → `done`.

Only a `ready` spec may be handed to an agent. Ready means: acceptance criteria are executable, `owns` is disjoint from its wave siblings, dependencies sit in earlier waves, and `npm run validate:specs` passes.

## Sizing

One spec is one vertical slice — a rule, its use case, its adapter surface, and its tests. Roughly 8–20 tests. Fewer than three acceptance criteria and it is probably part of something else. More than about 250 lines and it should be split.

The honest failure mode is oversized specs. They look efficient and then serialise everything, because a spec that owns fifteen files leaves nothing for anyone else to own.
