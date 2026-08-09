---
name: hexagonal-architecture
description: Where code goes in this repository and why — the four layers, the dependency rule, what a port is, and the specific smells that indicate drift. Use before creating any file under src/, when deciding which layer a rule belongs in, or when reviewing structure.
---

# Hexagonal architecture, as practised here

```
        ┌──────────────────────────────────────────┐
        │  composition/   wiring, and nothing else │
        │  ┌────────────────────────────────────┐  │
        │  │  adapters/   http, db, clock, uuid │  │
        │  │  ┌──────────────────────────────┐  │  │
        │  │  │  application/  use cases,    │  │  │
        │  │  │                ports         │  │  │
        │  │  │  ┌────────────────────────┐  │  │  │
        │  │  │  │  domain/  entities,    │  │  │  │
        │  │  │  │           rules        │  │  │  │
        │  │  │  └────────────────────────┘  │  │  │
        │  │  └──────────────────────────────┘  │  │
        │  └────────────────────────────────────┘  │
        └──────────────────────────────────────────┘
```

**The dependency rule: imports point inward, always.** `npm run validate:arch` enforces it.

## What lives where

### `src/domain` — the rules

Entities, value objects, policies. Pure functions over immutable data. Zero imports from an *outer* layer, and zero `node:*`.

Imports *within* the domain are fine and expected — `lending/loan.ts` imports `catalog/book-copy.ts` because a loan is genuinely about a copy. The rule is about direction, not isolation: the validator rejects an import only when the target sits further out than the importer.

This layer has no idea it is in a web service. It could run in a CLI, a Lambda, or a test harness unchanged, which is precisely why it is cheap to test exhaustively — and why it is held to 100% coverage.

If you can answer "yes" to *"would a librarian recognise this as one of their rules?"*, it goes here.

### `src/application` — the orchestration

Use cases and ports. A use case answers "what happens when someone asks for X", in this shape:

> parse input → load state through ports → **ask the domain to decide** → persist the decision → return a plain view

The word to watch is *ask*. A use case that decides — that contains `if (activeLoans.length >= 5)` — has stolen a rule from the domain. Move it.

Ports are interfaces owned by *this* layer, named in *this* layer's vocabulary. `findActiveByMember`, not `executeQuery`. The test: if switching database would change the port, it is not a port.

### `src/adapters` — the outside world

`inbound/` receives (HTTP today), `outbound/` reaches out (memory today, SQLite tomorrow). Adapters translate; they never decide. This is the only layer allowed to touch `node:*`, the clock, randomness, the environment, or the network.

### `src/composition` — the wiring

The only file that names concrete adapters. Hand-written, no DI framework, readable top to bottom.

## Ports and adapters in practice

```ts
// application/ports/repositories.ts — the application's vocabulary
export interface LoanRepository {
  save(loan: Loan): Promise<void>;
  findActiveByMember(memberId: MemberId): Promise<readonly Loan[]>;
}
```

Every adapter implementing this must pass the same suite in `tests/contract/`. That suite is the real definition of the port; the interface is just its type signature. When SPEC-008 adds SQLite, it writes no new behavioural tests — it binds the existing contract suite to a new adapter, and either passes or does not.

## Smells, and what they actually cost you

| Smell | What it costs |
| --- | --- |
| Business `if` in a use case | The rule can no longer be found or tested in one place |
| Port method named after SQL | Changing database now changes the application layer |
| `new Date()` outside adapters | A test that flakes, eventually, unreproducibly |
| Entity returned from a route | The wire format is now the domain model; refactoring stops |
| Framework type in `application/` | The framework is now load-bearing and cannot be replaced |
| Anaemic entity + fat use case | You have a procedural program wearing an architecture costume |

## Adding a feature

1. **Domain first.** What is the rule? Write it as a pure function with tests. It should be the easiest part.
2. **Port, if needed.** What must the use case ask the world for? Add the method; extend the contract suite.
3. **Use case.** Orchestrate the guards. If it reads as anything other than a sequence of "ask, check, act", the rules are in the wrong place.
4. **Adapter.** Translate in, translate out.
5. **Wire it.** Append to `src/composition/container.ts`.

The order matters. Starting at the HTTP route is how business rules end up in route handlers.
