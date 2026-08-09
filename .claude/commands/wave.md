---
description: Run every spec in the next (or a named) wave in parallel, then merge and verify
argument-hint: [wave number]
---

Run a full wave of parallel implementation. Wave: **$ARGUMENTS** (if empty, use the lowest wave containing specs that are not `done`).

## Before dispatching

1. Read `specs/README.md` and every spec in the target wave.
2. Run `npm run validate:specs`. If it reports an ownership collision or an unmet dependency, **stop** and fix the plan first — use the `parallel-planner` agent. Dispatching into a broken plan wastes every agent at once.
3. Confirm every `depends_on` across the wave is `status: done`.
4. Confirm the working tree is clean and `npm run gate` is currently green. Starting a wave from a red baseline makes every failure ambiguous.

## Dispatch

Send one `tdd-implementer` per spec, **all in a single message** so they run concurrently. Each gets:

- its spec file path and id
- its `owns` list, with the instruction not to modify anything outside it
- its `shared_contracts` and the exact append-only rule for each
- the reminder that `npm run gate` must be green before it reports done

## Merge

Merge them one at a time, running `npm run gate` after each — not once at the end, or you will know something broke without knowing which spec broke it.

Expect textual conflicts in the append-only touchpoints (`errors.ts`, `problem.ts`, `container.ts`, `ports/repositories.ts`). The resolution is almost always to keep both sides. If you find yourself *choosing* between two changes rather than keeping both, the wave was planned wrong — say so.

## After

1. Run `boundary-guardian` over the combined diff. Individually clean changes can be collectively incoherent.
2. Run `test-critic` over the new tests.
3. Set each completed spec to `status: done` and refresh the wave table in `specs/README.md`.
4. Report: what landed, what the gate says, every conflict you resolved and how, and anything that should change about the next wave's plan.
