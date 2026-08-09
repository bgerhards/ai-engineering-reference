---
name: parallel-lanes
description: How to run several implementation agents at once without them colliding — wave planning, file-ownership rules, the append-only touchpoints, and how to resolve the conflicts that do happen. Use before dispatching a batch of agents, or when parallel work keeps producing merge conflicts.
---

# Running work in parallel

Two specs may run at the same time when both hold:

1. **Their `owns` sets are disjoint** — expanded against the real file tree, not compared as strings. `src/domain/lending/*.ts` and `src/domain/lending/loan.ts` look different and are not.
2. **Neither depends on the other, or on anything in the same wave** — dependencies must sit in a strictly earlier wave. A same-wave dependency is the classic mistake: it looks parallel and is not.

`npm run validate:specs` checks both mechanically. Run it before dispatching anything.

## Waves

A wave is a set of specs that can all run simultaneously. Waves run in order; everything in wave N merges before wave N+1 starts.

The current plan lives in `specs/README.md`. It is the source of truth, not this document.

Total elapsed time is set by the **critical path** — the longest dependency chain — not by how many agents you can afford. Six agents on a four-wave critical path is still four rounds. When a chain is long, the useful question is whether a dependency is real or just assumed.

## The touchpoints that actually cause conflicts

Ranked by how often they bite:

| File | Why everyone touches it | Rule |
| --- | --- | --- |
| `src/domain/shared/errors.ts` | Every spec adds a failure mode | Append `ErrorCode` entries at the end. Never reorder. |
| `src/adapters/inbound/http/problem.ts` | `Record<ErrorCode, number>` makes a new code a *compile error* until mapped | Append the mapping in the same order as the enum. Highest-risk file in the repo. |
| `src/composition/container.ts` | Every route must be registered | Append to the end of the route array. |
| `src/application/ports/repositories.ts` | New use cases want new repository methods | Append methods at the end of the interface, one per line. |
| `tests/support/builders.ts` | Everyone wants one more default | Append new builders; do not change existing defaults — other tests depend on them. |
| `package.json` | Scripts and dependencies | Prefer not to. If you must, say so in your report. |

The pattern is always the same: **append, never restructure.** Git merges two appends to different regions cleanly. It does not merge a reformat.

## When a conflict happens anyway

It will, occasionally — two agents appending adjacent lines to the same interface produce a textual conflict even though the intent is compatible. The resolution is almost always *keep both lines*. Then run `npm run gate`, because a syntactically clean merge of two semantically independent changes can still fail the type checker.

If you find yourself resolving a conflict by *choosing* between two changes rather than keeping both, the wave was planned wrong. Note it, and split the file next time.

## Dispatching a wave

For each spec in the wave, one `tdd-implementer` agent, told:

- the spec ID and file path
- that it must stay inside `owns`
- that `shared_contracts` are append-only, with the specific rule
- that it must run `npm run gate` before reporting done

Send them in a single message so they run concurrently.

## Merging a wave

1. Merge specs in the order they finished; run `npm run gate` after each, not just at the end. A gate run after five merges tells you something broke but not which one.
2. Run `boundary-guardian` over the combined diff. Individually clean changes can be collectively incoherent — three specs each adding a reasonable port method can leave a port that no longer describes one thing.
3. Update `status: done` in each spec, and refresh the wave table in `specs/README.md`.

## Choosing a wave size

Prefer a wave of three that genuinely cannot collide over a wave of six that probably will not. The cost of a conflict is not the merge — it is the review, the re-run, and the chance that the resolution is subtly wrong.
