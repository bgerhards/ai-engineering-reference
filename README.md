# ai-engineering-reference

**A worked example of what a well-run repo looks like when AI agents do the building.**

This is a teaching reference, not a product. It exists to be read, argued with, and copied from. The application inside it — a lending library — is deliberately boring; the domain is not the point. The point is everything around it: the standards file, the agents, the hooks, the validators, and the specs that let several agents work at once without tripping over each other.

Zero runtime dependencies. Node 20+.

```bash
npm install
npm test          # 171 tests, ~0.5s
npm run gate      # the definition of done
```

---

## Start here

Read in this order. About fifteen minutes end to end.

| # | File | Why |
|---|---|---|
| 1 | [`CLAUDE.md`](CLAUDE.md) | The standards every agent is held to. This is the single highest-value file to copy. |
| 2 | [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Includes a file-by-file trace of one request, socket to database and back. |
| 3 | [`specs/SPEC-001-checkout-copy.md`](specs/SPEC-001-checkout-copy.md) | The worked example every other spec copies. |
| 4 | [`specs/README.md`](specs/README.md) | The wave plan, critical path, and conflict register. |
| 5 | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | How agents, hooks, and the gate fit together — and how to adapt it. |

---

## The four ideas worth stealing

### 1. Standards are enforced, not documented

A convention nobody checks is a convention nobody follows. Every rule in `CLAUDE.md` has something mechanical behind it:

| Rule | What enforces it |
|---|---|
| Imports point inward | `scripts/validate/architecture.mjs`, plus a hook that blocks the edit before it lands |
| No `new Date()` outside adapters | Same validator — determinism is checked, not trusted |
| No assertion-free tests, no stray `.only` | `scripts/validate/test-discipline.mjs` |
| 100% coverage on the domain | `vitest.config.ts` per-directory thresholds |
| No two specs owning the same file | `scripts/validate/specs.mjs` |

All six run as one command: `npm run gate`. That is the definition of done — not "my tests pass".

### 2. The unit of parallel agent work is a spec with declared file ownership

Every spec declares `owns` — the exact paths it may touch. The validator refuses to let two specs in the same wave claim the same path. That turns "can these run at once?" from a judgment call into a check, so a wave can be handed to several agents simultaneously with a mechanical guarantee they won't collide.

Files everyone must touch (the error enum, the route list) are declared `shared_contracts` and are **append-only** — two appends merge cleanly, a reformat does not.

```
Wave 1 ──┬── SPEC-002 return a copy       3 agents in parallel
         ├── SPEC-004 member registration
         └── SPEC-005 catalog search
Wave 2 ──┬── SPEC-003 renew               all need wave 1's closed-loan concept
         ├── SPEC-006 overdue fines
         └── SPEC-007 holds
Wave 3 ─── SPEC-008 SQLite adapter        alone: an adapter follows the ports,
                                          and waves 1-2 change six of them
```

### 3. Tests prove behaviour, not coverage

Coverage says which lines ran. It does not say anything was verified. So the repo also checks *test discipline*: no assertion-free tests, no unexplained skips, no unit test reaching real infrastructure, no production module without a test.

Contract tests (`tests/contract/`) are exported suites rather than test files. Adding a second database adapter means writing **zero** new assertions — you bind the existing suite to the new adapter and it either passes or it doesn't.

### 4. The domain is pure, so it can be held to a higher bar

`src/domain` has no I/O, no clock, no framework, and no imports from an outer layer. It runs in microseconds, which is why 100% coverage there is reasonable rather than dogmatic — and why the edges are covered by contract and integration tests instead of a percentage target.

---

## What's in here

```
src/
  domain/         business rules — pure, 100% covered
  application/    use cases and the ports they need
  adapters/       http in; memory, clock and uuid out
  composition/    wiring — the only file naming a concrete adapter
tests/
  unit/           one module at a time
  contract/       a port's promise, run against every adapter
  integration/    a real request through a real server
specs/            8 specs, 4 waves, declared file ownership
scripts/validate/ the four validators the gate runs
docs/             architecture, testing, workflow, 3 ADRs
.claude/          6 agents, 5 skills, 6 commands, 4 hooks
CLAUDE.md         the standards
```

**The pipeline:**

```
/spec-new "..."   →  a validated spec in specs/
/wave             →  one agent per spec, dispatched in parallel
/gate             →  typecheck, lint, architecture, specs, discipline, tests
/review           →  boundary-guardian + test-critic over the diff
```

---

## Adapting it to your repo

In this order, because the early items pay off immediately and carry no assumptions about your domain:

1. **The gate.** One command that means "done". Start with whatever checks you already have; the value is in there being one command.
2. **The architecture validator.** ~240 lines of dependency-free Node. Encode your layering rules and fail the build on violations.
3. **`CLAUDE.md`.** Write down the rules that are actually non-negotiable. Keep it short — every line loads into every session.
4. **Spec frontmatter and the ownership check.** Only once you're actually running more than one agent at a time.
5. **Adapt the agent prompts** to your stack. Drop the library domain entirely.

### How this honestly goes wrong

Worth saying out loud, because these are the failure modes in practice:

- **Specs written too large.** A spec that owns fifteen files leaves nothing for anyone else to own, and your "parallel" waves serialise.
- **Ownership declared dishonestly.** An agent that edits outside `owns` because it was quicker. This is why the check is mechanical.
- **Agents editing tests to get green.** The one discipline a validator can't enforce. It has to be in the standards file and in review.
- **Thresholds nobody believes.** A coverage number set where it's convenient teaches everyone to route around the gate.

---

## A note on how this was built

Every finding below came from the pipeline catching something while the repo was building itself — none was planted:

- A `Stop` hook **blocked the session** over unit tests importing the adapters layer. The tests were right; the *rule* was too blunt. It now derives impurity from the module transitively instead of matching directory names.
- Fixing that exposed a bug in the validator itself — a shared `/g` regex whose `lastIndex` a nested scan rewound, double-reporting every finding.
- Mutation testing found a real domain defect: two different notions of "active loan" three lines apart in the same function.
- A review agent found a hole in the ownership check — `a/**/b.ts` couldn't match `a/b.ts`, so two specs could have claimed the same file and been waved through.

That is the argument for the whole setup, and it's a better one than anything in the docs.
