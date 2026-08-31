---
id: LAI-116
title: Presence attribution must handle a repo tracked by several projects
area: server
assignee: core
priority: p2
depends-on: [LAI-108]
discovered-from: LAI-108
status: in-progress
started: 2026-09-01T15:20:00Z
---

## Goal

LAI-108 decided `projects.repo` is **not unique**: a monorepo tracked by two
projects — a frontend project and a backend project over one repository — is a
real arrangement, and a unique index would forbid it to buy an unambiguous
heartbeat match.

That decision moves the ambiguity rather than removing it. §4.3 says `repo` "maps
an incoming heartbeat's `repo` (§9.1) to a project", and with duplicates allowed
that mapping is one-to-many. Whoever builds presence has to answer it, and the
answer should be a decision rather than whatever the first `LIMIT 1` happens to
return.

## Acceptance criteria

- [ ] `POST /api/v1/heartbeats` (§9.1) resolves a `repo` to **zero, one or many**
      projects, and the behaviour for "many" is stated in code and tested.
- [ ] The comparison is **case-insensitive**. LAI-108 stores `repo` exactly as it
      was given, so a project holding `PawanSirsat/Laika` must match a plugin
      reporting `pawansirsat/laika`. §9.2 already matches branch prefixes
      case-insensitively, so this is the established precedent, not a new one.
- [ ] A repo that matches no project is not an error — §9.2's rule that unparseable
      input "degrades, it never errors" applies here too.
- [ ] Whatever is decided for the many case is written into §11 or §9, because it
      is product behaviour a UI has to render.

## Notes / context

Three candidate answers, none obviously right, which is why this is a task and not
a line in LAI-108:

1. **Attribute to every match.** Honest, and the capacity view (§9.3) then counts
   one person as present on two projects — which is arguably true of a monorepo.
2. **Disambiguate by branch.** §9.2 already resolves a task from
   `lai-<number>-<slug>` against project prefixes, so a heartbeat usually carries a
   second signal. Falls back to case 1 or 3 when the branch is unparseable.
3. **Attribute to none and record the ambiguity**, surfacing it as a
   configuration warning. Safest for correctness, worst for the feature.

Option 2 is the most likely right answer and the most work; option 1 is a
defensible first cut. Deciding it needs presence to exist, which is why this is
filed against §9.1 rather than done now.

**Do not resolve this by adding a unique index to `projects.repo`.**
`test/services/projects.repo.test.ts` asserts the absence of one precisely so that
reversal has to argue with a test rather than quietly forbid the monorepo case.
No new dependencies.
