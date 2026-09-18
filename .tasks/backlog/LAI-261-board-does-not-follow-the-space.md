---
id: LAI-261
title: 'The board keeps the old project when you switch space'
area: web
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-260
status: backlog
---

## Goal

**Found on a running instance while checking LAI-260.** Clicking a space in
the sidebar updates the URL and the space bar's headline, and **the board keeps
showing the previous project's tasks** until the page is reloaded.

Measured, three clicks with a generous wait after each:

```
start              url=?project=laika-infra  header=laika-infra  cards=LI-1
after Laika Web    url=?project=laika-web    header=Laika Web    cards=LI-1   <-- wrong
after Laika Core   url=?project=laika-core   header=Laika Core   cards=LI-1   <-- wrong
after reload       url=?project=laika-core   header=Laika Core   cards=LC-1..LC-10
```

`BoardScreen` seeds its project into local state **once**:

```ts
const [slug, setSlug] = useState(params.get('project') ?? undefined);
```

and nothing re-reads it. The only writer is the default-project resolver, which
runs when the URL names no project at all. So a project chosen from outside the
board — which is now the primary way anyone changes project — never reaches it.

**The file already warns about this exact failure, from the other direction.**
The resolver's own comment reads: *"Holding it only in state is how someone ends
up reading project A under a header they never look at, believing it is B
(LAI-423)."* That is precisely what happens here; LAI-423 fixed the header and
left the state seeded once.

Not a regression from the space bar — but the space bar is what made switching
project a one-click action, so a latent defect became the main path.

## Acceptance criteria

- [ ] Clicking a space re-renders the board with that project's tasks, with no
      reload. Asserted in a browser test that clicks between two spaces with
      **different, identifiable task keys** and reads the cards after each.
- [ ] The default-project resolution still works: a `/board` with no
      `?project=` picks one and writes it into the URL (LAI-423).
- [ ] Back and Forward across two spaces show each one's tasks.
- [ ] Full gate — all three `EXIT 0`, repo root.

## Notes / context

The fix is to stop treating the URL as an initial value. `slug` may stay state
for the resolver's sake, but a project named in the URL must win whenever it
changes.

**The existing board tests could not see this**: every one of them opens a
board at a fixed `?project=` and never changes it. A test that switches
project is the missing shape, not a missing assertion.
