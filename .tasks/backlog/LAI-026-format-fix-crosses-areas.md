---
id: LAI-026
title: '`pnpm format:fix` silently edits other sessions'' areas'
area: server
assignee: unclaimed
priority: p1
depends-on: []
discovered-from: LAI-003
status: backlog
---

## Goal

`pnpm format:fix` runs Prettier over the whole repo. Run from any worktree it
rewrites files in **every** area, so a builder tidying their own code silently
modifies another session's — precisely what D-008's worktree split exists to
prevent. Make the fixing half of the formatter respect ownership without
narrowing the checking half.

## Acceptance criteria

- [ ] `pnpm format` still checks the **whole** repo (PM's LAI-001 review decision:
      "a formatter that only looks where it is already clean stops being a check").
- [ ] `pnpm format:fix` no longer writes outside the area of whoever ran it, or
      it warns loudly enough that the edit cannot pass unnoticed.
- [ ] A builder can fix their own formatting in one command without staging a
      cross-area diff.
- [ ] Whatever shape is chosen is written down where builders will see it —
      `CLAUDE.md` §4 or the root `package.json` scripts.

## Notes / context

Discovered during LAI-003, by doing it: `pnpm format:fix` from
`Laika-builder-a/` reformatted `plugin/.claude-plugin/plugin.json` — Builder-B's
file, and the exact file LAI-014 exists to fix. It was caught by `git status`
before the commit and reverted, but only because the diff happened to be looked
at. The check itself is fine and PM was right to keep it repo-wide; it is the
`--write` variant that crosses the line.

Plausible shapes, in rough order of preference:

1. Per-area scripts — `format:fix:server`, `format:fix:plugin` — with the bare
   `format:fix` removed. Blunt, obvious, no cleverness.
2. `format:fix` writes only files already modified in the working tree
   (`git diff --name-only` filtered through Prettier), which is what someone
   almost always means by "fix my formatting".
3. Leave it, and rely on staging explicit paths. Weakest: it depends on every
   session noticing every time.

**This needs a root `package.json` edit**, which is outside a builder's area —
LAI-001's scope exception was granted to that task only. Whoever takes this needs
PM to name the file in the task first, or PM makes the change.

No new dependencies.

---

## PM decision — 2026-08-24

**Scope exception granted.** This task authorises **Builder-A** to edit exactly
one file outside `server/`:

- `package.json` (repo root) — the `format` and `format:fix` scripts only.

Nothing else at root. This is the same shape as LAI-001's exception (CLAUDE.md
§1: an exception must name files one by one), and it expires with this task.

**Ownership answer.** Root config files have **no standing owner**. They are
PM-granted per task, to one session, by name. LAI-001 held that grant; it lapsed
when LAI-001 closed; LAI-026 now holds it. Builder-A gets it because they own the
larger share of what the formatter touches and they found the bug — not because
of a precedent that carries over.

**Shape decided — option 2, with option 1 as the fallback.** Do not spend time
re-deciding this:

`format:fix` formats **only files this worktree has changed** — tracked
modifications *and* untracked new files:

```
git diff --name-only HEAD ; git ls-files --others --exclude-standard
```

filtered to Prettier-supported extensions, then `prettier --write`. Untracked
files matter: a new file is the most likely thing to be unformatted, and
`git diff` alone misses it.

Why this over per-area scripts: in a worktree your changes *are* your area, so it
is inherently ownership-respecting without encoding the ownership map anywhere —
nothing to update when D-016 moves `server/web/` to Builder-B. It is also what
someone actually means by "fix my formatting". If it turns out fiddly, fall back
to option 1 (`format:fix:server`, `format:fix:web`, `format:fix:plugin`, and
delete the bare `format:fix`) and say so in your log.

`pnpm format` stays repo-wide and check-only. That was the LAI-001 review
decision and this task does not reopen it.

**Raised to p1.** Every session that runs `format:fix` before this lands can
silently rewrite another session's files. **Claim this before LAI-004.** Until it
lands, CLAUDE.md §5 tells everyone to use `pnpm exec prettier --write <files>`
instead — that guard is documentation, not a fix, which is why this is p1.

**Interim mitigation is already in place**, so this is not a blocker for anyone:
CLAUDE.md §5 now names the hazard and the workaround.

## Acceptance criteria — added by PM

- [ ] `pnpm format` unchanged: whole repo, check-only.
- [ ] `pnpm format:fix` writes only files changed in the current worktree,
      including untracked ones.
- [ ] Running `format:fix` from `Laika-builder-a/` with an unformatted file in
      `plugin/` leaves that file **untouched** — the exact regression that
      produced this task, proven not to recur.
- [ ] The behaviour is documented in the root `package.json` scripts or
      `CLAUDE.md`, and the interim guard in CLAUDE.md §5 is removed once the fix
      lands.

---

## Added by PM — 2026-08-24: `docs/design/` breaks the format gate

**`pnpm format` is currently red on `master`** — six findings, all mine, none
related to the cross-area bug above. I imported the Claude Design mockups into
`docs/design/`, and the repo-wide glob picks up `**/*.html` and `**/*.js`:

- four `.dc.html` mockups — Prettier cannot **parse** them. `<sc-if>` is a custom
  element the Claude Design runtime handles, and Prettier's HTML parser rejects
  it as an unclosed tag. These are hard errors, not style warnings.
- `docs/design/support.js` — vendored, generated, marked "do not edit".

Both are third-party artefacts that must never be formatted. `docs/design/README.md`
already says so; the tooling does not know it.

**Scope exception extended.** In addition to `package.json`, this task authorises
Builder-A to create or edit exactly:

- `.prettierignore` (repo root)

Nothing else. If ESLint also needs an ignore for `docs/design/support.js`, add
`eslint.config.js` to the grant by saying so in your log — do not assume it.

### Extra acceptance criteria

- [ ] `.prettierignore` excludes `docs/design/` entirely, with a one-line comment
      saying why (imported mockups + vendored runtime, never ours to format).
- [ ] `pnpm format` is **green on a clean `master`** — the whole point of keeping
      it repo-wide (LAI-001 review) is that red means something.
- [ ] `docs/design/` files are unchanged by the fix. If Prettier has already
      rewritten one, restore it from git — those files are a visual reference and
      a reformat corrupts the comparison they exist for.

**Why folded in rather than filed separately:** same script, same root files, and
two tasks editing `package.json`/`.prettierignore` concurrently would conflict.
