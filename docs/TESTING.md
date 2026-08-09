# Testing

The suite is the reason changes here are cheap. This document says what each
kind of test is for, how the contract-test mechanism works, and what the
test-discipline validator rejects.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [WORKFLOW.md](WORKFLOW.md) ·
[ADR-0002](adr/0002-test-driven-development-with-a-quality-gate.md)

## The taxonomy

| Kind | Location | Covers | Real | Substituted | Budget |
| --- | --- | --- | --- | --- | --- |
| Unit | `tests/unit/` | One domain module, or one use case end to end | Every domain object; the in-memory repositories | `Clock` → `FixedClock`, `IdGenerator` → `SequentialIdGenerator`; no HTTP, no process | < 5 ms per test |
| Contract | `tests/contract/` | A port's behavioural promise, run once per adapter | The adapter under test, whatever it is | Nothing — that is the point | < 100 ms per test |
| Integration | `tests/integration/` | A real request through a real server to real adapters | `node:http`, the router, the container wiring | Usually the clock and id generator, so assertions stay exact | < 500 ms per test |

`tests/support/` holds no tests. `builders.ts` provides `aMember`, `aBookCopy`
and `aLoan`, each with a complete valid default so a test states only the field
it cares about. `fakes.ts` provides `FixedClock` (with `set` and `advanceDays`)
and `SequentialIdGenerator` (which yields `loan-1`, `loan-2`, …).

Run them separately while iterating:

```
npm run test:unit
npm run test:contract
npm run test:integration
npx vitest tests/unit/domain/loan.test.ts    # watch mode, one file
```

## Which test to write

Work down this list and stop at the first match.

1. **Is it a rule?** ("a suspended member may not borrow", "an ISBN checksum
   must match", "the due date is 21 days out") → a unit test in
   `tests/unit/domain/`, against a pure function. Most tests should land here.
2. **Is it about the order or completeness of steps?** ("a failed allowance
   check leaves the copy unchanged", "the id generator is called exactly once")
   → a unit test of the use case in `tests/unit/application/`, wiring the real
   in-memory repositories plus the fakes. Assert on state read back out of the
   repositories, not on spies.
3. **Is it a promise a port makes?** ("`findActiveByMember` never returns a
   returned loan", "`save` overwrites by id") → a suite in
   `tests/contract/`, so every present and future adapter is held to it.
4. **Is it about translation?** (status codes, `location` headers, malformed
   JSON, 405 vs 404) → a unit test of the adapter, or an integration test if it
   needs a real socket.
5. **Is it about the wiring?** ("`POST /loans` with a seeded member and copy
   returns 201 and a `location`") → one integration test. One or two per
   endpoint, not one per branch.

The counter-check from the tdd-cycle skill is worth repeating: *if you need an
integration test to check a business rule, the rule is in the wrong layer.*
Move it into `src/domain` and the test becomes a unit test.

## Contract tests

`vitest.config.ts` discovers only `tests/**/*.test.ts`, and explicitly excludes
`**/*.contract.ts`:

```ts
include: ['tests/**/*.test.ts'],
// `*.contract.ts` files export reusable suites; they are not tests themselves.
exclude: ['**/node_modules/**', '**/*.contract.ts'],
```

That exclusion is what makes the pattern work. A `*.contract.ts` file is a
*library*, not a test file: it exports a function that receives a factory for the
adapter under test and calls `describe`/`it` inside it. If vitest collected these
files directly it would try to run a suite with no adapter bound and fail; and
the shared assertions would be counted once for the suite plus once for every
adapter that imports it.

The shape, from `tests/contract/loan-repository.contract.ts`:

```ts
export const describeLoanRepositoryContract = (
  name: string,
  createRepository: () => Promise<LoanRepository> | LoanRepository,
): void => {
  describe(`${name} (LoanRepository contract)`, () => {
    it('treats save as an upsert, so saving the same loan twice stores one loan', async () => {
      const repository = await createRepository();
      /* ... */
    });
  });
};
```

And the whole of `tests/contract/in-memory-loan-repository.test.ts`, which *is*
collected:

```ts
import { InMemoryLoanRepository } from '@/adapters/outbound/memory/in-memory-repositories.js';
import { describeLoanRepositoryContract } from './loan-repository.contract.js';

describeLoanRepositoryContract('InMemoryLoanRepository', () => new InMemoryLoanRepository());
```

The factory returns `Promise<LoanRepository> | LoanRepository` so an adapter that
needs asynchronous setup — opening a database, running migrations — fits without
changing the suite. It is called inside each `it`, not once per file, so every
test starts from a fresh store.

The consequence worth being explicit about: **adding an adapter means writing
zero new assertions.** A SQLite `LoanRepository` gets a factory and one call.
Either it satisfies the promise the in-memory one already satisfies, or the
build goes red and names the behaviour that differs. The interface in
`src/application/ports/repositories.ts` is only a type signature; the contract
suite is the actual definition of the port. The comment in the binder file puts
it well: *if the SQLite adapter needs its own behavioural assertions, the promise
was never in the port to begin with.*

Two caveats, honestly stated:

- The contract suite must construct the adapter itself, so it depends on the
  adapter's constructor, not just the port. Keep the factory in the `*.test.ts`
  file, never in the `*.contract.ts`.
- `MemberRepository` has no `save` on the port; the in-memory adapter seeds
  through an `add` method that is not part of the interface. A contract suite
  for it has to take a seeding callback alongside the factory, or the port needs
  a write method. See
  [ARCHITECTURE.md](ARCHITECTURE.md#ports-and-adapters).

## The coverage policy

From `vitest.config.ts`:

| Scope | Lines | Functions | Branches | Statements |
| --- | --- | --- | --- | --- |
| Global | 90 | 90 | 88 | 90 |
| `src/domain/**/*.ts` | 100 | 100 | 100 | 100 |

Excluded from measurement entirely: `src/main.ts`, `src/composition/**`,
`src/application/ports/**`. These are wiring and type declarations; a coverage
number on them measures whether the process started, which the integration tests
already tell you.

(The global branch threshold is 88, not 90. `CLAUDE.md` and the quality-gate
skill both round it to "90% globally". The config is the truth.)

**Why the asymmetry is right.** It would be easy to read "100% here, 90% there"
as an arbitrary compromise. It is not:

- `src/domain` is pure. Every function is a total function of its arguments —
  no clock, no I/O, no `node:*`. Reaching any branch in it costs one line of
  test setup and runs in microseconds. There is no branch in there that is
  *expensive* to cover, so an uncovered branch means one of two things: a rule
  nobody has tested, or code nothing can reach. Both are defects, and both are
  fixed by the same instruction — test it or delete it.
- Every business rule lives in `src/domain` by construction (the architecture
  validator and the boundary-guardian agent both push them there). So 100% on
  the domain is 100% on the rules.
- The edges are different in kind. Covering the last branch of `server.ts` means
  simulating a socket error mid-body; covering the last branch of the router
  means constructing a request that cannot arrive. A percentage target there
  buys tests that exercise plumbing and assert nothing — the exact failure mode
  `test-discipline.mjs` exists to catch. The edges are defended by contract
  tests (every adapter meets the same promise) and integration tests (a real
  request works), which are statements about behaviour rather than about lines.

If `src/domain` drops below 100%, the fix is never to lower the threshold. Open
the coverage report, find the branch, and either write the test or delete the
unreachable code.

## Naming and structure

Name a test as a statement about the system, readable by someone who has not
opened the source. `it('<subject> <expected behaviour> <when condition>')`.

Real examples from this repository:

| Weak | Actual, from the suite | Why the real one is better |
| --- | --- | --- |
| `it('works')` | `it('refuses a withdrawn copy, and says so specifically')` — `tests/unit/domain/book-copy.test.ts` | Names the guarantee *and* the reason there are two distinct failure codes rather than one. |
| `it('calls parseIdentifier')` | `it('names MemberId as the offending brand')` — `tests/unit/domain/member.test.ts` | Describes what a caller observes, not which function was invoked. |
| `it('handles long ids')` | `it('accepts an identifier of exactly 64 characters')` + `it('rejects an identifier of 65 characters')` — `tests/unit/domain/identifier.test.ts` | Two tests, because a boundary is two facts. One test asserting "long ids are handled" cannot fail informatively. |
| `it('truncates')` | `it('truncates a partial day rather than rounding up')` — `tests/unit/domain/date.test.ts` | States the choice that was made, so a future change that rounds up fails with a message that explains itself. |

The validator warns on names under 15 characters and on names beginning with
"should". Both are warnings, not errors — they nudge without blocking.

**Arrange / act / assert, separated by blank lines.** From
`tests/unit/domain/book-copy.test.ts`:

```ts
it('returns a new object rather than mutating the original', () => {
  const original = aBookCopy({ status: CopyStatus.Available });

  markOnLoan(original);

  expect(original.status).toBe('available');
});
```

Note that the act line discards its return value — the assertion is about what
did *not* change. Asserting on what stayed the same is how you catch a use case
that fails halfway and leaves debris.

When the arrange block grows past a few lines, that is a design signal: push the
setup into `tests/support/builders.ts` so each test states only what makes it
different. `aMember({ standing: MemberStanding.Suspended })` reads as the
scenario; a six-field object literal does not.

Group with `describe` named after the unit under test. One assertion *concept*
per test — three `expect`s that all verify one outcome are fine (see
`isAvailable` in `book-copy.test.ts`, which checks all three statuses in one
test because they are one fact); three unrelated outcomes are three tests.

## What the test-discipline validator rejects

`scripts/validate/test-discipline.mjs`, run by `npm run validate:tests`, by the
gate, and by the Stop hook. Errors fail the build; warnings do not.

| Rule | What it catches | Why |
| --- | --- | --- |
| `assertion-free-test` (error) | An `it`/`test` body with no `expect(` in it | A test that asserts nothing passes forever — including after the code it exercises is deleted. It reports confidence it does not have, which is worse than having no test at all. Variants that legitimately have no body (`.todo`, `.each`, `.failing`, `.skip`, `.concurrent.each`) are exempt. |
| `focused-test` (error) | Any `.only(` | A single `.only` silently disables every other test in the run. The suite goes green in seconds and means nothing. This is the highest-damage, lowest-effort mistake in the list. |
| `unexplained-skip` (error) | `describe.skip` / `it.skip` / `test.skip` without a `// SKIP-REASON:` comment on the same line or the preceding non-blank line | Skips are occasionally legitimate. Unexplained ones become permanent, because nobody can tell whether the reason still applies. The comment must say why, and what un-skips it. |
| `unit-touches-infrastructure` (error) | A file under `tests/unit/` importing an **impure** module under `src/adapters/` | A unit test wired to real infrastructure is slow and flaky, and stops being a statement about the domain. See the note below — the rule is about purity, not directories. |
| `orphan-module` (error) | A module under `src/domain/` or `src/application/use-cases/` with a runtime export that no test imports | A rule with no test is a rule nobody is defending. This catches the module that coverage thresholds would also catch, but names the file directly instead of reporting a percentage. |
| `terse-name` (warning) | A test name under 15 characters | `it('works')` tells a future reader nothing when it goes red. |
| `should-name` (warning) | A name starting with "should" | House style: name the guarantee as a fact about the system, not a wish about it. |

**On `unit-touches-infrastructure`.** The obvious implementation — "no unit test
may import `src/adapters/`" — is wrong, and the validator says so in its own
comments. `src/adapters/inbound/http/problem.ts` and `router.ts` live under
`adapters/` because they speak HTTP, but they are pure functions over plain
data; `tests/unit/adapters/problem.test.ts` and `router.test.ts` are fast,
deterministic, and exactly where those tests belong.

So impurity is derived from the module rather than from a directory list. A
module is impure if it — or anything it transitively imports — matches one of:
an `import` from `node:*`, `new Date()`, `Date.now()`, `Math.random()`, or
`process.env`. That stays correct as files are added and it fails closed:
`server.ts` (`node:http`), `system-clock.ts` (`new Date()`) and
`random-id-generator.ts` (`node:crypto`) are all still rejected, and so is
anything that imports them. `src/adapters/outbound/memory/` is exempted outright,
because the in-memory adapters *are* the test doubles. The error message names
the reason, not just the file: *"imports 'src/adapters/inbound/http/server.ts',
which is not safe in a unit test because it imports a node: builtin."*

The related PostToolUse hook, `.claude/hooks/tdd-nudge.mjs`, fires the moment a
file under `src/` is written and no test imports it. It is a nudge, not a gate —
it cannot know whether the test came first, only whether one exists.

## Mutation thinking

Coverage says which lines ran. It does not say whether anything was verified.
The gap between those two numbers is where bugs live, and the cheapest way to
probe it is a question you ask of every test you write:

> **What single-character change to the source would this test fail to catch?**

Concretely, try these mutations in your head against the test you just wrote:

- Flip a comparison: `>=` → `>`, `<` → `<=`. In
  `checkBorrowingAllowance`, `activeLoans.length >= policy.maxActiveLoans`
  becomes `>`. A test that only checks six loans are refused survives it. The
  test that kills it checks *exactly five* — the boundary, not a value past it.
- Swap two arguments. `addDays(from, days)` and `isBefore(left, right)` are both
  vulnerable. `daysBetween` has a test asserting the result is *negative* when
  the second instant is earlier; that one kills the swap.
- Return the input unchanged. `markOnLoan` returning `copy` instead of
  `{ ...copy, status: 'on-loan' }` survives any test that only checks
  `result.ok`. The test asserting `result.value.status` is `'on-loan'` kills it.
- Delete a guard clause. Remove the `CopyStatus.Withdrawn` branch from
  `markOnLoan` and a withdrawn copy quietly becomes lendable. Only a test that
  asserts the *specific* code `COPY_WITHDRAWN` — not merely that it failed —
  catches this, because the `OnLoan` branch would still reject some cases.
- Weaken a regex. Drop `{0,63}` from `IDENTIFIER_PATTERN` and identifiers become
  unbounded. The `it('rejects an identifier of 65 characters')` test is the only
  thing standing there.
- Remove a `.trim()`. `parseIdentifier` trims before validating; the test that
  asserts `'  member-1  '` parses to `'member-1'` is what makes that behaviour
  real rather than incidental.

If you can name a mutation that survives, you have found a hole — write the test
that closes it. Where it is cheap, actually perform the mutation, run the suite,
and check it goes red. An empirically surviving mutant is a finding; a suspected
one is only a hypothesis.

The `test-critic` agent (`.claude/agents/test-critic.md`) does this
systematically. Reach for it when coverage is high but confidence is not.
