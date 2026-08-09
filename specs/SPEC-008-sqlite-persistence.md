---
id: SPEC-008
title: Persist everything in SQLite behind the existing ports
status: ready
wave: 3
depends_on:
  - SPEC-002
  - SPEC-003
  - SPEC-004
  - SPEC-005
  - SPEC-006
  - SPEC-007
owns:
  - src/adapters/outbound/sqlite/sqlite-database.ts
  - src/adapters/outbound/sqlite/migrations.ts
  - src/adapters/outbound/sqlite/sqlite-unit-of-work.ts
  - src/adapters/outbound/sqlite/sqlite-member-repository.ts
  - src/adapters/outbound/sqlite/sqlite-book-repository.ts
  - src/adapters/outbound/sqlite/sqlite-book-copy-repository.ts
  - src/adapters/outbound/sqlite/sqlite-loan-repository.ts
  - src/adapters/outbound/sqlite/sqlite-hold-repository.ts
  - src/application/ports/unit-of-work.ts
  - src/application/use-cases/checkout-copy.ts
  - tests/contract/sqlite-member-repository.test.ts
  - tests/contract/sqlite-book-repository.test.ts
  - tests/contract/sqlite-book-copy-repository.test.ts
  - tests/contract/sqlite-loan-repository.test.ts
  - tests/contract/sqlite-hold-repository.test.ts
  - tests/unit/application/checkout-copy-transaction.test.ts
  - tests/integration/sqlite-migrations.test.ts
  - tests/integration/sqlite-concurrent-checkout.test.ts
shared_contracts:
  - src/application/ports/repositories.ts (read-only; implement the interfaces, change nothing)
  - src/application/ports/book-repository.ts (read-only; implement it, change nothing)
  - src/application/ports/hold-repository.ts (read-only; implement it, change nothing)
  - src/adapters/outbound/memory/in-memory-repositories.ts (append an in-memory UnitOfWork; do not change the existing repository classes)
  - src/composition/container.ts (append the SQLite wiring behind a configuration switch; the in-memory wiring stays the default)
  - src/main.ts (read the storage configuration here and pass it in; nothing else)
  - package.json (add at most one dependency and one script; report it)
estimated_tests: 18
---

# SPEC-008 — Persist everything in SQLite behind the existing ports

## Context

Everything the service knows disappears when the process stops. A library that
forgets who has which book overnight is not a library. This spec adds durable
storage — schema, migrations, and one adapter per port — and proves it by
running the contract suites that already exist against the new adapters instead
of writing a parallel set of tests for them.

## Behaviour

**The adapter follows the ports; it does not shape them.** The application layer
already says what it needs, in its own vocabulary, and it is not changed here.
Every port keeps its exact signature, and the SQLite implementation bends to
fit — including the awkward parts, like paging and ordering inside the catalogue
search, which exist precisely so a SQL adapter can answer with `LIMIT`,
`OFFSET`, and `ORDER BY` rather than reading the whole table.

**The contract suites are the specification, and this spec writes no new
behavioural tests for them.** Each `tests/contract/*.contract.ts` suite already
defines what its port promises. Every one is bound to a SQLite adapter and
either passes unmodified or the adapter is wrong. Needing to edit a contract
suite to make SQLite pass means one of two things, both worth stopping for: the
suite encoded an in-memory accident, or the port is not really
implementation-independent.

**Schema and migrations.** The schema is created by ordered, forward-only,
individually identified migrations, applied inside a transaction and recorded in
a table so that running them against a database that is already current does
nothing. There is no down-migration. Applying migrations to an empty file
produces a working database; applying them twice produces the same database.

**Instants round-trip exactly.** SQLite has no date type. Whatever
representation is chosen — ISO-8601 UTC text or epoch milliseconds — reading a
loan back must produce a `Date` equal to the one written, to the millisecond,
and must sort correctly in `ORDER BY`. This is the single most common source of
adapter bugs and the contract suites will catch it.

**Nullable is meaningful.** `returnedAt` is `null` for an open loan and an
instant for a closed one, and the difference drives `findActiveByMember`,
`findActiveByCopy` and the fine calculation. A suspension reason is absent for a
member in good standing, not an empty string, and reading one back must not turn
absence into presence — `exactOptionalPropertyTypes` makes that a type error,
which is the desired outcome.

**Checkout is one write, not two.** SPEC-001 writes the copy and then the loan
and documents the ordering as damage control for a failure between them.
Durable storage makes it possible to remove the failure window instead of
mitigating it: the two writes become one atomic unit. Expressing that needs a
transaction boundary the *application* can ask for without knowing what a
transaction is, so the application gains a unit-of-work port: "run this piece of
work as one indivisible unit". The in-memory adapter satisfies it by simply
running the work, which is honest — a single-threaded in-memory store has no
partial writes to protect against.

**Concurrent checkout of the same copy.** Two requests for the same copy at the
same time must produce exactly one loan. The copy's transition out of
`available` and the loan's creation happen inside the same transaction, and the
transition is conditional on the copy still being available at write time — a
read-then-write with nothing enforcing it between is a lost update. The losing
request gets `COPY_NOT_AVAILABLE`, the same code it would get against any
adapter, and leaves nothing behind.

**Configuration.** The default wiring stays in-memory, so the whole test suite
and `npm run dev` are unaffected. SQLite is selected by configuration read in
`src/main.ts` — the only place in the codebase permitted to read the
environment — and passed inward as an argument.

## Acceptance criteria

- [ ] Running the migrations against an empty database file produces a schema that satisfies every contract suite; running them a second time against the same file changes nothing and reports no error
- [ ] Every applied migration is recorded with its identifier, and a database at the current version applies no further migrations
- [ ] The SQLite member repository passes `member-repository.contract.ts` unmodified
- [ ] The SQLite book repository passes `book-repository.contract.ts` unmodified, including the title-then-author-then-id ordering and the paging arithmetic
- [ ] The SQLite book-copy repository passes the book-copy contract expectations unmodified
- [ ] The SQLite loan repository passes the loan contract expectations unmodified, including the open/closed distinction behind `findActiveByMember` and `findActiveByCopy`
- [ ] The SQLite hold repository passes `hold-repository.contract.ts` unmodified, including the queue order and the identifier tiebreaker
- [ ] No file matching `tests/contract/*.contract.ts` is modified by this spec
- [ ] A loan written with a given checkout instant reads back with a `Date` equal to it to the millisecond, and loans sort by due date in the database in the same order they sort in memory
- [ ] An open loan's `returnedAt` reads back as `null`, and a closed loan's reads back as the exact instant written
- [ ] A member in good standing reads back with the suspension reason absent, not present-and-empty; a suspended member reads back with the reason intact, including one containing quotes and non-ASCII characters
- [ ] A successful checkout writes both the copy status and the loan; the two are visible together or not at all
- [ ] When the loan write fails inside the transaction, the copy is still `available` afterwards and no loan exists — the whole unit is rolled back
- [ ] The in-memory unit of work runs the work and commits it, so the existing checkout tests pass unchanged against the in-memory adapters
- [ ] Two concurrent checkouts of the same copy produce exactly one loan; the loser fails with `COPY_NOT_AVAILABLE` and the copy ends `on-loan` exactly once
- [ ] Two concurrent checkouts of *different* copies both succeed
- [ ] Identifier lookups are exact: a member id differing only in case or surrounding whitespace is not found
- [ ] With SQLite selected, the service starts, serves `GET /health`, and a loan created through `POST /loans` is still readable after the store is closed and reopened against the same file

## Out of scope

- Transaction boundaries for any use case other than checkout. Returns, holds,
  renewals and registration each write once or twice in ways that are not
  jointly load-bearing, and widening the unit of work to all of them is a
  separate change with its own review. No spec covers it yet; it is a small
  follow-up once this port exists.
- Connection pooling, read replicas, or any database other than SQLite. No spec
  covers this; the point of the port is that adding one later touches this layer
  only.
- Data migration from a running in-memory instance. There is nothing to migrate.
- Query performance work, indexes beyond what correctness requires, and
  `EXPLAIN` analysis. No spec covers this; add indexes when a measurement asks
  for them.
- Backups, restores, and retention. No spec covers this.
- Changing any port. If an interface genuinely cannot be implemented over SQL,
  stop and say so in the report rather than editing it — see the notes.

## Why this spec is alone in wave 3

**An adapter follows the ports, and waves 1 and 2 change the ports.** SPEC-004
adds a write to `MemberRepository`. SPEC-005 introduces `BookRepository` from
nothing. SPEC-003 and SPEC-006 each append a method to `LoanRepository`.
SPEC-007 adds `HoldRepository` outright and a query to `BookCopyRepository`.
Every one of those is a change to the surface this spec must implement.

A SQLite adapter written in parallel with any of them would be implementing a
target that moves underneath it: a schema missing a table, a repository missing
a method, a contract suite that did not exist when the adapter was written. The
work would look like progress and then be rewritten. There is no way to shard
around it either — this is not one spec that happens to be large, it is a spec
whose *inputs* are the outputs of six others, so no decomposition of it becomes
parallel-safe.

That is the general rule worth carrying out of this repository: **schedule by
what a spec depends on, not by how much work it looks like.** The most expensive
spec in the set is the one with nothing beside it, and putting anything next to
it would cost more than it saved.

The corollary is a real question worth asking every time, and asking here: is
the dependency genuine? It is. Every port this spec implements is edited in
waves 1 and 2, and no subset of the adapter is safe from those edits. If only
one or two ports were changing, splitting the adapter by port would be the right
answer instead.

## Notes for the implementer

**Six dependencies is normally a smell.** Here it is the shape of the problem,
and it is the reason for the wave. Do not try to start early against the
in-memory ports; wait for waves 1 and 2 to merge, then read every
`tests/contract/*.contract.ts` in the tree before writing a line of SQL. They
are your requirements document.

**`tests/contract/*.contract.ts` are read-only for you.** Import them, bind them
to your adapters, and if one will not pass, fix the adapter. If you become
convinced a suite is wrong, stop and report it — a contract suite that has to
change to accommodate a second adapter is exactly the discovery this exercise is
designed to surface, and it is more valuable than a passing build.

**Ports are read-only too**, with one exception: you own the new
`src/application/ports/unit-of-work.ts` and you take over
`src/application/use-cases/checkout-copy.ts` from SPEC-001 in order to wrap its
write pair. Keep that edit minimal — the guard sequence, the domain calls and
the returned view stay exactly as they are; only the two saves move inside the
unit. SPEC-001's checkout tests must pass unchanged, and its comment explaining
the copy-before-loan ordering should be replaced with one explaining why the
ordering no longer matters.

**File names in `owns` are ownership boundaries, not a mandated
decomposition.** The whole `src/adapters/outbound/sqlite/` tree is yours; split
it differently if the code wants to be split differently, and note the change in
your report.

**`package.json`.** Node's built-in `node:sqlite` avoids a dependency but raises
the engine floor above the current `>=20.11`; a userland driver avoids the
engine change but adds a dependency and a native build. Either is acceptable.
Whichever you choose, it is one line in `package.json`, plus a test script if
the SQLite tests need one — and the parallel-lanes rule for `package.json` is
"prefer not to; if you must, say so in your report".

**Concurrency needs a real test, not a comment.** Two overlapping checkouts
against the same file, asserting exactly one loan exists afterwards. A test that
runs them sequentially proves nothing about the thing this criterion is for.

**Determinism still applies.** The clock is still injected; the SQLite adapter
must not reach for `new Date()` or `CURRENT_TIMESTAMP` to fill an instant. Every
date written comes from the domain object being saved.
