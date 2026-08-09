---
name: quality-gate
description: The definition of done in this repository — every check `npm run gate` runs, what each one catches, how to iterate on one step in isolation, and which failures must never be worked around. Use before declaring any change complete, or when a gate step fails and you need to understand why it exists.
---

# The gate

```
npm run gate          # everything, including coverage
npm run gate:quick    # skips coverage; runs the tests
npm run gate -- --only=architecture
```

Done means the gate is green. Not "the tests I wrote pass" — the gate.

## The steps

| Step | Command | What it catches |
| --- | --- | --- |
| typecheck | `tsc --noEmit` | Strict-mode violations, unchecked index access, exact-optional mismatches |
| lint | `eslint .` | Complexity over 10, functions over 60 lines, layering violations, `console`, non-`===` comparison |
| architecture | `validate/architecture.mjs` | Inward imports, `node:*` in the domain, `new Date()` outside adapters |
| specs | `validate/specs.mjs` | Broken frontmatter, dependency cycles, **two specs in one wave claiming the same file** |
| test-discipline | `validate/test-discipline.mjs` | Assertion-free tests, stray `.only`, unexplained `.skip`, unit tests reaching real adapters, untested modules |
| tests | `vitest run --coverage` | Behaviour, plus the coverage thresholds |

The Stop hook does **not** run the gate. It runs the three dependency-free validators (architecture, test-discipline, specs) directly, because a Stop hook that takes forty seconds trains people to disable it. The gate remains yours to run.

## Coverage

90% globally; **100% on `src/domain`**.

The asymmetry is deliberate rather than dogmatic. The domain is pure, has no I/O, runs in microseconds, and is where every business rule lives — there is no honest excuse for an untested branch in it. The edges are thinner and are covered by contract and integration tests instead, where a percentage target would just encourage tests that exercise plumbing without asserting anything.

If `src/domain` is below 100%, you have an untested branch. Find it in the coverage report and either write the test that reaches it or delete the code that nothing can reach. Both outcomes are improvements.

## Iterating

Do not run the whole gate on every keystroke. Run the narrowest thing that answers your current question:

```
npx vitest tests/unit/domain/loan.test.ts   # watch mode, one file
npm run typecheck
npm run validate:arch
```

Run the full gate before you report done.

## Failures you must not work around

- **Lowering a coverage threshold** to make a change fit. The threshold is a statement about what the team believes; edit it in a change of its own, with a reason.
- **Adding an eslint-disable** to silence a layering rule. The rule is the architecture. If it is wrong, change the architecture deliberately and write an ADR.
- **Editing a test so failing code passes.** If a test is genuinely wrong, say so explicitly and explain why before touching it.
- **Deleting a spec's acceptance criterion** because it turned out to be hard.
- **`--no-verify`**, or skipping the gate because "it's a small change".

Each of these converts a loud failure into a quiet one. That is the only thing they accomplish.

## When the gate is wrong

Sometimes it is. A validator false-positives, or a threshold no longer matches reality. That is a legitimate finding — report it plainly, propose the fix to the validator, and change it as its own reviewed change. What is not legitimate is routing around it in the same commit as the feature, where nobody will see it.
