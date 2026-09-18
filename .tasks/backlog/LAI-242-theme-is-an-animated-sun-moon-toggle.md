---
id: LAI-242
title: 'The theme control becomes one animated sun/moon icon, in all three places'
area: web
assignee: unclaimed
priority: p2
depends-on: []
discovered-from: LAI-019
started:
status: backlog
---

## Goal

**Owner's request, decided as D-058.** Replace the three-option radio group with
**one icon that animates between light and dark**, everywhere it appears.

```
  today                      wanted
  ( ) Light  ( ) Dark          ☀ ⇄ ☾
  ( ) System                   one button, animated
```

**Three call sites, and all three get the same component** (owner's choice):

| | |
| --- | --- |
| `AppShell.tsx:321` | sidebar footer, above the user chip |
| `AppShell.tsx:384` | signed-out header, right side |
| `FirstBootScreen.tsx:141` | the setup screen |

## Acceptance criteria

- [ ] **One component, one icon, two states.** `System` is gone from the control
      (D-058). `ThemePreference`'s `'system'` member and `theme.ts`'s handling of
      it stay — see the migration criterion below.
- [ ] **The icon animates between the two states**, and the animation is the
      point: a sun becoming a moon, not a fade between two glyphs. **Take the
      design's own two-state model** — the prototype has no `System` and toggles
      `dark ? 'light' : 'dark'`.
- [ ] **`prefers-reduced-motion` is honoured.** The state must still change
      instantly and legibly with animation suppressed. **Assert it** — a
      transition that is merely shorter is not honouring it.
- [ ] **Absent storage still follows the OS; the first click pins.** `theme.ts`
      *removes* the key rather than storing `'system'`, so every current System
      user has **no stored value**. **An upgrade must change nothing visible for
      them** — assert both: no stored value follows `prefers-color-scheme`, and
      one click writes an explicit value that stops following.
- [ ] **A screen reader is told the current state and what the button does.** The
      old docblock's second argument was that radios do this for free; a toggle
      must do it deliberately. `aria-pressed` or an explicit label, and the
      accessible name must say which theme is *active*, not only which is next.
- [ ] **Both themes, all three places, rendered.** The signed-out header and first
      boot are pre-auth: check them in a **fresh context**, not a signed-in one.
- [ ] **Delete `theme-toggle` styles the radio group leaves behind.** A dead rule
      set is how the next person concludes there are two controls.
- [ ] Full gate green — **`EXIT 0`**, repo root.

## Notes / context

**Read D-058 before starting.** It records that the old docblock's argument —
*"three states do not cycle legibly"* — was **right, and that its premise is what
changed.** Do not read this task as overturning it; the three-state cycle was
offered to the owner and declined for that exact reason.

**The cost is stated in D-058 and is not yours to soften**: a user whose OS
switches at sunset stops following it after their first click. **Do not add a
hidden way back to System** — if it turns out to be wanted, it is a decision.

**`server/web/src/theme/` and `components/` are yours**; nothing here touches the
server. `tokens.css` does not change — the dark palette already hangs on `.dk`.

---

## Shelved, not failed — CHIEF, 2026-09-03. **Released; D-059 supersedes D-058.**

**Nobody is working this and the claim was stranded.** SHELL stood down mid-task
and was told not to commit, so the lock on their branch read `in-progress` with
no one behind it — **§2's stranded-task shape, and the release is mine because
the claimant could not make it.** Back to `backlog/`, `assignee: unclaimed`.

**D-058 is superseded, not withdrawn.** The sun/moon toggle remains sound on its
own terms; **the chrome it lives in is being replaced.** If the new design carries
a theme control, **D-058's reasoning about `system` still applies** — particularly
that `system` is never stored, so absent must keep meaning *follow the OS*.

### The work exists and is not in git

SHELL completed it and reverted cleanly. Two artefacts, **copied to CHIEF's
scratchpad so they do not die with a session directory**:

```
lai-242-theme-toggle.patch     552 lines, 16 tracked files
lai-242-new-files.tgz          theme-toggle.css, theme-toggle.test.ts, theme.test.ts
```

**Both are needed.** A diff cannot carry untracked files, so the patch alone
restores a component with no styles and no tests. **Verified against `master`
today: `git apply --check` is clean.**

**These are scratchpad files, not a branch.** If this work is wanted, whoever
takes it should land it properly rather than rely on a temp directory surviving.

### The half that should survive whatever the new chrome looks like

`test/theme/theme.test.ts` — **the storage contract**, pinned for the first time:
`writePreference('system')` **removes** the key, junk reads as `system`, and a
throwing storage does not take the app down.

**That file exists because a mutation setting `'system'` into storage went
green** against the browser tests — correctly, since the toggle never passes
`'system'` — **and the browser test was named as though it covered it.** SHELL
caught their own naming rather than the mutation being weak. **If the new design
has a theme control, that file is the half to keep unchanged.**

The patch also drops `theme/theme.ts` from `WEB_NO_MIRROR_REQUIRED`, which must
travel with it.
