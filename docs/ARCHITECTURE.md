# Architecture

A lending-library service in TypeScript with zero runtime dependencies. The
domain is deliberately small; the structure around it is the part worth reading.

Related: [TESTING.md](TESTING.md) · [WORKFLOW.md](WORKFLOW.md) ·
[ADR-0001](adr/0001-hexagonal-architecture.md)

## The four layers

```
  composition/container.ts — constructs everything below, once, at startup
  ────────────────────────────────────────────────────────────────────────

   inbound adapters                                 outbound adapters
  ┌──────────────────────┐                        ┌────────────────────────┐
  │ http/server.ts       │ ← socket               │ memory/in-memory-…     │ → a Map
  │ http/router.ts       │                        │ system/system-clock.ts │ → OS clock
  │ http/routes/*.ts     │                        │ system/random-id-…     │ → node:crypto
  │ http/problem.ts      │ → socket               └────────────────────────┘
  └──────────┬───────────┘                                    ▲
             │ command in, view or problem out                │ calls through ports
             ▼                                                │
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ application/   use-cases/ · ports/       orchestration, no decisions     │
  └───────────────────────────────┬─────────────────────────────────────────┘
                                  │ asks
                                  ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │ domain/   catalog/ · lending/ · shared/  entities, values, rules         │
  └─────────────────────────────────────────────────────────────────────────┘
```

**The dependency rule: imports point inward.** `domain` knows nothing.
`application` knows `domain`. `adapters` know `application` and `domain`.
`composition` knows everything. `src/main.ts` sits outside the layers entirely
and is the only file permitted to import `src/composition`.

Three things enforce this, in increasing order of cost to hit:

| Mechanism | When it fires | File |
| --- | --- | --- |
| PreToolUse hook | Before an agent's edit lands | `.claude/hooks/guard-boundaries.mjs` |
| ESLint `no-restricted-imports` | On `npm run lint` | `eslint.config.js` |
| Architecture validator | On `npm run validate:arch` and in the gate | `scripts/validate/architecture.mjs` |

The validator is authoritative. The ESLint rules only restrict the `@/` alias
form, so a relative outward import like `../../adapters/x.js` slips past them;
`architecture.mjs` resolves specifiers to real paths and catches it, along with
dynamic `import()` and the determinism rules below.

Note one thing the rule does *not* forbid: imports **within** a layer.
`src/domain/lending/loan.ts` imports `src/domain/catalog/book-copy.ts`, and that
is fine — the validator compares layer ranks and only rejects `to.rank >
from.rank`. Prose elsewhere in this repo that says the domain has "zero imports
from `src/`" is shorthand for "zero imports from *outer* layers".

## A complete trace: `POST /loans`

This is the whole system in one request. Every file is named in the order it is
entered.

**Startup, once.** `src/main.ts` reads `PORT` from `process.env`, calls
`createDefaultAdapters()` and `createAppRouter(...)` from
`src/composition/container.ts`, and hands the resulting router to
`createHttpServer` in `src/adapters/inbound/http/server.ts`. `container.ts` is
the only file that names `InMemoryMemberRepository`, `systemClock` or
`randomIdGenerator`, and the only place `makeCheckoutCopy` is bound to concrete
dependencies.

Then, per request:

| # | File | What it does with the request |
| --- | --- | --- |
| 1 | `src/adapters/inbound/http/server.ts` | The `node:http` callback. Parses the URL, drains the body (rejecting anything over 1,000,000 bytes), `JSON.parse`s it, and calls the router. A throw from `JSON.parse` becomes a bare 400; a throw from anywhere further in becomes a logged 500. |
| 2 | `src/adapters/inbound/http/router.ts` | Walks the route array from `container.ts`, matching `/loans` segment by segment. Path match but method mismatch → 405; no path match → 404. Otherwise calls the handler with `params` filled in. |
| 3 | `src/adapters/inbound/http/routes/checkout-route.ts` | `parseBody` checks the payload is an object with string `memberId` and `copyId`. If not, it builds an `INVALID_INPUT` `DomainError` itself and returns early through `problem.ts`. Otherwise it calls the injected `CheckoutCopy` function. This is the last file that knows HTTP exists. |
| 4 | `src/application/use-cases/checkout-copy.ts` | The orchestration, and the spine of the rest of this table. It parses, loads, asks, persists, and projects — it decides nothing. |
| 5 | `src/domain/lending/member.ts` → `src/domain/shared/identifier.ts` | `parseMemberId` delegates to `parseIdentifier`, which trims and applies `/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/`, returning a branded `MemberId` or an `INVALID_INPUT` error. |
| 6 | `src/domain/catalog/book-copy.ts` → `src/domain/shared/identifier.ts` | The same for `parseBookCopyId` and `BookCopyId`. Branding is what stops the two ever being passed in the wrong order. |
| 7 | `src/adapters/outbound/memory/in-memory-repositories.ts` | `InMemoryMemberRepository.findById`. `null` → the use case returns `MEMBER_NOT_FOUND`. |
| 8 | `src/adapters/outbound/memory/in-memory-repositories.ts` | `InMemoryBookCopyRepository.findById`. `null` → `COPY_NOT_FOUND`. |
| 9 | `src/adapters/outbound/system/system-clock.ts` | `clock.now()`. The one and only reading of the current instant for this request; everything downstream is a pure function of it. |
| 10 | `src/adapters/outbound/memory/in-memory-repositories.ts` | `InMemoryLoanRepository.findActiveByMember` — the member's open loans, filtered by `isActive` from `src/domain/lending/loan.ts`. |
| 11 | `src/domain/lending/lending-policy.ts` | `checkBorrowingAllowance` — the whole "may this member borrow?" answer, in one function. It calls `requireGoodStanding` (`member.ts`) → `MEMBER_SUSPENDED`, then `isOverdue` (`loan.ts` → `isBefore` in `shared/date.ts`) → `MEMBER_HAS_OVERDUE_LOANS`, then the count against `policy.maxActiveLoans` → `LOAN_LIMIT_REACHED`. The order is deliberate: the most explanatory reason wins. |
| 12 | `src/domain/catalog/book-copy.ts` | `markOnLoan` returns a *new* copy with `status: 'on-loan'`, or `COPY_WITHDRAWN` / `COPY_NOT_AVAILABLE`. The use case never assigns `status` itself. |
| 13 | `src/adapters/outbound/system/random-id-generator.ts` | `nextLoanId()` — `loan-${randomUUID()}`. The only randomness in the request. |
| 14 | `src/domain/lending/loan.ts` → `src/domain/shared/date.ts` | `openLoan` validates `loanPeriodDays` is a positive integer and computes `dueAt` via `addDays(now, 21)`. `returnedAt` starts `null`. |
| 15 | `src/adapters/outbound/memory/in-memory-repositories.ts` | `copies.save(lentCopy)` **then** `loans.save(loan)`. The ordering is load-bearing; see [Deliberate omissions](#deliberate-omissions). |
| 16 | `src/application/use-cases/checkout-copy.ts` | Builds `CheckoutCopyResult`: five strings, dates already `toISOString()`d. No `Loan`, no `BookCopy`, no branded types leave the layer. |
| 17 | `src/adapters/inbound/http/routes/checkout-route.ts` | 201, `location: /loans/<loanId>`, the view as the body. |
| 18 | `src/adapters/inbound/http/server.ts` | `JSON.stringify`, `writeHead`, `end`. |

**The failure path** diverges at step 17. Any `Err` from step 4 goes to
`toProblemResponse` in `src/adapters/inbound/http/problem.ts`, which looks the
`ErrorCode` up in `STATUS_BY_CODE` and emits an RFC 9457 problem document with
`content-type: application/problem+json`, carrying the error's `details` through
as `extensions`.

Read that table backwards and the point of the layering is visible: to swap
`node:http` for Fastify you rewrite rows 1–3 and 17–18. Rows 4–16 do not know
the difference.

## Ports and adapters

Ports are interfaces owned by `src/application`, named in the application's
vocabulary. The full inventory today:

| Port | File | Methods | Adapter |
| --- | --- | --- | --- |
| `MemberRepository` | `src/application/ports/repositories.ts` | `findById` | `InMemoryMemberRepository` |
| `BookCopyRepository` | `src/application/ports/repositories.ts` | `findById`, `save` | `InMemoryBookCopyRepository` |
| `LoanRepository` | `src/application/ports/repositories.ts` | `save`, `findActiveByMember`, `findActiveByCopy` | `InMemoryLoanRepository` |
| `IdGenerator` | `src/application/ports/id-generator.ts` | `nextLoanId` | `randomIdGenerator` |
| `Clock` | `src/domain/shared/clock.ts` | `now` | `systemClock` |

`Clock` is the odd one out: it lives in `src/domain`, not
`src/application/ports`, because `LendingPolicy` and `Loan` both take a `now:
Date` and the domain wants the vocabulary of time without the vocabulary of
storage. It is still a port in every other sense — an interface with a
substituted implementation (`FixedClock` in `tests/support/fakes.ts`).

Two honest observations about the inventory as it stands:

- `MemberRepository` has no `save`. Members are seeded through
  `InMemoryMemberRepository.add`, which is **not** on the port. Any contract
  suite therefore needs an adapter-specific seeding step, and a future SQL
  adapter has to provide the same affordance or the port needs a write method.
- `LoanRepository.findActiveByCopy` is declared and implemented but has no
  caller. Double-lending is currently prevented by the copy's `status`, not by a
  loan lookup. It is a port method waiting for a spec, and until one arrives it
  is the kind of speculative interface the `boundary-guardian` agent is
  explicitly told to flag.

### How `tests/contract/` proves substitutability

The port interface is a type signature; the *behaviour* it promises lives in
`tests/contract/`. Those files are named `*.contract.ts`, and `vitest.config.ts`
excludes that pattern from test discovery:

```ts
include: ['tests/**/*.test.ts'],
// `*.contract.ts` files export reusable suites; they are not tests themselves.
exclude: ['**/node_modules/**', '**/*.contract.ts'],
```

A `*.contract.ts` file exports a function that takes a factory for the adapter
under test and calls `describe`/`it` inside it. A thin `*.test.ts` file per
adapter imports that function and invokes it. Adding an adapter therefore means
writing a factory and one line, and *zero new assertions* — the new adapter
either satisfies the existing promise or it does not. That is what makes
`specs/SPEC-008-sqlite-persistence.md` a swap rather than a rewrite: it owns
five `tests/contract/sqlite-*.test.ts` files and lists every port file in
`shared_contracts` as read-only.

[TESTING.md](TESTING.md#contract-tests) covers the mechanics.

## The `Result` convention

`src/domain/shared/result.ts` defines `Result<T, E> = Ok<T> | Err<E>` with
`ok`/`err` constructors and `map`, `flatMap`, `all`. Every fallible domain and
application function returns one.

**Why failures are values.** "This member is suspended" is an outcome of asking
the question, not an exception to it. Making it a value means the type system
forces every caller to handle it — `if (!result.ok) return result` appears eight
times in `checkout-copy.ts`, and each one is a branch the compiler insisted on.
It also means the use case reads as a straight sequence of guards rather than a
try/catch with invisible control flow, and that a test asserts on a returned
value instead of on `expect(() => ...).toThrow()`.

**When an exception is still correct.** Two cases:

1. *Bugs.* A `TypeError` from dereferencing something impossible is not a
   `Result` — it is a defect, and it should crash loudly at the top of the stack
   so it appears in logs rather than being folded into a 409.
2. *Infrastructure faults.* A dead socket, an out-of-memory, an oversized
   request body. `server.ts` throws `new Error('Request body too large')` from
   `readBody` and catches it at the boundary. The distinction is that nobody
   models these in `ErrorCode`; they are not part of the domain's vocabulary.

The rule of thumb: if a librarian could describe the failure, it is a `Result`.
If only an operator could, it is an exception.

**Exhaustiveness.** `ErrorCode` in `src/domain/shared/errors.ts` is a closed
union built from an `as const` object. `src/adapters/inbound/http/problem.ts`
maps it with

```ts
const STATUS_BY_CODE: Record<ErrorCode, number> = { /* ... */ };
```

`Record<ErrorCode, number>` requires every member. Adding `LOAN_ALREADY_CLOSED`
to the enum without deciding its status is a **compile error in `problem.ts`**,
not a 500 discovered in production. This is why the two files appear together in
every spec's `shared_contracts` list, and why the parallel-lanes skill calls
`problem.ts` the highest-risk file in the repository: it is where two concurrent
specs are most likely to append adjacent lines.

Current mapping: `INVALID_INPUT` → 400; `MEMBER_NOT_FOUND` / `COPY_NOT_FOUND` →
404; `MEMBER_SUSPENDED` → 403; `MEMBER_HAS_OVERDUE_LOANS`, `LOAN_LIMIT_REACHED`,
`COPY_NOT_AVAILABLE`, `COPY_WITHDRAWN` → 409.

## Determinism

`Clock` (`src/domain/shared/clock.ts`) and `IdGenerator`
(`src/application/ports/id-generator.ts`) exist so that time and identity are
arguments rather than ambient facts.

The rule, enforced by the `determinism` text rule in
`scripts/validate/architecture.mjs` and duplicated in the PreToolUse hook:
`new Date()`, `Date.now()`, `Math.random()` and `process.env` may appear only
under `src/adapters/` or in `src/main.ts`.

Note what is *not* banned: `new Date(someInstant)`. The validator's pattern is
`/\bnew Date\s*\(\s*\)/` — empty parentheses only. `src/domain/shared/date.ts`
constructs dates constantly (`new Date(from.getTime() + days * …)`) and is
entirely deterministic, because every value it produces is a function of its
arguments. The ban is on *reading the ambient clock*, not on the `Date` type.

What this buys, concretely:

- `tests/support/fakes.ts` provides `FixedClock` and `SequentialIdGenerator`. A
  test can assert `dueAt` is exactly `2026-01-22T09:00:00.000Z` and the loan id
  is exactly `loan-1`. No `vi.useFakeTimers()`, no regex over a UUID, no
  tolerance windows.
- "The loan is overdue" is testable by constructing a clock three weeks ahead,
  not by waiting three weeks or by mutating global time.
- The suite cannot flake at midnight, on a leap day, or in a different timezone,
  because nothing in `src/domain` or `src/application` can observe any of those.

The single place `new Date()` appears in production code is
`src/adapters/outbound/system/system-clock.ts`, which is three lines long.

## Deliberate omissions

Everything below is missing on purpose. A reader who finds a gap that is not
listed here should assume the rest of this document is also incomplete, so:

**No database.** The only persistence is three `Map`s in
`src/adapters/outbound/memory/in-memory-repositories.ts`. Restarting the process
loses everything. *What to add first:*
`specs/SPEC-008-sqlite-persistence.md` already describes it — a
`src/adapters/outbound/sqlite/` directory with one class per repository, bound in
`createDefaultAdapters()` behind a configuration switch, and one
`tests/contract/sqlite-*.test.ts` per port binding the existing contract suites
to it. The ports do not change; SPEC-008 lists them all as read-only
`shared_contracts`. `MemberRepository` needs a write method first, which
`SPEC-004` appends.

(The comments in `src/adapters/outbound/memory/in-memory-repositories.ts` and in
`.claude/skills/hexagonal-architecture/SKILL.md` both say "SPEC-007" when they
mean the SQLite adapter. SPEC-007 is holds and reservations; SQLite is SPEC-008.
The specs are the truth.)

**No transactions.** `checkoutCopy` performs two independent saves:

```ts
// Copy first: if persistence fails midway, a copy marked on-loan with no
// loan record is recoverable by an audit job, whereas a loan pointing at an
// available copy would let the same book be lent twice.
await deps.copies.save(lentCopy.value);
await deps.loans.save(loan.value);
```

The ordering is the mitigation, not a fix. It chooses the recoverable failure
over the unrecoverable one: a copy stuck as `on-loan` with no loan is an
inconsistency a nightly job can find and clear, whereas a loan against an
`available` copy lets two members walk out with the same book. Nothing here
makes the pair atomic. *What to add first:* a `UnitOfWork` port in
`src/application/ports/`, taking a callback and giving the use case a
transactional handle; the in-memory adapter implements it with a snapshot
rollback, the SQLite adapter as `BEGIN`/`COMMIT`. The use case wraps both saves.
SPEC-008 does exactly this — it owns `src/application/ports/unit-of-work.ts`
*and* `src/application/use-cases/checkout-copy.ts`, in the same spec as the
database, because a transaction port with only a no-op implementation proves
nothing.

**No authentication or authorization.** Anyone who can reach the socket can
check out a book as any member. There is no notion of an actor distinct from the
`memberId` in the body. *What to add first:* an inbound concern, not a domain
one — a wrapper in `src/adapters/inbound/http/` that resolves credentials to a
principal before the router runs, plus an `ACTOR_FORBIDDEN` code in `ErrorCode`
and its 403 in `problem.ts` for the cases the domain needs to reason about
(a librarian override, say). Resist putting the principal in
`CheckoutCopyCommand` until a domain rule actually depends on it.

**No observability.** There are exactly two `console` calls in `src/` — a
startup line in `main.ts` and an unhandled-error line in `server.ts` — and
`no-console` is an ESLint error everywhere except `src/main.ts`,
`src/adapters/inbound/http/**` and `scripts/**`. No request ids, no structured
logs, no metrics, no tracing. *What to add first:* a `Logger` port and a
request-id generated in `server.ts` and threaded through; structured JSON lines
from a single adapter in `src/adapters/outbound/`. Log at the boundary, not in
the domain — a pure function that logs is no longer pure, and the 100% coverage
requirement on `src/domain` would start covering log statements.

**No rate limiting, no backpressure, no timeouts.** The 1 MB body cap in
`server.ts` is the only input bound. A client can open unlimited connections and
issue unlimited checkouts. *What to add first:* this is genuinely infrastructure
— a reverse proxy or gateway in front of the process is the right first answer,
not application code. If it must live here, it belongs in
`src/adapters/inbound/http/`, wrapping the router, and it should reject with a
plain 429 rather than acquiring an `ErrorCode`, because "too many requests" is
not something a librarian would say.

**Also absent, more briefly:** no config beyond `PORT`; no migrations; no
pagination or listing endpoints; no idempotency keys, so a retried `POST /loans`
after a lost response is indistinguishable from a second checkout attempt (it
will fail with `COPY_NOT_AVAILABLE`, which is safe but unhelpful); no CORS; no
graceful-shutdown drain beyond `server.close`.
