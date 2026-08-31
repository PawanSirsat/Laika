---
id: LAI-225
title: Project-scoped activity renders its raw type name
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-411
status: backlog
---

## Goal

`describeEvent` has no case for the project-scoped §4.8 types, so the board's
activity rail prints the enum value instead of a sentence. Measured against
seeded rows on a running instance:

```
13:07:37  L   Laika          project.updated      <- raw type name
12:34:13  AL  Ada Lovelace   project.created      <- raw type name
13:07:35  AL  Ada Lovelace   edited this task     <- correct
13:07:34  AL  Ada Lovelace   moved this task      <- correct
```

Task-scoped types read as prose; project-scoped ones leak the identifier. The
rail is the one place a reader watches to know what is happening, so the rows
that describe the *project* are exactly the ones worth reading.

## Acceptance criteria

- [ ] Every type in `ACTIVITY_TYPES` renders as a sentence, not as its enum
      value. **Drive it from the enum, not from a hand-written list** — a `switch`
      that must be exhaustive under `strict` fails to compile when a type is
      added, which is the only version of this that stays true.
- [ ] A test proves an unhandled type cannot reach the screen. `STREAM_TYPES`
      already checks the client's list against `server/src/db/enums.ts`
      (`test/api/use-events.test.ts`); the same shape works here.
- [ ] Copy names the thing that changed where the payload says so —
      `project.updated` carries `{ changed: [...] }`.

## Notes

Found while measuring what the activity feed does and does not badge (LAI-411).
Not badging: this is the sentence, not the actor.

**`payload.changed` names Drizzle properties, not API fields** — that is LAI-045,
already fixed on `master`. Read it before writing copy against `changed`, so
this does not encode the old names.
