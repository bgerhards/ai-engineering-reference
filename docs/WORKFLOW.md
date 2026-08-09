# Workflow

How work gets from an idea to merged code here, and how several agents do it at
the same time without colliding.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) · [TESTING.md](TESTING.md) ·
[ADR-0003](adr/0003-specs-as-the-unit-of-parallel-work.md)

## The loop

```
  idea
    │
    ▼  /spec-new          spec-author
  spec ──────────────────────────────────────  specs/SPEC-0NN-*.md
    │                                            frontmatter: owns, wave,
    │                                            depends_on, shared_contracts
    ▼  parallel-planner + npm run validate:specs
  wave assignment ───────────────────────────  which specs may run together
    │
    ▼  /wave              one tdd-implementer per spec, dispatched in one message
  parallel implementation ───────────────────  red → green → refactor, per criterion
    │
    ▼  /gate              npm run gate
  gate ──────────────────────────────────────  typecheck · lint · architecture ·
    │                                          specs · test-discipline · tests
    ▼  /review            boundary-guardian + test-critic
  review ────────────────────────────────────  drift and weak tests, over the
                                               combined diff, not per-spec
```

Two properties make this work rather than being a diagram:

1. **Every arrow has a machine check.** A spec that is malformed fails
   `validate:specs`. An implementation that drifts fails `validate:arch`. A test
   that proves nothing fails `validate:tests`. Nothing depends on an agent
   remembering a convention.
2. **The wave boundary is a merge boundary.** Everything in wave *N* lands and
   the gate goes green before wave *N+1* starts. That is what lets a spec assume
   its dependencies exist.

## The agent roster

Six agents in `.claude/agents/`. Each is a separate context with its own tool
set — the value is not that they are smarter, it is that each one arrives
knowing exactly what to load and what it is not allowed to do.

| Agent | Reach for it when | Do **not** use it when |
| --- | --- | --- |
| `tdd-implementer` | Any change to `src/`. The default for production code. Takes a spec id or a plain description. | You want a structural change with no behaviour change — that is `refactor-surgeon`. You have not written the spec yet. |
| `spec-author` | An idea exists and there is no spec file, or an existing spec is vague, untestable, or overlaps another's `owns`. | You are already implementing. It writes specs and nothing else — it will not touch `src/`. |
| `parallel-planner` | Before dispatching a batch, when several specs land at once, or when parallel work keeps conflicting. | There is one spec. Grouping a wave of one is not planning. |
| `boundary-guardian` | Before merging anything that adds files to `src/`; over a *combined* wave diff. | The change is inside one function, or is test-only. It reads the files a change imports, which is expensive for a one-line fix. |
| `test-critic` | After a feature is implemented; when coverage is high but confidence is not. | Before the tests exist. It audits, it does not author. |
| `refactor-surgeon` | Duplication has shown its shape, a name has drifted from the domain, a green suite is protecting an ugly design. | Behaviour needs to change. Its whole protocol is "if a test has to change, stop and report" — a behaviour change makes it abort. Also not for reformatting; it is explicitly told to leave churn alone. |

Two roster-level rules worth stating plainly:

- **`boundary-guardian` and `test-critic` run together, in one message.** They
  look at the same diff from different angles and `/review` is built to
  synthesise rather than concatenate their reports. A rule sitting in a use case
  and a test that only covers it through HTTP are one finding, not two.
- **Nothing but `tdd-implementer` and `refactor-surgeon` may write to `src/`.**
  The other four have read-only or narrow tool sets by design
  (`boundary-guardian` has `Read, Bash, Glob, Grep` and no `Edit` at all).

Six commands in `.claude/commands/` drive them: `/spec-new`, `/spec-work`,
`/wave`, `/tdd`, `/gate`, `/review`. `/tdd` is the escape hatch for a change too
small to deserve a spec — it is instructed to stop and say so if the change turns
out to need more than about three tests or to touch more than two layers.

## The skills

A skill in `.claude/skills/` is a document, not a process. It carries the
*knowledge* an agent needs — the layering rules, the TDD loop, the spec schema —
and it is loaded on demand into whatever context needs it. An agent is a
*worker*: its own context window, its own tools, its own instructions, and it
returns a report. The difference matters practically: two agents cannot share
state, but both can load the same skill and be held to the same rules.

| Skill | What it holds | Loaded by |
| --- | --- | --- |
| `hexagonal-architecture` | Where code goes and why; the four layers; port smells; the "adding a feature" order (domain first, route last) | `tdd-implementer` and `boundary-guardian` on load; anyone before creating a file under `src/` |
| `tdd-cycle` | Red/green/refactor; what a valid failing test looks like; the test taxonomy; naming; when to mock (rarely) | `tdd-implementer` on load; `/tdd` explicitly |
| `spec-driven-delivery` | The frontmatter schema; what makes a criterion executable; the `owns` / `shared_contracts` distinction; the lifecycle | `spec-author` on load |
| `parallel-lanes` | Wave rules; the ranked list of conflict-prone touchpoints; how to resolve a conflict; wave sizing | `parallel-planner` on load; `/wave` |
| `quality-gate` | Every gate step; how to iterate on one; which failures must never be worked around | Anyone before declaring done; `/gate` |

The division is deliberate: an agent prompt says *what this worker is for and
what it must not do*; a skill says *how this repository works*. When you adapt
this to your own repo, the skills are the part that changes most, because they
encode your rules — the agent prompts change least.

## The hooks

Four hooks, wired in `.claude/settings.json`. They are the layer that catches
mistakes before an agent has to notice them.

| Event | Hook | What fires | What it prevents |
| --- | --- | --- | --- |
| `SessionStart` | `session-brief.mjs` | Reads every `specs/SPEC-*.md`, reports the count done and lists the lowest wave with open specs. Warns if `node_modules` is missing. Its stdout is added to the session context. | A fresh session guessing at the state of the work from the file tree, or picking up a spec from the wrong wave. |
| `PreToolUse` on `Write`\|`Edit` | `guard-boundaries.mjs` | Scans the text about to be written for imports that point outward, `node:*` in the domain, and `new Date()` / `Date.now()` / `Math.random()` / `process.env` in `domain` or `application`. Exit 2 blocks the edit and feeds the reason back. | A layering violation costing a full edit → test → diagnose → fix cycle. Caught here it costs one message. |
| `PostToolUse` on `Write`\|`Edit` | `tdd-nudge.mjs` | After a file under `src/` is written, checks whether any file under `tests/` imports it. Skips type-only modules, `main.ts`, `composition/`, and `ports/`. Exit 2 surfaces the message without undoing the edit. | A production module that quietly has no test at all. It cannot verify test-*first* ordering — only that a test exists. It is honest about being a nudge. |
| `Stop` | `stop-gate.mjs` | Runs the three dependency-free validators (architecture, test-discipline, specs) and blocks the turn ending if any fail. Guarded by `stop_hook_active` so it prompts exactly one round of fixing, never a loop. | A turn ending with the repository in an invalid state. It deliberately does *not* run the full gate: a Stop hook that takes 40 seconds trains people to disable it. |

`guard-boundaries.mjs` fails **open** — if the hook itself throws, it logs and
exits 0 rather than blocking work. A broken tool must not stop the line; the
gate is the backstop.

`settings.json` also pre-approves the read-only and verification commands
(`npm run test:*`, `npm run gate`, `npm run validate:*`, `git status`/`diff`/`log`)
and denies `git push`, `npm publish`, and reading `.env` files.

One inaccuracy to know about: `.claude/skills/quality-gate/SKILL.md` describes
`gate:quick` as "what the Stop hook runs". The Stop hook actually invokes the
three validator scripts directly and never runs the tests. `stop-gate.mjs` is the
truth.

## The quality gate

`npm run gate` runs `scripts/validate/gate.mjs`. Six steps, in a fixed order
chosen so the cheapest and most specific failure surfaces first — a type error
in two seconds beats the same information after a four-minute test run.

| # | Step | Command | Catches |
| --- | --- | --- | --- |
| 1 | typecheck | `tsc --noEmit` | Strict-mode violations, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` mismatches, and — importantly — a new `ErrorCode` with no entry in `problem.ts`'s `Record<ErrorCode, number>` |
| 2 | lint | `eslint .` | Complexity over 10, functions over 60 lines, `no-console`, non-`===`, `max-depth` over 3, and the `@/`-form layering restrictions |
| 3 | architecture | `scripts/validate/architecture.mjs` | Outward imports (including relative ones ESLint misses), `node:*` in the domain, executed platform values in the application layer, `src/composition` imported by anything but `main.ts`, and ambient time/randomness/env outside adapters |
| 4 | specs | `scripts/validate/specs.mjs` | Malformed frontmatter, duplicate or mismatched ids, missing `## Acceptance criteria` (min 3 items) or `## Out of scope`, dependency cycles, same-wave dependencies, and **two specs in one wave claiming the same path** |
| 5 | test-discipline | `scripts/validate/test-discipline.mjs` | `.only`, unexplained `.skip`, assertion-free tests, unit tests importing real adapters, modules under `src/domain` or `src/application/use-cases` that no test imports |
| 6 | tests | `vitest run --coverage` | Behaviour, plus the coverage thresholds — 90% global (88 on branches), 100% on `src/domain` |

**Every step runs even after an earlier one fails.** One run tells you everything
that is wrong, not just the first thing. The summary at the end lists each step
with pass/fail and duration, then prints a specific "what to do next" line per
failure.

Iterating on one step:

```
npm run gate -- --only=architecture   # one step; the rest report as skipped
npm run gate:quick                    # all six, but tests without coverage
npm run gate -- --json                # machine-readable summary, last 40 lines
                                      # of output per failing step
npm run validate:arch                 # or just run the script directly
npx vitest tests/unit/domain/loan.test.ts
```

`--quick` does not skip the tests; it swaps `test:coverage` for `test`. Use it
while iterating and the full gate before reporting done.

Failures you must not work around — from
`.claude/skills/quality-gate/SKILL.md`, and this is the list that keeps the gate
meaningful:

- Lowering a coverage threshold to make a change fit.
- Adding an `eslint-disable` to silence a layering rule. The rule *is* the
  architecture.
- Editing a test so failing code passes.
- Deleting an acceptance criterion that turned out to be hard.
- `--no-verify`, or skipping the gate because the change is small.

Each converts a loud failure into a quiet one. That is the only thing it
achieves. When the gate is genuinely wrong — a validator false-positives, a
threshold no longer matches reality — that is a legitimate finding: report it,
propose the fix to the validator, and change it as its own reviewed change.

## Running a wave in parallel

This is the part that is actually hard, so here it is as a procedure.

### 1. Find the wave

`specs/README.md` holds the wave table, the critical path, and the conflict
register. The `SessionStart` hook also prints the lowest wave with open specs at
the top of every session.

The current spec set, read from the frontmatter:

| Wave | Specs | Rationale |
| --- | --- | --- |
| 0 | SPEC-001 checkout (done) | Everything else builds on the domain, ports and HTTP shell it established. |
| 1 | SPEC-002 return · SPEC-004 members · SPEC-005 catalogue search | All three depend only on SPEC-001, and their `owns` sets are disjoint — returns touch `loan.ts` and `book-copy.ts`, members touch `member.ts`, search touches an entirely new book repository. |
| 2 | SPEC-003 renewals · SPEC-006 fines · SPEC-007 holds | All three depend on SPEC-002, none on each other. Each adds one new domain module and appends one repository method. |
| 3 | SPEC-008 SQLite | Depends on all six above, because a persistence adapter must implement every port that exists. |

**The critical path is 001 → 002 → {003, 006, 007} → 008: four waves.** That is
the floor on elapsed time no matter how many agents you run. Six agents on a
four-wave chain is still four rounds — when a chain is long, the useful question
is whether a dependency is real or merely assumed.

### 2. Check the plan holds

```
npm run validate:specs
```

This is not a formality. It is the check that makes the whole approach safe: it
expands the `owns` globs and refuses to let two specs in the same wave claim
intersecting paths, and it refuses a `depends_on` that points at the same wave or
a later one. If it reports a collision, **stop and re-plan with
`parallel-planner`** — dispatching into a broken plan wastes every agent at once.

Also confirm: every `depends_on` is `status: done`, the working tree is clean,
and `npm run gate` is currently green. Starting a wave from a red baseline makes
every subsequent failure ambiguous.

### 3. Dispatch

One `tdd-implementer` per spec, **all in a single message** so they run
concurrently. Each agent is told:

- its spec id and file path, and to read it completely including "Out of scope";
- its `owns` list, with the instruction that it may create or modify nothing
  outside it — and that if it genuinely needs a file another spec owns, it must
  **stop and report the conflict** rather than edit it;
- its `shared_contracts` entries with the exact append-only rule for each, quoted
  from the spec (`src/domain/shared/errors.ts (append new ErrorCode entries at
  the end only; never reorder or rename existing ones)`);
- that `npm run gate` must be green before it reports done;
- that it must never edit a test to make failing code pass.

The agent loads `CLAUDE.md`, the `tdd-cycle` skill and the
`hexagonal-architecture` skill itself; you do not need to restate the standards.

### 4. How file ownership prevents collisions

The mechanism is boring, which is why it works.

- Every spec declares `owns` — the complete set of paths it may create or
  modify. It is checked by `scripts/validate/specs.mjs`, not trusted.
- The intersection check is conservative: it converts each glob to a regex *and*
  to a sample path and tests both directions, so `src/domain/lending/*.ts` and
  `src/domain/lending/loan.ts` are correctly reported as colliding even though
  the strings differ.
- Ownership can move between waves. SPEC-002 owns
  `src/application/use-cases/return-copy.ts` in wave 1; SPEC-007 owns the same
  file in wave 2, to add hold fulfilment on return. That is legal and intended —
  the file has exactly one owner *at a time*.
- Files everyone must touch are not owned at all. They are `shared_contracts`,
  each with a stated append-only rule. The five that actually bite, in order:

| File | Why everyone touches it | Rule |
| --- | --- | --- |
| `src/domain/shared/errors.ts` | Every spec adds a failure mode | Append `ErrorCode` entries at the end; never reorder or rename |
| `src/adapters/inbound/http/problem.ts` | `Record<ErrorCode, number>` makes a new code a compile error until mapped | Append one mapping per code, in the same order as the enum. The highest-risk file in the repo |
| `src/composition/container.ts` | Every route must be registered | Append to the end of the route array; change nothing else |
| `src/application/ports/repositories.ts` | New use cases want new repository methods | Append methods at the end of the *named* interface only, one per line |
| `tests/support/builders.ts`, `tests/support/fakes.ts` | Everyone wants one more default | Append new builders; never change an existing builder's defaults — other tests depend on them |

The pattern is always the same: **append, never restructure.** Git merges two
appends to different regions of a file cleanly. It does not merge a reformat.
Note how specific the real rules are —
`src/adapters/outbound/memory/in-memory-repositories.ts (implement the new
method on InMemoryLoanRepository only)`. "Append-only" at that granularity is
what lets three specs touch the same file in one wave.

### 5. Merge

**One at a time, running `npm run gate` after each.** A gate run after five
merges tells you something broke but not which one.

Expect textual conflicts in the append-only touchpoints even when the changes are
compatible — two agents appending adjacent lines to the end of the same enum
produce a conflict, because Git sees two edits to the same region.

The resolution is almost always **keep both sides**, then re-run the gate,
because a syntactically clean merge of two semantically independent changes can
still fail the type checker. This is where `problem.ts` earns its reputation: if
two specs each added an `ErrorCode` and you keep both enum entries but only one
status mapping, `Record<ErrorCode, number>` fails typecheck immediately. That is
the design working.

If you find yourself resolving a conflict by **choosing** between two changes
rather than keeping both, the wave was planned wrong. Say so, and split the file
before the next wave.

### 6. After

1. `boundary-guardian` over the combined diff. Three individually clean specs
   can be collectively incoherent — three reasonable port method additions can
   leave a port that no longer describes one thing.
2. `test-critic` over the new tests.
3. Set each spec to `status: done` and refresh the wave table in
   `specs/README.md`.
4. Report what landed, what the gate says, every conflict and how it was
   resolved, and anything that should change about the next wave's plan.

Choose wave size conservatively. Prefer a wave of three that genuinely cannot
collide over a wave of six that probably will not. The cost of a conflict is not
the merge — it is the review, the re-run, and the chance the resolution is
subtly wrong.

## Adapting this to your own repo

In order. Each step is useful on its own, so you can stop anywhere.

### Take first — these work on day one and assume nothing about your domain

1. **`scripts/validate/gate.mjs` and the `gate` / `gate:quick` scripts.** Point
   the steps at whatever your stack already has. The value is not the checks,
   which you already run; it is that "done" becomes one command with one answer,
   that every step runs even after a failure, and that each failure prints what
   to do next. 141 lines, no dependencies.
2. **`scripts/validate/architecture.mjs`.** Change the `LAYERS` table to your
   layer names and prefixes and the rest works: it resolves specifiers, strips
   comments and string bodies first, handles dynamic `import()`, and reports
   file and line. Even a two-layer version ("nothing in `core/` may import
   `web/`") pays for itself the first time it fires. If you take nothing else,
   take this.
3. **The spec frontmatter and `scripts/validate/specs.mjs`.** The schema is
   `id`, `title`, `status`, `wave`, `depends_on`, `owns`, `shared_contracts`,
   `estimated_tests`, parsed by a ~30-line hand-rolled parser that supports
   exactly three forms (`key: scalar`, `key: []`, block list) and needs no YAML
   dependency. The ownership intersection check is the load-bearing part.
4. **`scripts/validate/test-discipline.mjs`.** The `.only` check alone justifies
   it. Drop the `orphan-module` rule until your coverage is somewhere you
   believe.
5. **The four hooks.** `guard-boundaries.mjs` needs your layer names;
   `session-brief.mjs` needs your spec directory; the other two are close to
   generic. All four fail open.

### Adapt

6. **`CLAUDE.md`.** Not the content — the *shape*. Definition of done, the
   architecture table with a "never contains" column, the determinism rule, the
   error convention, the test conventions, the "things not to do" list. Every
   line should be something a validator checks or a reviewer would actually
   raise. Delete anything aspirational; an instruction file nobody follows
   teaches agents that instruction files are optional.
7. **The agent prompts.** Keep the structure — "load first", the
   non-negotiables, the explicit "what not to do", the reporting requirement.
   Change the specifics to your stack. The single most valuable line in
   `tdd-implementer.md` is *"Never edit a test to make failing code pass. If a
   test is wrong, say so explicitly and explain why before changing it."*
8. **The skills.** These encode *your* rules and will change the most. Write
   them as documents an agent reads mid-task, not as onboarding prose.

### Drop

9. **The entire library domain.** `src/domain/catalog`, `src/domain/lending`,
   every spec, every test. It exists to make the machinery legible, not to be
   reused. Keep `result.ts`, `errors.ts` and `identifier.ts` if the `Result` and
   branded-identifier conventions suit you; they are 150 lines total and
   domain-independent.
10. **The in-memory adapters and the hand-rolled router.** They are here so the
    repo has zero dependencies. You have a framework; use it, and keep the
    boundary at the same place — one adapter file that is the only thing which
    imports it.

### How adoption actually goes wrong

Four failure modes, all of which look like success for the first week.

**Specs written too large.** The most common and the most expensive. A spec that
owns fifteen files leaves nothing for anyone else to own, so the wave has one
member and you have added ceremony to serial work. SPEC-001 in this repo owns 35
paths and estimates 62 tests — it is the bootstrap spec, `specs/README.md` calls
it "the founding slice", and it is not the model. The target is 8–20 tests and one vertical slice: a rule, its
use case, its adapter surface, its tests. If you cannot describe it in 250 lines,
split it. Watch for the tell: `depends_on` with three entries means the spec was
not decomposed, it was merely deferred.

**Ownership declared dishonestly.** An agent writes "I just needed to touch one
line in that other file". The validator only checks that declared `owns` sets do
not overlap; it does not check that an agent stayed inside its own. Nothing stops
an implementer editing a file it does not own — the enforcement is the agent's
instruction plus your review of the diff. If you find edits outside `owns`, treat
it as a planning bug first: the spec probably needed a `shared_contracts` entry
that nobody wrote. Diff against `owns` before merging.

**Agents that edit tests to get green.** This is the failure that quietly
destroys the value of everything else, because the gate stays green while the
suite stops meaning anything. Three defences, and you need all three: the
instruction stated in `CLAUDE.md` and repeated in the agent prompt; the
`test-discipline` validator, which catches the crude versions (an assertion
deleted, a `.skip` added); and a human reading the test diff. There is no
mechanical check for "this assertion was weakened", so review the test changes in
any diff where the tests and the source changed together.

**Coverage thresholds nobody believes.** A threshold set where the team will not
defend it gets lowered the first time it is inconvenient, and after that it is
decoration. Set it where it is currently true and ratchet, or set it at 100% on a
scope small and pure enough that the number is honest — which is exactly the
argument for 100% on `src/domain` and 90% elsewhere. A single global number
splits the difference badly: too low to protect the rules, too high to be
reachable at the edges. And when a threshold does become wrong, change it in a
commit of its own with a reason, never inside a feature change.

**A fifth, quieter one:** documentation that drifts from the code. This repo
contains three examples already — the SQLite adapter is SPEC-008 but two
comments say SPEC-007; the global branch threshold is 88 but `CLAUDE.md` and the
quality-gate skill both say 90; the Stop hook runs three validators directly but the quality-gate skill says
it runs `gate:quick`. None is caught by a tool, because prose is not checkable.

The one class of drift that *is* checked is worth copying: `validate:specs`
warns when a spec with `status: done` claims to own a path that is not on disk.
That caught a real mismatch in SPEC-001's `owns` list here, which was corrected
rather than argued about. Where a document makes a claim a script could verify,
write the script.

Otherwise, the mitigation is editorial: state a rule once, in the file that
enforces it, and point at it from everywhere else. That is why this document
names the authoritative file every time it makes a claim.
