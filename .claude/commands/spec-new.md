---
description: Turn a rough feature idea into a validated spec file in specs/
argument-hint: <what you want to build>
---

Write a new spec for: **$ARGUMENTS**

Use the `spec-author` agent. Give it the description above plus this context:

- Read `.claude/skills/spec-driven-delivery/SKILL.md`, `specs/SPEC-TEMPLATE.md`, and `specs/README.md` first.
- Read `specs/SPEC-001-checkout-copy.md` as the standard to match.
- Assign the next free `SPEC-0NN` id.
- Work out the correct `wave` from the dependencies, and check the `owns` list against every other spec already in that wave. If they collide, either move this spec to a later wave or redesign the split so ownership is disjoint — and say which you did and why.
- Run `npm run validate:specs` before reporting done.

When it comes back, show me the spec id, its wave, what it owns, and any ownership conflict it had to design around. Do not implement anything.
