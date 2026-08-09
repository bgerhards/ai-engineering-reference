# ADR-0001: Hexagonal architecture

**Status:** Accepted, 2026-08-08

Related: [ARCHITECTURE.md](../ARCHITECTURE.md) for how it works in practice ·
[ADR-0002](0002-test-driven-development-with-a-quality-gate.md) ·
[ADR-0003](0003-specs-as-the-unit-of-parallel-work.md)

## Context

This service will outlive its current infrastructure. The persistence layer
today is three `Map`s in
`src/adapters/outbound/memory/in-memory-repositories.ts`;
`specs/SPEC-008-sqlite-persistence.md` replaces them with SQLite. The HTTP
layer is 90 lines of hand-rolled `node:http` and router; it will eventually be a
framework, or a Lambda handler, or both.

The business rules will outlive all of that. "A suspended member may not borrow",
"a member may hold at most five items", "a withdrawn copy cannot be lent" — those
statements were true before this repository existed and will be true after it is
rewritten. If they are entangled with `req`, `res`, a connection pool, or an ORM
session, then every infrastructure change is also a business-logic change, and
every business-logic test needs infrastructure to run.

There is a second, sharper pressure here. Most of the code in this repository is
written by agents working in parallel from specs. Agents are good at local
correctness and bad at noticing slow structural drift — a policy `if` in a route
handler looks perfectly reasonable in isolation and only becomes a problem when
the same rule exists in three places. Any architecture we choose has to be
checkable by a script, or it will not survive contact with the delivery model.

## Decision

Four layers, with imports pointing strictly inward:

```
domain  ←  application  ←  adapters  ←  composition
```

- `src/domain` — entities, value objects, policies. Pure functions over
  immutable data. No imports from outer layers, no `node:*`, no I/O.
- `src/application` — use cases and the ports they need. A use case parses,
  loads through ports, **asks the domain to decide**, persists, and returns a
  plain view. It orchestrates; it does not decide.
- `src/adapters` — `inbound/` receives, `outbound/` reaches out. Translation
  only. The only layer allowed to touch `node:*`, the clock, randomness, the
  environment, or the network.
- `src/composition` — wiring, by hand, in one readable function. The only file
  naming concrete adapters. Private to `src/main.ts`.

Ports are interfaces owned by `src/application`, named in the application's
vocabulary (`findActiveByMember`, not `executeQuery`). Their behavioural promise
is defined by suites in `tests/contract/`, which every adapter must satisfy.

Two supporting rules fall out of this and are treated as part of the decision:

- **Determinism.** `new Date()`, `Date.now()`, `Math.random()` and `process.env`
  appear only under `src/adapters/` or in `src/main.ts`. Time and identity enter
  through the `Clock` and `IdGenerator` ports.
- **Domain types do not escape.** A route returns a view
  (`CheckoutCopyResult`: five strings), never an entity.

**The rule is enforced by three mechanisms, not by review:**
`.claude/hooks/guard-boundaries.mjs` blocks the edit before it lands;
`eslint.config.js` restricts `@/`-form imports per layer;
`scripts/validate/architecture.mjs` resolves every specifier — relative,
aliased, and dynamic — and fails the gate. The validator is authoritative.

## Consequences

### Good

- The domain is testable with no setup at all. `tests/unit/domain/` runs in
  milliseconds against pure functions, which is what makes a 100% coverage
  requirement on `src/domain` honest rather than punitive (see
  [ADR-0002](0002-test-driven-development-with-a-quality-gate.md)).
- Swapping infrastructure is a bounded change. Replacing `node:http` touches
  `src/adapters/inbound/http/` and nothing else; the request trace in
  [ARCHITECTURE.md](../ARCHITECTURE.md#a-complete-trace-post-loans) shows exactly
  which five files that is. SPEC-008 adds a whole persistence backend without
  changing a single port.
- Every business rule has one home. When a librarian asks "under what
  circumstances can somebody not borrow?", the answer is
  `checkBorrowingAllowance` in `src/domain/lending/lending-policy.ts`, one
  function, in order of precedence.
- Determinism removes an entire class of flaky test. Nothing in `domain` or
  `application` can observe midnight, a timezone, or a leap day.
- The rule is machine-checkable, so parallel agents cannot erode it by accident.
  A layering mistake costs one blocked edit instead of a review cycle.

### Bad

- **More files, more indirection.** Checking a copy out passes through close to
  twenty files, as the trace in
  [ARCHITECTURE.md](../ARCHITECTURE.md#a-complete-trace-post-loans) shows. For a
  CRUD endpoint with no rules that is pure overhead, and this repository has no
  CRUD endpoints to demonstrate the cost fairly.
- **Ports invite speculation.** `LoanRepository.findActiveByCopy` is declared,
  implemented, and called by nothing. An interface with one implementation and
  no caller is indirection wearing an abstraction's clothes; the
  `boundary-guardian` agent is explicitly told to flag these, which is an
  admission the failure mode is real.
- **The mapping at the boundary is genuine work.** `CheckoutCopyResult` restates
  five fields that already exist on `Loan`. When the view and the entity are the
  same shape, the mapping looks like ceremony — and it is, right up until the day
  the entity changes and the wire format must not.
- **The layer boundary is easy to get subtly wrong.** "Is this a domain rule or
  an application concern?" has no mechanical answer. The validator catches
  *import direction*; it cannot catch a rule that ended up in the wrong layer
  while pointing the right way. That is why `boundary-guardian` exists, and why
  its brief is explicitly "the violations a validator cannot see".
- **Newcomers pay a real tax.** The trace in `ARCHITECTURE.md` exists because
  "where does a request go?" is not answerable by reading one file.

## Alternatives considered

**A conventional layered service (`controllers/`, `services/`, `models/`).**
Rejected because the dependency direction is the wrong way round: models are
typically ORM entities, so the "innermost" layer is the one most coupled to the
database, and every business rule ends up in a service that cannot be
instantiated without a connection. It also has no mechanical definition — the
layer names are directories, and nothing stops a controller importing a model or
a service importing a controller. We could not have written
`architecture.mjs` against it.

**A transaction script / vertical-slice layout — one folder per feature,
everything inside it.** Genuinely attractive: fewer files per change, no
cross-cutting navigation, and it parallelises beautifully because a feature
folder is a natural `owns` unit. Rejected because rules do not respect feature
boundaries. `checkBorrowingAllowance` is needed by checkout, and will be needed
by renewals (SPEC-003) and holds (SPEC-007). Under vertical slicing it either
gets duplicated three times or migrates to a `shared/` folder that becomes a
domain layer with a worse name. We would arrive here anyway, having paid for the
detour.

**A full DI container with decorators and reflection.** Rejected because
`createDefaultAdapters()` in `src/composition/container.ts` is fifteen readable
lines and needs no runtime, no metadata emit, and no dependency. The container's
value appears at a scale of wiring this service does not have, and its cost —
resolution errors that surface at runtime rather than compile time — appears
immediately. Hand-wiring also keeps `src/composition` scannable, which matters
because it is the append-only touchpoint every parallel spec must modify.

**Onion / Clean Architecture with a separate `infrastructure` project and
interface segregation everywhere.** Rejected as the same idea with more
ceremony. We took the dependency rule and the ports, and left the mandatory
one-interface-per-consumer and the four-project solution layout. The four
directories here do the same work with less to explain.

**No architecture: rules wherever they land, enforced by review.** Rejected on
the specific grounds that this repository's code is written by parallel agents.
Review-enforced conventions decay under any delivery model; under one where six
workers with no shared context each make a locally reasonable choice, they decay
fast. Anything not checked by a script is not a rule here — it is a preference.
