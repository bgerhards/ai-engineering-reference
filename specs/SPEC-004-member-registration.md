---
id: SPEC-004
title: Register a member, suspend and reinstate them
status: ready
wave: 1
depends_on:
  - SPEC-001
owns:
  - src/domain/lending/member.ts
  - src/application/use-cases/register-member.ts
  - src/application/use-cases/change-member-standing.ts
  - src/adapters/inbound/http/routes/member-routes.ts
  - tests/contract/member-repository.contract.ts
  - tests/contract/in-memory-member-repository.test.ts
  - tests/unit/domain/member-registration.test.ts
  - tests/unit/application/register-member.test.ts
  - tests/unit/application/change-member-standing.test.ts
  - tests/integration/member-routes.http.test.ts
shared_contracts:
  - src/application/ports/repositories.ts (append save to MemberRepository; do not change existing method signatures)
  - src/adapters/outbound/memory/in-memory-repositories.ts (add the save method to InMemoryMemberRepository; leave the other two classes untouched)
  - src/domain/shared/errors.ts (append new ErrorCode entries at the end only; never reorder or rename existing ones)
  - src/adapters/inbound/http/problem.ts (append one status mapping per new code, in the same order as the enum)
  - src/composition/container.ts (append the new routes to the end of the route array; change nothing else)
  - tests/support/builders.ts (append new builders; do not change aMember's existing defaults)
estimated_tests: 18
---

# SPEC-004 — Register a member, suspend and reinstate them

## Context

Members exist in the system today only because a test put them there — there is
no way to create one, and no way to stop one borrowing. A librarian needs to
sign somebody up at the desk, suspend a membership when something goes wrong,
and lift the suspension when it is resolved. Suspension is a decision about
borrowing *rights*, not about the books somebody already has at home.

## Behaviour

**Registration.** A member is registered under an identifier the librarian
supplies — the number on the card — and a name. The identifier obeys the same
rule as every other identifier in the system. The name is trimmed, must not be
empty after trimming, and must not exceed 120 characters; it may contain any
characters, because people's names do. A newly registered member is in good
standing and has no suspension reason.

**Registration is not an upsert.** Registering an identifier that already exists
fails with `MEMBER_ALREADY_REGISTERED` and leaves the stored member exactly as
it was, including their name and standing. Silently overwriting an existing
member is how a suspension gets laundered away by a re-signup.

**Standing.** A member is in `good` standing or `suspended`. The invariant: **a
suspension reason exists if and only if the member is suspended.** Suspending
requires a reason — trimmed, non-empty, at most 200 characters — because a
suspension nobody can explain cannot be argued with at the desk. Reinstating
clears the reason and returns the member to good standing.

**Standing changes are transitions, not assignments.** Suspending a member who
is already suspended, or reinstating one who is already in good standing, fails
with `MEMBER_STANDING_UNCHANGED` and leaves the stored member untouched — the
original suspension reason and the original date survive. This keeps "who
suspended this member and why" from being quietly replaced by whoever pressed
the button last.

**Suspension does not touch loans.** Suspending a member closes nothing,
recalls nothing, and changes no due date. Their existing loans stay open and
keep their due dates; the copies stay `on-loan`. What changes is what they may
do next: SPEC-001's borrowing allowance already refuses a suspended member, and
returning a copy is unaffected — a suspended member may always bring books
back, and must be able to, since returning is how they get reinstated.

**Failures.** Unknown member on a standing change — `MEMBER_NOT_FOUND`.
Malformed identifier, empty or over-long name, missing or empty suspension
reason — `INVALID_INPUT`, before any repository is consulted where possible.

**HTTP surface.** `POST /members` registers, returning 201 with a `location`
header of `/members/{memberId}` and a plain member view. `POST
/members/:memberId/suspension` suspends, with a JSON body carrying a string
`reason`. `DELETE /members/:memberId/suspension` reinstates. Both standing
changes return 200 with the updated member view.

**The port grows a write.** `MemberRepository` is read-only today. It gains a
save. Its behavioural promise is defined by a contract suite that every adapter
must pass, not by the interface: an unknown id yields `null`; a saved member is
readable back with every field intact; saving the same id twice replaces the
stored member rather than duplicating it; lookups match identifiers exactly,
with no trimming or case-folding at the storage layer.

## Acceptance criteria

- [ ] Registering with a valid id and name yields a member in `good` standing with no suspension reason, and the name trimmed
- [ ] Registering with a whitespace-only name fails with `INVALID_INPUT`; a 120-character name is accepted and a 121-character one is rejected
- [ ] Registering with a malformed identifier fails with `INVALID_INPUT` and writes nothing
- [ ] Registering an identifier that already exists fails with `MEMBER_ALREADY_REGISTERED`, and the stored member's name and standing are unchanged
- [ ] Suspending a member in good standing sets their standing to `suspended` and records the trimmed reason, readable back from the repository
- [ ] Suspending with a missing, empty, or whitespace-only reason fails with `INVALID_INPUT` and the member stays in good standing
- [ ] Suspending an already-suspended member fails with `MEMBER_STANDING_UNCHANGED` and the original reason is preserved
- [ ] Reinstating a suspended member returns them to `good` standing and leaves no suspension reason
- [ ] Reinstating a member already in good standing fails with `MEMBER_STANDING_UNCHANGED`
- [ ] A standing change against an unknown member fails with `MEMBER_NOT_FOUND` and writes nothing
- [ ] Suspending a member who holds three open loans leaves all three open, with their due dates and copy statuses unchanged
- [ ] A suspended member is refused a checkout with `MEMBER_SUSPENDED`, and is still able to return a copy successfully
- [ ] The `MemberRepository` contract suite asserts: unknown id yields `null`; a saved member round-trips with id, name, standing and reason intact; saving the same id twice replaces rather than duplicates; and a lookup by an id differing only in whitespace or case yields `null`
- [ ] The in-memory adapter passes the `MemberRepository` contract suite unmodified
- [ ] `POST /members` returns 201 with a `location` header of `/members/{memberId}`; a duplicate returns 409 problem details with code `MEMBER_ALREADY_REGISTERED`
- [ ] `POST /members/:memberId/suspension` returns 200 with the suspended member view; an unknown member returns 404 with code `MEMBER_NOT_FOUND`; a missing reason returns 400 with code `INVALID_INPUT`
- [ ] `DELETE /members/:memberId/suspension` returns 200 with the reinstated member view; a member already in good standing returns 409 with code `MEMBER_STANDING_UNCHANGED`

## Out of scope

- Deleting a member, or any notion of an expired or lapsed membership. No spec
  covers this yet; deletion interacts with loan history and needs its own
  decision.
- Listing or searching members. No spec covers this; SPEC-005 searches the
  catalogue, not people.
- Contact details, addresses, or anything else that would make a member record
  personal data. Deliberately deferred — the moment it exists it drags
  retention and access rules in with it.
- Automatic suspension for overdue items. SPEC-006 computes what is owed;
  nothing acts on it automatically.
- Who performed a suspension, and when. The reason is recorded; the actor is
  not, because there is no concept of an authenticated librarian yet.

## Notes for the implementer

**File you take over.** `src/domain/lending/member.ts` was created by SPEC-001,
which is `done`. `isInGoodStanding` and `requireGoodStanding` are called from
`lending-policy.ts`, which you do not own — their behaviour and signatures must
not change.

**Keep `aMember()` compiling.** `tests/support/builders.ts` builds a `Member`
from exactly `id`, `name`, and `standing`, and SPEC-002 and SPEC-005 are using
it in this same wave. Whatever representation you choose for the suspension
reason, `aMember()` and `aMember({ standing: 'suspended' })` must still
type-check without editing the builder's existing defaults. In practice that
means the reason is an optional field, not a new required one, and not a
discriminated union that splits the `Member` type. Note that `tsconfig.json`
sets `exactOptionalPropertyTypes`, so an optional field must be *absent*, not
set to `undefined` — the same rule `domainError` already follows for `details`.
You may append new builders (for example a suspended-member builder) at the end
of the file.

**Append-only rules.**

- `src/application/ports/repositories.ts` — append `save` to
  `MemberRepository`, one method per line, at the end of the interface. Do not
  touch `BookCopyRepository` or `LoanRepository`; SPEC-003 and SPEC-006 append
  to `LoanRepository` in wave 2 and will thank you.
- `src/adapters/outbound/memory/in-memory-repositories.ts` — add the
  corresponding method to `InMemoryMemberRepository` only. The existing `add`
  helper is used by tests; keep it. SPEC-005 deliberately puts its book
  repository in a *separate* file so that this one has a single writer in this
  wave — do not undo that by moving anything.
- `src/domain/shared/errors.ts` — append `MEMBER_ALREADY_REGISTERED` and
  `MEMBER_STANDING_UNCHANGED` at the end. SPEC-002 is appending two codes of
  its own in this wave; expect a textual conflict at the end of the object and
  resolve it by keeping both sides.
- `src/adapters/inbound/http/problem.ts` — both new codes are 409. Appending
  is mandatory, not optional: `Record<ErrorCode, number>` will not compile
  otherwise.
- `src/composition/container.ts` — append your routes to the end of the array.

**Contract suite shape.** `tests/contract/member-repository.contract.ts`
exports a reusable suite parameterised by a factory that produces a fresh
adapter; `vitest.config.ts` excludes `*.contract.ts` from collection, so the
suite only runs through a binding file. Yours is
`tests/contract/in-memory-member-repository.test.ts`. SPEC-008 will bind the
same suite to SQLite and must not have to edit it — so express the suite purely
in terms of the port, with no in-memory-specific helpers such as `add`.
