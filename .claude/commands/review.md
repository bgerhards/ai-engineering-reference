---
description: Review the current changes for architectural drift and weak tests
argument-hint: [file or directory to focus on]
---

Review the current working-tree changes${ARGUMENTS:+, focusing on: $ARGUMENTS}.

Run these two agents **in a single message** so they work concurrently:

1. `boundary-guardian` — layering, leaked infrastructure, business rules that escaped the domain, ports that grew database-shaped.
2. `test-critic` — tests that pass without proving anything, missing failure-mode coverage, non-determinism, mutations that would survive.

Then synthesise. Do not just concatenate the two reports:

- Merge findings that are the same underlying problem seen from two angles. A rule sitting in a use case and a test that only covers it through HTTP are one finding, not two.
- Rank by what will actually cost someone later, not by how easy it is to describe.
- Separate **must fix before merge** from **worth watching**.
- For each must-fix, name the smallest change that resolves it.

If both agents come back clean, say so plainly in a line or two and name the strongest evidence they found for that. Do not manufacture findings to look thorough.
