---
description: Run the full quality gate and fix whatever it reports
allowed-tools: Bash(npm run gate), Bash(npm run gate:quick), Bash(npm run validate:*), Bash(npm run test:*), Bash(npm run lint), Bash(npm run typecheck), Read, Edit, Grep, Glob
---

Run `npm run gate` and drive it to green.

For each failure, fix the cause rather than the symptom:

- **typecheck** — fix the type, do not widen it to `any` or add a non-null assertion to make the error go away.
- **lint** — a complexity or length violation is telling you the function has more than one job. Split it. Do not add an `eslint-disable`.
- **architecture** — a layering violation means the code is in the wrong file. Move it; define a port if it needs something from further out.
- **specs** — an ownership collision or dependency cycle is a planning error. Fix the plan, not the validator.
- **test-discipline** — an assertion-free test is worse than no test, because it reports confidence it does not have.
- **tests / coverage** — a failing test means the behaviour is wrong or the test is. Work out which before touching either. Below-threshold coverage on `src/domain` means an untested branch; find it and either test it or delete the unreachable code.

Never lower a threshold, disable a rule, or edit a test to make failing code pass in order to get through the gate. If a gate step is genuinely wrong, say so, propose the fix to the validator, and leave it as separate work — do not bury it in this change.

Report the final gate output verbatim and a one-line summary of each fix you made.
