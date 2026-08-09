# ADR-0003: Specs as the unit of parallel work

**Status:** Accepted, 2026-08-08

Related: [WORKFLOW.md](../WORKFLOW.md#running-a-wave-in-parallel) for the
procedure · [ADR-0001](0001-hexagonal-architecture.md) for the layering this
splits work across · [ADR-0002](0002-test-driven-development-with-a-quality-gate.md)
for the gate every spec must clear.

## Context

Several agents can work at once. The constraint is not how many you can afford
to run — it is that they cannot see each other. Each has its own context window,
its own view of the file tree at the moment it started, and no way to ask a
colleague "are you in `errors.ts` right now?". Coordination that depends on
noticing what someone else is doing is unavailable.

That rules out the mechanisms human teams rely on. There is no standup, no
"shout if you're touching that file", no pull-request queue that serialises
contention naturally. Two agents will happily rewrite the same function in
opposite directions, each producing a locally correct, gate-passing change, and
neither will mention it, because from inside either context nothing went wrong.

The cost lands at merge time and it is worse than a normal merge conflict.
A textual conflict you can see. What you get here is two changes that merge
cleanly and are semantically incompatible — a route registered twice, a port
method added with two different signatures, an `ErrorCode` renamed by one agent
while another mapped the old name. The failure surfaces at typecheck if you are
lucky, and in behaviour if you are not.

We also cannot parallelise everything regardless. Holds (SPEC-007) must have
returns (SPEC-002) to hook into. Persistence (SPEC-008) must have every port
that will exist. Pretending otherwise produces agents that fail on missing
imports and then invent the missing module.

## Decision

**The unit of parallel work is a spec, and a spec declares the files it owns.**

Every file in `specs/` carries frontmatter parsed by
`scripts/validate/specs.mjs`:

```yaml
id: SPEC-004
title: Register a member, suspend and reinstate them
status: ready              # draft | ready | in-progress | done
wave: 1
depends_on:
  - SPEC-001
owns:
  - src/domain/lending/member.ts
  - src/application/use-cases/register-member.ts
  - tests/unit/application/register-member.test.ts
shared_contracts:
  - src/application/ports/repositories.ts (append save to MemberRepository; do not change existing method signatures)
estimated_tests: 18
```

Three claims, in decreasing order of how novel they are:

**1. Ownership is machine-checked, not trusted.** `validate:specs` expands every
`owns` glob and refuses to let two specs in the same wave claim intersecting
paths. The intersection test is deliberately conservative — each pattern is
converted both to a regex and to a sample path, and tested in both directions —
so `src/domain/lending/*.ts` and `src/domain/lending/loan.ts` are correctly
reported as colliding despite being different strings. A false positive costs a
re-split; a false negative costs an afternoon.

This is the load-bearing decision. A convention that two specs should not touch
the same file is worth nothing, because the moment it is violated is the moment
nobody is looking. A check that runs in the gate, before dispatch, and in the
`Stop` hook is worth something.

**2. Waves exist because dependencies are real.** A wave is a set of specs that
can all run at once. Everything in wave *N* merges and the gate goes green before
wave *N+1* starts. `depends_on` must point at a spec in a **strictly earlier**
wave; the validator rejects a same-wave dependency, which is the classic mistake
because it looks parallel and is not.

The current shape: wave 0 is SPEC-001 (the bootstrap); wave 1 is returns,
members and catalogue search; wave 2 is renewals, fines and holds; wave 3 is
SQLite. The critical path is 001 → 002 → {003, 006, 007} → 008 — **four waves,
regardless of how many agents you run.** Elapsed time is set by the longest
dependency chain, not by fan-out, which makes "is this dependency real or merely
assumed?" the highest-value question in planning.

**3. Files everyone must touch are not owned — they are append-only.**
`shared_contracts` lists them with an explicit rule per entry. The rules in the
real specs are specific to the point of being fussy:
`src/adapters/outbound/memory/in-memory-repositories.ts (implement the new
method on InMemoryLoanRepository only)`. The pattern is always the same: **append,
never restructure.** Git merges two appends to different regions of a file
cleanly; it does not merge a reformat.

The ranked list of files that actually cause trouble lives in
`.claude/skills/parallel-lanes/SKILL.md`. Two deserve mention here.
`src/domain/shared/errors.ts` is touched by nearly every spec, because every
spec adds a failure mode. `src/adapters/inbound/http/problem.ts` is the highest
risk, because `Record<ErrorCode, number>` turns a new code into a *compile
error* until it is mapped — which is a feature, and also means two specs will
append adjacent lines to the same object literal in the same wave.

**Supporting rules.** A spec is one vertical slice — a rule, its use case, its
adapter surface, its tests; roughly 8–20 tests. Acceptance criteria must be
executable: an observable outcome, the exact error code on failure, and a
statement about what did *not* change. Every spec carries an `## Out of scope`
section naming the neighbouring work it excludes. Only a `ready` spec may be
dispatched. The validator enforces the schema, the id/filename match, the
minimum of three acceptance criteria, the presence of "Out of scope", dependency
existence, and the absence of cycles.

## Consequences

### Good

- A wave can be dispatched in one message with a mechanical guarantee the agents
  will not collide on ownership. That is a much stronger statement than "we
  looked at it and it seemed fine".
- The conflicts that do happen are the *expected* ones, in known files, with a
  known resolution: keep both sides, then re-run the gate. Nobody has to
  reconstruct what two agents intended.
- The type system participates. Two specs each appending an `ErrorCode` and only
  one appending a status mapping fails typecheck immediately, at merge, by
  design.
- A spec is a real contract. An implementing agent with no ability to ask a
  follow-up question can work from it alone, which is precisely the constraint
  that forced the format to be strict.
- `## Out of scope` prevents two failures at once: an agent gold-plating past its
  boundary, and a reviewer assuming something was forgotten.
- Ownership can hand over between waves. SPEC-002 owns
  `src/application/use-cases/return-copy.ts` in wave 1; SPEC-007 owns the same
  file in wave 2 to add hold fulfilment. One owner at a time, checked per wave.

### Bad

- **Writing a good spec takes real thought, and it is not optional.** The
  acceptance criteria have to be executable, the failure modes enumerated with
  their error codes, the boundaries stated as numbers, and the ownership worked
  out against every sibling in the wave. That is an hour of careful work before
  any code exists. For a one-line bug fix it is absurd — which is why `/tdd`
  exists as the escape hatch, with an explicit instruction to stop and escalate
  if the change turns out to need more than about three tests.
- **A badly split spec set is worse than working serially.** This is the failure
  worth being loudest about. Split too coarsely and one spec owns everything, the
  wave has one member, and you have added a planning ceremony to sequential work.
  Split too finely and every spec depends on two others, the critical path
  lengthens, and you have added ceremony *and* serialised the work anyway. Split
  along the wrong seams and each spec needs six `shared_contracts` entries — at
  which point the "append-only" discipline is doing all the work and the
  ownership model is doing none. SPEC-007 already carries nine shared contracts,
  which is a warning sign, not a model to copy.
- **`owns` constrains the design before the implementer sees the code.** The
  spec author decides the file layout, from a position of less information than
  the agent with the compiler in front of it. `spec-author.md` explicitly forbids
  prescribing signatures, algorithms, or layout *beyond* `owns` — but `owns` is
  itself a layout decision, and an unavoidable one. When it turns out wrong, the
  implementer is told to stop and report a conflict rather than fix it, which
  costs a round trip.
- **The validator checks declarations, not behaviour.** It verifies that two
  specs' `owns` sets do not overlap. It does not verify that an agent stayed
  inside its own. Nothing prevents an implementer editing a file it does not
  own — the enforcement is the instruction plus a human diffing the change
  against `owns`. Dishonest ownership is the single most likely way this scheme
  fails in practice, and it fails silently.
- **Waves are a coarse synchronisation barrier.** A wave finishes when its
  slowest member finishes. Three agents idle while the fourth works through a
  20-test spec. A dependency-level scheduler would be better; a wave table in a
  markdown file is what we have, and it is legible, which counts for something.
- **The planning artefacts are maintained by hand and will drift.** The wave
  table, the critical path and the conflict register live in `specs/README.md`,
  written by the `parallel-planner` agent and updated at the end of each wave.
  Nothing checks that the table matches the frontmatter it summarises: a spec
  whose `wave` changes leaves a stale row, and the validator will not notice
  because the row is prose. Trust the frontmatter; treat `specs/README.md` as a
  reading aid.

## Alternatives considered

**One agent, working serially.** The honest baseline, and correct for a small
change set. Rejected for a set of eight specs where waves 1 and 2 each contain
three genuinely independent slices: the coordination cost is bounded and paid
once at planning time, while the serial cost is paid on every spec. It remains
the right answer when the critical path is nearly the whole graph — at which
point the wave table will show it, and the useful move is to run serially and say
so rather than run four agents through four waves of one.

**Agents on separate git branches, merged by the maintainer.** This is where the
idea starts, and branches are still how the work lands. Rejected as the *unit of
coordination* because a branch tells you nothing until it is finished. Ownership
declared up front is checkable *before* dispatch, which is the only point at
which a collision is cheap. A branch converts a planning error into a merge
conflict; `validate:specs` converts it into a validator failure with the
colliding paths named.

**Directory-level ownership — one agent per top-level directory.** Attractively
simple and completely wrong for this architecture. A vertical slice *by
definition* crosses layers: SPEC-004 touches `src/domain/lending/`,
`src/application/use-cases/`, `src/adapters/inbound/http/routes/`,
`tests/contract/`, `tests/unit/` and `tests/integration/`. Directory ownership
would force a horizontal split — one agent per layer — which reintroduces the
worst property of layered teams: nothing ships until all four agree, and every
change requires four handoffs.

**A lock file or a coordination server that agents consult before writing.**
Rejected on two grounds. Mechanically, it converts a planning problem into a
runtime one — agents would block, retry, and deadlock, and a lock held by a
crashed agent needs a timeout policy nobody wants to design. Practically, a lock
tells you a collision happened; ownership declared in advance tells you it *will*
happen, while the fix is still "edit a frontmatter list".

**Free-form task descriptions with no ownership declaration — "implement
returns", "implement holds".** Rejected because it is exactly the mode that
produces the incompatible-but-clean-merging changes described in the context.
Without a declared `owns` list there is nothing to check, and the first signal is
a broken build after six merges, with no way to attribute it.

**Finer-grained ownership — function or symbol level rather than file level.**
Would allow larger waves, since two specs could genuinely share a file. Rejected
because it requires parsing TypeScript to check, and because Git merges at line
granularity anyway: two agents editing different functions in the same file still
conflict if their edits are adjacent. File-level ownership plus explicit
append-only rules for the handful of genuinely shared files gets most of the
benefit from a 260-line validator with no dependencies and a hand-rolled
frontmatter parser.
