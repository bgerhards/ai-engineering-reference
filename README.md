# app-sample

A small, complete reference for building software with AI agents under real engineering discipline: test-first, hexagonally layered, specified in machine-checked specs, and shipped through a quality gate that nothing routes around.

The domain is a lending library — small enough to read in one sitting, rich enough to have real invariants. **The domain is not the point.** The point is the machinery around it, which is designed to be lifted into your own repository.

Zero runtime dependencies. Node 20+.

```bash
npm install
npm test
npm run gate      # the definition of done
npm start         # http://localhost:3000
```

```bash
curl -X POST localhost:3000/loans \
  -H 'content-type: application/json' \
  -d '{"memberId":"member-1","copyId":"copy-1"}'
```

## What is here

```
src/
  domain/         business rules — pure, no imports, 100% covered
  application/    use cases and the ports they need
  adapters/       http in; memory, clock and uuid out
  composition/    wiring — the only file naming a concrete adapter
tests/
  unit/           one module at a time, in-memory adapters
  contract/       a port's promise, run against every adapter
  integration/    a real request through a real server
specs/            the work, with declared file ownership and waves
scripts/validate/ the validators the gate runs
docs/             architecture, testing, workflow, ADRs
.claude/          agents, skills, commands, hooks, settings
CLAUDE.md         the standards every agent is held to
```

## The two ideas worth stealing

**1. Architecture and discipline are enforced, not documented.**

Imports point inward, and `npm run validate:arch` fails the build if they do not. A PreToolUse hook blocks the edit before it lands. Business rules that drift out of the domain, `new Date()` in a use case, an assertion-free test, a stray `.only` — each has a validator, because a convention nobody checks is a convention nobody follows.

**2. The unit of parallel agent work is a spec with declared file ownership.**

Every spec lists the files it may touch. `npm run validate:specs` refuses to let two specs in the same wave claim the same path — so a wave can be dispatched to several agents at once, in one message, with a mechanical guarantee they will not collide. Files everyone must touch (the error enum, the route list) are declared as append-only shared contracts.

See `specs/README.md` for the current wave plan, critical path, and conflict register.

## The pipeline

```
/spec-new "..."   spec-author      →  a validated spec in specs/
/wave             tdd-implementer  →  one agent per spec, in parallel
/gate             the six checks   →  typecheck, lint, arch, specs, discipline, tests
/review           boundary-guardian + test-critic
```

Six agents in `.claude/agents/`, five skills in `.claude/skills/`, six commands in `.claude/commands/`, four hooks in `.claude/hooks/`.

## Reading order

1. [`CLAUDE.md`](CLAUDE.md) — the standards, in full.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — including a file-by-file trace of one request.
3. [`specs/SPEC-001-checkout-copy.md`](specs/) — the worked example every other spec copies.
4. [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — how the agents, hooks and gate fit together, and how to adapt this to your own repo.

## Adapting it

Take the gate and the validators first — they are the part that works on day one and they carry no assumptions about your domain. Then the spec frontmatter and the ownership check. Then adapt the agent prompts to your stack. Drop the library domain entirely.

`docs/WORKFLOW.md` covers this properly, including the realistic ways adoption goes wrong: specs written too large, ownership declared dishonestly, agents that edit tests to get green, and thresholds set where nobody believes them.
