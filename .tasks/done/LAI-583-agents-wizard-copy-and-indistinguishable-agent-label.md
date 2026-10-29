---
id: LAI-583
title: 'Agents wizard says the name shows on cards and that the agent''s token is "your token"; two agents on one device share a label'
area: web
assignee: shell
priority: p2
depends-on: []
discovered-from: LAI-582
started: 2026-10-28T21:53:57Z
status: done
accepted: 2026-10-29T13:57:10Z
finished: 2026-10-28T22:10:33Z
---

## Goal

What the Agents wizard tells the owner matches what the board then shows, and
two of the owner's agents can be told apart on a card, in the picker and in
History.

## Acceptance criteria

- [x] Step 4's badge over the paste block no longer says "carries your token" when the block carries the agent's token (the line above it says "These carry Claude Code · Belka's token, not yours")
- [x] Step 1's Name hint ("How it is named on cards, history and Capacity") is true, or is reworded to say what is shown; decide which with the owner
- [x] Two agents with the same harness and device (e.g. two Claude Code agents on Belka) are distinguishable in the drawer picker, the card chip, the List's Agent column and History — or the wizard refuses/flags the clash
- [x] Both themes, 1440 and 390

## Notes / context

Measured live on production (master `4bb4846c`) in LAI-582, 2026-10-28:

- An agent registered as `Acceptance · test renamed`, harness *No MCP (REST /
  CLI)*, device `Belka`, appears in the drawer picker as **"another agent —
  Pawan Sirsat · Belka"** and in its Agents row subtitle as "another agent ·
  Belka". Its chosen name appears nowhere outside the Agents tab.
- `agentLabel()` in `server/web/src/api/selected-agent.ts` is
  `product · device`, falling back to `display_name` only when there is no
  device — so the name the wizard asks for is not what cards carry.
- Step 4 badge: evidence `05-wizard-step4-instructions-masked-light-1440.png`
  (credential masked) in `.polly/evidence/LAI-582/`.

Not a Phase 1+2 functional failure — every flow worked. It is copy that
misleads, and a label that collides once an owner has two agents of one kind on
one machine.

## Outcome (SHELL, Belka, 2026-10-29)

**Copy.**
- Step 4: `SetupBlockView` takes the badge's words (`tokenTag`); the wizard
  says *carries the agent’s token*, Connect keeps *carries your token*.
- Step 1's Name hint now says what is true: *Your name for it, shown here.
  Cards and history name it by harness and device, and add this name where
  two of your agents share both.* The manager's dispatch gave the direction
  (D-118: an agent is named `<harness> · <device>`; add the registered name
  only on a collision), standing in for "decide with the owner".

**Two agents, one harness, one device.** `distinctDevices` / `twinNames` in
`api/selected-agent.ts`: an agent stays `Claude Code · laptop-1`; where two
the screen holds collide, each becomes `Claude Code · laptop-1 (polly
workers)`, or the id's last four when the registered name adds nothing.
Wired into the picker (the reader's agents), the card chip (the board's
tasks, cached per map; the chip shows the differing name in place of the
device, which its ellipsis would cut), the List (its tasks; the cell shows the differing
name, the full label read aloud and on hover), the drawer field, History
and the agent filter (`agentNamesFrom`, `agentsOnTasks`).

**Picker label order.** `Claude Code · laptop-1 — Ada Lovelace`, not
`Claude Code — Ada Lovelace · laptop-1`: the first screenshot showed both
twins cut to *…Ada Lovelace · laptop-1…*. Six picker strings in
`agent-field.test.ts` / `agent-states.test.ts` re-aimed, found by an
untruncated sweep.

Not done: the wizard does not refuse or flag a clash; telling the two apart
everywhere made that unnecessary. A harness of *another agent* (No MCP) still
reads *another agent* on the chip and in the picker, as before.

Tests: unit `selected-agent.test.ts` (+4); browser `agent-field.test.ts`
*the cards, the picker and History tell them apart, in both themes* and *the
List tells them apart*, `agents-tab.test.ts` step 1 hint and step 4 badge.
Red without the source change (browser 0/3, unit fails to import), green
with it.

## Review round 1 (cross-vendor, #128) — fixed

1. **Marks could still collide.** Two agents named alike with ids ending
   alike both read `(1234)`; a fallback could equal another's registered
   name. `twinNames` now keeps a registered name only when it is unique in
   its group, grows id tails until the group differs, and checks the final
   labels across every agent given (whole id for any still alike). Unit
   tests reproduce both cases, a device that already reads like a mark,
   order independence, middle-cut names, and 343 combinations. Broken on
   purpose (fixed 4-char tail, no final check): 4 red.
2. **The picker could cut the mark at 390.** The mark is now the option's
   badge (`flex: none`, never cut); the label stays the whole name. Browser
   test at 390, both themes, measures the badge on screen and that the
   label is in fact cut; with the badge removed it fails.

Accepted by CHIEF (polly) after cross-vendor review and green CI; merged in #128.
