---
name: tdd-cycle
description: The red-green-refactor loop as practised in this repository, including what counts as a valid failing test, how to name tests, when to mock (rarely), and the test taxonomy. Use whenever writing or changing code in src/, reviewing a test suite, or deciding what kind of test a behaviour needs.
---

# The TDD cycle

## Red

Write one failing test for one behaviour. Run it. **Read the failure message.**

A test that has never failed proves nothing — it might be asserting a tautology, or exercising code that was already there. Watching it fail is what makes it a test rather than a hopeful comment.

The failure you get tells you something:

| Failure | Meaning |
| --- | --- |
| Assertion failure with the value you expected to be wrong | Correct red. Proceed. |
| `ReferenceError` / `is not a function` | Fine for the very first test of a new module; you are designing the API by using it. |
| Passes immediately | The behaviour already exists, or your assertion is vacuous. Investigate before writing any code. |
| A *different* test also went red | You have discovered a coupling. Understand it before continuing. |

## Green

Write the least code that passes. Hardcoding a return value is legitimate at this stage — it is how you find out whether the next test actually constrains anything. Duplication introduced here is information about where the abstraction wants to be.

Do not write code for a criterion you have not yet written a test for. That code is unverified by construction.

## Refactor

Now make it good, with the suite as your harness. Extract the concept the duplication revealed. Move policy decisions down into `src/domain`. Rename toward the language a librarian would use. Run the full suite after every step, and revert anything that goes red rather than fixing forward.

The refactor step is not optional. Skipping it is how a codebase accumulates the "green but awful" layer that eventually makes every change expensive.

## Test taxonomy

| Kind | Location | Covers | Collaborators | Budget |
| --- | --- | --- | --- | --- |
| Unit | `tests/unit/` | One domain module or use case | Real domain objects; in-memory adapters | < 5ms |
| Contract | `tests/contract/` | A port's behavioural promise, run against *every* adapter | The real adapter | < 100ms |
| Integration | `tests/integration/` | A real request through a real server to real adapters | Everything, wired | < 500ms |

Most tests should be unit tests of the domain, because that is where the rules are and they are free to run. If you find yourself needing an integration test to check a business rule, the rule is in the wrong layer.

## Naming

`it('<subject> <expected behaviour> <when condition>')`, phrased as a statement about the system, readable by someone who has not read the code.

```
✓ it('refuses a withdrawn copy, and says so specifically')
✓ it('rejects an identifier of 65 characters')
✗ it('works')
✗ it('calls checkBorrowingAllowance')          // describes the code, not the guarantee
✗ it('test checkout 2')
```

Group with `describe` blocks named after the unit under test. One assertion *concept* per test — three `expect`s that all verify one outcome are fine; three unrelated outcomes are three tests.

## Arrange, act, assert

Separate the three with blank lines. When the arrange block grows past a few lines, that is a design signal: extract a builder into `tests/support/builders.ts` so the test states only what makes it different.

```ts
it('refuses a member who is already at the loan limit', async () => {
  const member = aMember();
  members.add(member);
  copies.add(aBookCopy());
  for (let i = 0; i < 5; i += 1) loans.save(aLoan({ id: `loan-${i}` as LoanId }));

  const result = await checkoutCopy({ memberId: member.id, copyId: 'copy-1' });

  expect(result.ok).toBe(false);
  expect(!result.ok && result.error.code).toBe('LOAN_LIMIT_REACHED');
});
```

## On mocking

Prefer real objects. Then in-memory adapters. Mock only what you cannot otherwise control — and in this repo, the answer is almost always "inject a port instead".

Never assert that a mock was called as your *only* assertion. `expect(repo.save).toHaveBeenCalled()` tells you the code called a function; it tells you nothing about whether the system now holds the right state. Assert on the observable outcome: read the value back out of the in-memory repository.

## Fixing a bug

1. Write the failing test that reproduces it. This is the deliverable — without it you cannot know you fixed anything, and nothing stops it returning.
2. Fix it.
3. Ask what class of bug it belongs to, and whether a sibling test should exist.
