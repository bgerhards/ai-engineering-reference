---
description: Implement a small change test-first, without spinning up a spec
argument-hint: <the behaviour to add or fix>
---

Implement this test-first: **$ARGUMENTS**

This is the lightweight path for a change too small to deserve a spec — a bug fix, one extra rule, a missing validation. Anything larger belongs in a spec; if this turns out to need more than about three tests or touches more than two layers, stop and tell me it should be a spec instead.

Load the `tdd-cycle` skill, then:

1. **Red.** Write one failing test naming the behaviour. Run it. Show me the failure message — I want to see that it failed for the reason you expected, not with a `ReferenceError` you were going to get anyway.
2. **Green.** Least code that passes. Run the test.
3. **Refactor.** Name the concept, push the rule down into `src/domain` if that is where it belongs, run the full suite.
4. Repeat for each behaviour.

If this is a bug fix, the reproducing test is the deliverable — write it before you look for the cause, and tell me what class of bug it belongs to and whether a sibling test should exist.

Finish with `npm run gate` and report its output.
