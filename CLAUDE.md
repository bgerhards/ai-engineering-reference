# Engineering standards

A lending-library service, written as a reference for how this team builds software: test-first, hexagonally layered, specified in machine-checked specs, and shipped through a quality gate that nobody routes around.

These rules override default behaviour. When something here conflicts with what you would normally do, this wins.

## Definition of done

`npm run gate` is green. Not "my tests pass" — the gate: typecheck, lint, architecture, specs, test-discipline, tests, coverage.

## Test-first, always

Production code is written to make a failing test pass. In that order.

1. **Red** — one failing test for one behaviour. Run it. Read the failure. A test that has never failed proves nothing; if it passes before you write the code, your assertion is vacuous or the behaviour already exists. Find out which.
2. **Green** — the least code that passes. Hardcoding is legitimate here; the duplication is information about where the abstraction wants to live.
3. **Refactor** — now make it right, with the suite as your harness. Run everything after each step; revert anything that goes red rather than fixing forward.

One acceptance criterion at a time, red through refactor. Do not batch four criteria into one edit.

**Never edit a test to make failing code pass.** If a test is genuinely wrong, say so explicitly and explain why before you touch it.

Full detail: `.claude/skills/tdd-cycle/SKILL.md`.

## Architecture

```
domain  ←  application  ←  adapters  ←  composition
```

Imports point inward. Always. `npm run validate:arch` enforces it, and a PreToolUse hook blocks the edit before it lands.

| Layer | Holds | Never contains |
| --- | --- | --- |
| `src/domain` | Entities, value objects, business rules. Pure functions over immutable data. Imports within the domain are fine. | Any import from an outer layer, any `node:*` |
| `src/application` | Use cases and the ports they need. | Adapters, frameworks, HTTP, SQL |
| `src/adapters` | HTTP in, persistence/clock/uuid out. Translation only. | Business decisions |
| `src/composition` | Wiring. The only file naming concrete adapters. | Logic |

**Business rules live in `src/domain`.** If you are writing an `if` in a use case that encodes a policy — "more than five loans", "suspended members cannot" — you are writing it in the wrong layer. Move it. A use case orchestrates: parse, load through ports, *ask the domain to decide*, persist, return a plain view.

**Domain types do not escape.** Routes return views, never entities. The moment the wire format is the domain model, refactoring stops.

Full detail: `.claude/skills/hexagonal-architecture/SKILL.md`.

## Determinism

No `new Date()`, `Date.now()`, `Math.random()`, `process.env`, or I/O outside `src/adapters` and `src/main.ts`. Inject a port — `Clock`, `IdGenerator`. This is the single rule that keeps the test suite from flaking eighteen months from now, at which point nobody will be able to reproduce it.

## Errors

Domain failures are `Result<T, DomainError>` values, not exceptions. Exceptions are for bugs and infrastructure faults only.

Every failure mode is a member of the closed `ErrorCode` union in `src/domain/shared/errors.ts`. `problem.ts` maps each to an HTTP status through a `Record<ErrorCode, number>`, so adding a code without deciding its status is a compile error rather than a 500 in production. Keep it that way.

## Tests

| Kind | Location | Covers | Budget |
| --- | --- | --- | --- |
| Unit | `tests/unit/` | One domain module or use case, with in-memory adapters | < 5ms |
| Contract | `tests/contract/` | A port's promise, run against every adapter | < 100ms |
| Integration | `tests/integration/` | A real request through a real server | < 500ms |

- Name tests as statements of the guarantee, readable by someone who has not read the code. `it('refuses a withdrawn copy, and says so specifically')`, not `it('works')` and not `it('calls checkBorrowingAllowance')`.
- Arrange / act / assert, separated by blank lines. Push setup into `tests/support/builders.ts` so each test states only what makes it different.
- Assert on observable state, never solely on a spy. `expect(repo.save).toHaveBeenCalled()` proves a function ran, not that the system is correct — read the value back out instead.
- Cover every failure branch. For each, also assert what *did not* change; a use case that fails and leaves debris is the bug worth catching.
- Boundaries explicitly: zero, one, exactly at the limit, one past it, empty, duplicate.
- Prefer real objects, then in-memory adapters. Mock only what you cannot otherwise control — which here is almost never, because the answer is to inject a port.

Coverage: 90% globally, **100% on `src/domain`**. The domain is pure and fast; there is no honest excuse for an untested branch in it. If you are below, find the branch and either test it or delete the code nothing can reach.

## Specs and parallel work

Work is specified in `specs/`. Each spec declares `owns` — the files it may touch — and `npm run validate:specs` refuses to let two specs in the same wave claim the same path. Ownership is checked, not trusted.

When implementing a spec:

- Stay inside `owns`. If you genuinely need a file another spec owns, **stop and report the conflict** rather than editing it.
- `shared_contracts` are **append-only**. Add your line to the end; never reorder or reformat what is there. Two appends merge; a reformat does not.
- Read "Out of scope" and respect it.

`specs/README.md` holds the wave plan, the critical path, and the conflict register.

## Agents

| Agent | Use it for |
| --- | --- |
| `tdd-implementer` | Any change to `src/`. The default. |
| `spec-author` | Turning an idea into a validated spec. |
| `parallel-planner` | Working out what can safely run at once. |
| `boundary-guardian` | Reviewing structure before a merge. |
| `test-critic` | Auditing whether tests actually prove anything. |
| `refactor-surgeon` | Structure only, behaviour unchanged. |

Commands: `/spec-new`, `/spec-work`, `/wave`, `/tdd`, `/gate`, `/review`.

## Things not to do

- Lower a coverage threshold to fit a change.
- Add an `eslint-disable` to silence a layering rule. The rule is the architecture.
- Widen a type to `any`, or add `!`, to get past the type checker.
- Skip the gate because the change is small.
- Delete an acceptance criterion that turned out to be hard.
- Reformat a shared file while a parallel agent is working in it.

Each of these turns a loud failure into a quiet one. That is the only thing it achieves.

## Reporting

Say what you did, what you verified, and what you did not do. If a test fails, show the output. If you skipped something, name it. If you assumed something the spec left ambiguous, state the assumption. Do not report a gate as passing that you did not run.
