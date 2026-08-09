---
description: Implement one spec end to end under strict TDD
argument-hint: SPEC-00N
---

Implement **$ARGUMENTS**.

1. Read `specs/$ARGUMENTS-*.md` in full, including "Out of scope".
2. Confirm it is `status: ready` and that every id in `depends_on` is `status: done`. If not, stop and tell me which dependency is outstanding — do not start.
3. Set its status to `in-progress`.
4. Dispatch a `tdd-implementer` agent with the spec path, and these constraints spelled out:
   - red → green → refactor, one acceptance criterion at a time
   - stay strictly inside the spec's `owns` list
   - `shared_contracts` are append-only, under the rule the spec states
   - `npm run gate` must be green before reporting done
5. When it returns, run `boundary-guardian` over the diff.
6. Report: which criteria are implemented and the test names proving each, the gate output, anything the spec got wrong, and anything you deliberately left undone.
7. Set the spec's status to `done` only if the gate is green and the guardian found nothing that must be fixed.
