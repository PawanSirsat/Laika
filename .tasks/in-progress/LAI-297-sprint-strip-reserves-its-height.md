---
id: LAI-297
title: The sprint strip reserves its height while sprints load
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-295
status: in-progress
started: 2026-09-19T14:52:01Z
---

## Goal

The sprint strip renders nothing while `/projects/:slug/sprints` is in flight
and then appears at its full height, pushing the board down the page. Measured
on the running instance at `:3381`, 1600x1000, signed in as `pawan@laika.local`:

```
                       while loading   after
<div> (the strip)      h=0             h=57
.board                 top=73          top=130
.kanban / skeleton     top=132         top=189
```

**57px, applied to everything below it**, including a board skeleton that is
otherwise pixel-identical to the board replacing it — LAI-295 took the rest of
that jump to zero (`top 189 vs 189`, `width0 318 vs 318`), and this is the whole
of what remains.

It only bites when sprints are slower than tasks. With every request delayed
equally the strip is empty for the whole skeleton and the jump is the full 57px;
with only tasks delayed the strip is already drawn and the jump is 0.

## Acceptance criteria

- [ ] While sprints are loading, the strip occupies the same height it will have
      once they arrive — measured, in the browser, not asserted from the source.
- [ ] A board whose project has **no** sprints does not reserve the height: the
      strip is legitimately absent there, and reserving it would be the same
      defect mirrored.
- [ ] `useDelayed` from `components/use-delayed.ts` gates anything visible, so a
      fast response shows nothing (150ms delay / 300ms hold, already the app's
      default). Reserving *space* need not be delayed; drawing a *skeleton* must.
- [ ] A test measures the strip's height in both states and asserts they agree.
      Assert the heights, not the presence of a class.
- [ ] Both themes, and `prefers-reduced-motion: reduce`.

## Notes / context

`SprintStrip.tsx` is held by the other SHELL session working in this checkout —
that is why LAI-295 filed this rather than fixing it, having already measured
the number.

`LoadingState` has the shapes and `use-delayed.ts` the timing; neither needs
adding. If the strip wants a shape none of them draw, add it to `LoadingState`
rather than hand-rolling one — `loading-sweep.test.ts` asserts every spinner in
the app comes from the one primitive, and the skeletons follow the same rule.

Reproduce with Playwright against a local instance, delaying only
`**/projects/*/sprints` so tasks and columns arrive first. Delaying everything
hides the ordering that makes this visible.

LAI-269 ("the sprint strip is one row") is a different, already-accepted
concern about its layout, not its loading state.
