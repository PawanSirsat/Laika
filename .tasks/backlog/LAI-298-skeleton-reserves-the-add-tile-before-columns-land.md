---
id: LAI-298
title: The board skeleton reserves the add-column tile before columns land
area: web
assignee: unclaimed
priority: p3
depends-on: []
discovered-from: LAI-295
status: backlog
---

## Goal

When `board-columns` has **not** arrived, the board skeleton reserves no
add-column tile, and every lane is inflated by `(tileWidth + gap) / lanes`.
Measured at 1600x1000 on `:3381`:

```
kanban width      1352      real lane width                    318
gap                 12      skeleton lane width                329
lanes                4      difference                          11
                            (32 + 12) / 4                       11
```

Confirmed by forcing `addTile={true}`: the skeleton's lanes became
**`[318,318,318,318,32]`** against the board's `[318,318,318,318,32,1]`.
**The whole 11px is the omitted tile.** The column-count fallback cost nothing
here, because four happens to be right for this project.

This is worth separating from "the skeleton is approximate when columns are
missing", which is how LAI-295 first dismissed it. There are two independent
terms and only one is unknowable:

- **column count** — genuinely unknown until `board-columns` lands;
- **the trailing tile** — a fixed `auto` track whose cost is
  `(tileWidth + gap) / n` for *any* n. Omitting it is not an approximation,
  it is an omission, and it does not depend on the unknown.

## What makes it fixable

`BoardScreen`'s `mayAddColumn` requires `boardProjectId`, which comes from
`project` or from the columns — so in this ordering it is `undefined` and the
gate is false. But `canConfigureProject` (`api/tasks.ts:240`) does not need the
project id for three of the five roles:

```ts
if (orgRole === 'owner' || orgRole === 'admin') return true;
if (orgRole === 'viewer') return false;
return memberships.find((m) => m.project_id === projectId)?.role === 'lead';
```

`me` lands well before `board-columns`, so for **owner, admin and viewer** the
answer is in hand at skeleton time. Only **member** and **lead** need the id.

## Acceptance criteria

- [ ] When the role alone decides, the skeleton reserves the tile (or correctly
      does not, for a viewer) **without** waiting for columns or the project.
- [ ] When the role does **not** decide — member or lead with no project id yet
      — the skeleton does not guess. Reserving on a coin flip is the same defect
      mirrored, and a viewer's board must not reserve a tile they never get.
- [ ] The three-role shortcut is **not** duplicated in `BoardScreen`. Express it
      in `api/tasks.ts` as a policy function returning `boolean | undefined`,
      with `canConfigureProject` delegating to it, so there is one source of
      truth for who may configure.
- [ ] Measured, with only `board-columns` delayed: the skeleton's lane widths
      equal the real board's for an admin, and no tile is drawn for a viewer.
- [ ] `loading-sweep.test.ts`'s existing gate assertions still pass — they
      assert the board and its skeleton read **one named constant**, and that
      must survive.

## Notes / context

Filed after the other SHELL session pushed back on LAI-295's reasoning for
leaving it, and was right to: the original argument treated the tile and the
count as one approximation when they are independent terms.

**p3 deliberately.** It is 11px, in one request ordering, and only when columns
are as slow as everything else. The `top` position is exact in all three
orderings measured, and the ordering where columns arrive first — the common
one — already reserves the tile correctly.

Do not "fix" this by always reserving: `LaneRow` emits the trailing `auto` only
when `onAddColumn` is defined, so a viewer's board genuinely has no tile.
