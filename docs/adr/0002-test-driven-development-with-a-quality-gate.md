# ADR-0002: Test-driven development with a quality gate

**Status:** Accepted, 2026-08-08

Related: [TESTING.md](../TESTING.md) for the practice ·
[WORKFLOW.md](../WORKFLOW.md#the-quality-gate) for the gate's steps ·
[ADR-0001](0001-hexagonal-architecture.md) ·
[ADR-0003](0003-specs-as-the-unit-of-parallel-work.md)

## Context

Most of the production code here is written by agents. That changes the economics
of testing in two directions at once.

It gets cheaper: an agent will write the twelve boundary tests nobody has the
patience for, and will not get bored on the eleventh. It also gets more
dangerous: an agent optimises for the signal it is given. If the signal is "the
tests pass", it will produce code where the tests pass — and the shortest path
to that state is sometimes to weaken the test. An agent that writes the
implementation first and the test afterwards writes a test that describes what
the code does, which is a tautology with good coverage numbers.

Meanwhile "done" needs a definition that does not depend on who is asking.
Without one, each agent reports done against its own standard: one ran the unit
tests, another ran typecheck, a third ran nothing and inferred success from the
absence of errors in its own edits. Reports become uncomparable, and the person
merging six of them has to re-verify all six from scratch.

We also need a fast, honest answer to "is the repository currently sound?" — for
the `Stop` hook, for the start of a wave, and after each merge within one.

## Decision

**Production code is written to make a failing test pass, in that order.**
Red → green → refactor, one acceptance criterion at a time, as specified in
`.claude/skills/tdd-cycle/SKILL.md` and required by `CLAUDE.md`. Watching the
test fail — and reading the failure message — is treated as part of the cycle,
not a formality: a test that has never failed might be asserting a tautology or
exercising code that already existed.

**Three kinds of test, with distinct jobs.** Unit (`tests/unit/`, < 5 ms),
contract (`tests/contract/`, < 100 ms, one suite run against every adapter),
integration (`tests/integration/`, < 500 ms). Most tests are unit tests of the
domain, because that is where the rules are and they are free to run. Details in
[TESTING.md](../TESTING.md).

**"Done" means `npm run gate` is green.** Six steps in
`scripts/validate/gate.mjs`, ordered cheapest and most specific first:
typecheck, lint, architecture, specs, test-discipline, tests-with-coverage.
Every step runs even after an earlier one fails, so one run reports everything
that is wrong. Each failure prints a specific next action.

**Coverage is 90% globally and 100% on `src/domain`.** The asymmetry is the
point. The domain is pure, has no I/O, and runs in microseconds; there is no
branch in it that is expensive to cover, so an uncovered branch means an untested
rule or unreachable code, and both are fixed by the same instruction. The edges
are defended by contract and integration tests instead, where a percentage target
would buy tests that exercise plumbing and assert nothing.

**Test discipline is itself validated.** `scripts/validate/test-discipline.mjs`
fails the build on `.only`, an unexplained `.skip`, an assertion-free test, a
unit test importing real infrastructure, or a module under `src/domain` /
`src/application/use-cases` that no test imports. These are the failures that
keep the badge green while cutting strands of the net, which makes them more
dangerous than an honest red build.

**Certain workarounds are prohibited outright**, in `CLAUDE.md`, in the
`quality-gate` skill, and in every agent prompt: lowering a threshold to fit a
change, `eslint-disable` on a layering rule, editing a test so failing code
passes, deleting an acceptance criterion that turned out to be hard. If the gate
is genuinely wrong, that is a legitimate finding — fixed as its own reviewed
change, never inside the feature that tripped it.

## Consequences

### Good

- "Done" is a fact. Six agents reporting done have all cleared the same bar, and
  the person merging does not have to re-derive what each of them checked.
- Refactoring is cheap and therefore actually happens. The `refactor-surgeon`
  agent's entire protocol — one change, run the suite, revert on red — is only
  viable because the suite is fast and trustworthy.
- Test-first forces design pressure at the right moment. Writing the test for
  `checkBorrowingAllowance` before the code is what surfaces that it needs a
  `now`, which is what produces the `Clock` port rather than a `new Date()` buried
  in a use case.
- 100% on the domain has caught real gaps: it is why `daysBetween` has a test for
  the negative case and `parseIdentifier` has tests at exactly 64 and exactly 65
  characters. Those are the branches a percentage target below 100 would have
  quietly permitted to go untested.
- The `Stop` hook can give a fast, honest verdict — it runs the three
  dependency-free validators in well under a second — without the 40-second full
  gate that would train everyone to disable it.

### Bad

- **Test-first ordering is not mechanically verifiable.** Nothing here can prove
  a test was written before the code it covers.
  `.claude/hooks/tdd-nudge.mjs` says so in its own header comment: it checks
  whether a test exists, not whether it came first. The discipline is real; the
  enforcement is partial, and pretending otherwise would be worse than admitting
  it.
- **"Assertion was weakened" has no validator.** `test-discipline.mjs` catches
  crude sabotage — a deleted `expect`, an added `.skip` — but a
  `toEqual` narrowed to `toBeTruthy` sails through. This is the single biggest
  hole in the scheme, and the only defence is a human reading the test diff in
  any change where tests and source moved together. The `test-critic` agent
  reduces the load but does not close it.
- **100% invites coverage-driven tests.** A branch that is hard to reach can be
  covered by a test that reaches it and asserts nothing meaningful, satisfying
  the threshold while proving nothing. The rule "test it or delete it" is meant
  to push toward deletion in those cases, but the pressure runs the other way.
- **The gate is slow enough to be skipped under pressure.** It runs six steps
  including a coverage build. `gate:quick` exists for iteration and `--only=` for
  a single step, but the honest position is that a gate people run less often is
  a gate that catches less.
- **A prohibition list is not enforcement.** "Never lower a threshold" is a rule
  in a markdown file. An agent can edit `vitest.config.ts`. What actually
  protects it is that the change is visible in the diff — so the list is really
  an instruction to reviewers about what to look for.
- **Contract tests couple to adapter constructors.** A contract suite has to
  build the adapter it tests, so it knows more than the port does. Keeping the
  factory in the `*.test.ts` file limits the damage but does not eliminate it.

## Alternatives considered

**Tests written after the implementation.** Rejected on a specific mechanism, not
on principle: a test written after the code describes what the code does. It
passes on the first run, which means it has never demonstrated it can fail, which
means it might be asserting a tautology and nobody would know. For agent-written
code this is close to the default failure mode, because the model has the
implementation in context while writing the test. Test-first is the only cheap
protection against it.

**A single global coverage threshold.** Rejected because any single number is
wrong in both directions at once. Set it at 90 and the domain — where every rule
lives and where coverage is nearly free — is permitted a tenth of its branches
untested. Set it at 100 and `server.ts` needs a test that simulates a socket
failing mid-body, which is a test nobody will maintain and everybody will
eventually delete along with the threshold. Two numbers, matched to two very
different kinds of code, is the honest configuration.

**No coverage thresholds; rely on review.** Rejected because coverage is the only
part of the scheme that catches the *absent* test. Review catches a bad test;
nothing catches a test that was never written except a number that notices the
lines nobody executed. The `orphan-module` rule in `test-discipline.mjs` is the
same idea at file granularity, and it exists because it names the file instead of
reporting a percentage.

**Mutation testing (Stryker or equivalent) instead of coverage.** This is
strictly the better measurement — it answers "was anything verified?" rather than
"did this line run?". Rejected as a *gate step* on cost: mutation runs take
minutes to hours, which is incompatible with a gate that runs on every change and
with a `Stop` hook that must be sub-second. It also contradicts the repository's
zero-dependency constraint. Instead, mutation *thinking* is adopted as a
practice: the `test-critic` agent asks "what single-character change would this
test miss?" and performs the cheap mutations by hand, and
[TESTING.md](../TESTING.md#mutation-thinking) gives the checklist. This is
weaker than the tool and we know it.

**Per-package or per-file thresholds tuned to current reality.** Rejected because
thresholds set to whatever happens to be true today encode no intent, and get
re-tuned downward each time they are inconvenient — which is the ratchet running
backwards. Two thresholds that mean something ("the rules are fully tested"; "the
edges are mostly tested") are defensible in a way that forty numbers are not.

**Trusting agent self-reports.** Rejected after observing the obvious: an agent
that has not run the gate will still report success, because from inside its own
context the work looks finished. `tdd-implementer.md` says "do not claim a gate
passed that you did not run", and the `Stop` hook exists because that instruction
alone is not sufficient.
