import type {
  PersonHandoffAgent,
  PersonHandoffView,
  PersonInboxCounts,
  PersonInboxView,
} from '../../api/handoffs.ts';
import { agentLabel, UNNAMED_AGENT } from '../../api/selected-agent.ts';
import { clockTime } from '../../api/time-label.ts';
import { ageWords } from './execution-derive.ts';

/*
 * Inbox → Hand-offs, from a person's inbox as served (`GET /handoff-offers`,
 * LAI-1009; the screen is LAI-550). The server decides which offers are in
 * each view, what each view counts and what the reader can do next; this
 * only puts words to it.
 *
 * **Approval and acceptance are two steps, said apart.** A person approves a
 * cross-owner hand-off; only the receiving agent accepts it. So a row never
 * says *accepted* because someone approved it, and never offers a person the
 * accept.
 *
 * Plain functions, no JSX, so `node --test` pins every rule.
 */

/**
 * What the sidebar and the Hand-offs tab count: offers to your agents and
 * offers waiting for your approval — the two views that wait on you. Sent
 * waits on the receiver, and Recovery is every space's. **The server's
 * counts are live and unexpired only** (LAI-1009), so an expired, declined,
 * withdrawn or accepted offer never reaches the badge; nothing is counted
 * from rows here. `undefined` until read.
 */
export function handoffsWaiting(counts: PersonInboxCounts | undefined): number | undefined {
  if (counts === undefined) return undefined;
  return counts.received + counts.needs_approval;
}

/** *Claude Code · Belka* — harness · device — or what the row is when it names none. */
export function agentWords(agent: PersonHandoffAgent | null, unnamed: string): string {
  return agent === null ? unnamed : agentLabel(agent);
}

/** The approval step: needed or not, and where it stands. */
export function approvalWords(
  row: Pick<PersonHandoffView, 'requires_approval' | 'approved' | 'state'>,
): string {
  if (!row.requires_approval) return 'No approval needed';
  if (row.approved) return 'Approved by a person';
  return row.state === 'pending_approval' ? 'Waiting for a person to approve' : 'Not approved';
}

/** The acceptance step: the receiving agent's, and only the server says it happened. */
export function acceptanceWords(
  row: Pick<PersonHandoffView, 'state' | 'to_agent' | 'to_agent_redacted' | 'closed_reason'>,
): string {
  const to = agentWords(row.to_agent, row.to_agent_redacted ? UNNAMED_AGENT : 'any eligible agent');
  switch (row.state) {
    case 'pending_approval':
      return `${to} can accept once it is approved`;
    case 'open':
      return `Waiting for ${to} to accept`;
    case 'accepted':
      return `Accepted by ${to}`;
    case 'declined':
      return `Declined by ${to}`;
    case 'expired':
      return 'Expired before anyone accepted';
    case 'cancelled':
      switch (row.closed_reason) {
        case 'reclaimed':
          return 'Withdrawn — the agent reclaimed the task';
        case 'task_closed':
          return 'Closed — the task left In progress';
        case 'agent_revoked':
          return 'Closed — an agent was revoked';
        default:
          return 'Withdrawn';
      }
  }
}

/** Whether the offer is still live as the server answered it. */
export function isLive(row: Pick<PersonHandoffView, 'state'>): boolean {
  return row.state === 'pending_approval' || row.state === 'open';
}

const VERIFICATION_WORDS: Readonly<Record<string, string>> = {
  verified: 'verified',
  pending: 'waiting for its push notice',
  ref_deleted: 'its ref was deleted',
  uncertain: 'needs attention',
};

/** *Saved 12 min ago · verified*, or why there is nothing to say. */
export function checkpointWords(
  row: Pick<PersonHandoffView, 'checkpoint' | 'checkpoint_id'>,
  now: number,
): string {
  if (row.checkpoint === null) {
    return row.checkpoint_id === null ? 'No save' : 'The save was removed';
  }
  const state = VERIFICATION_WORDS[row.checkpoint.verification] ?? 'state unknown';
  return `Saved ${ageWords(Math.max(0, now - row.checkpoint.saved_at))} · ${state}`;
}

/** *Expires 14:32*, for a live offer that expires. */
export function expiryWords(
  row: Pick<PersonHandoffView, 'state' | 'expires_at'>,
): string | undefined {
  if (!isLive(row) || row.expires_at === null) return undefined;
  return `Expires ${clockTime(row.expires_at)}`;
}

/** The next step, as the server's `next_action` names it, in words. */
export function nextActionWords(
  row: Pick<PersonHandoffView, 'next_action' | 'to_agent' | 'to_agent_redacted'>,
): string {
  const to = agentWords(row.to_agent, row.to_agent_redacted ? UNNAMED_AGENT : 'an eligible agent');
  switch (row.next_action) {
    case 'approve':
      return `Your approval — then ${to} can accept`;
    case 'name_receiver':
      return 'A person names the agent to receive it — open the task';
    case 'accept_with_your_agent':
      return `Run ${to}: it accepts with laika agent accept`;
    case 'cancel':
      return `Waiting for ${to} — you can withdraw it`;
    case 'wait_for_approval':
      return 'Waiting for the task’s assignee or a space lead to approve';
    case 'wait_for_receiver':
      return `Waiting for ${to} to accept`;
    case 'none':
      return 'Nothing to do';
  }
}

/**
 * *Approve* is offered only when the server says the reader may approve
 * **and** the receiver's owner is known and is not the reader — from the row
 * itself, which names the receiving agent's owner. The server refuses
 * anything else (`approver_is_receiver`); this keeps the control away from
 * someone it would refuse, and never offers it on a guess.
 */
export function mayApprove(
  row: Pick<PersonHandoffView, 'next_action' | 'to_agent' | 'to_agent_redacted' | 'state'>,
  meId: string | undefined,
): boolean {
  if (row.next_action !== 'approve' || row.state !== 'pending_approval') return false;
  if (meId === undefined) return false;
  // Withheld (LAI-1012): another person's agent, as the reader's own is always shown.
  if (row.to_agent_redacted) return true;
  if (row.to_agent === null) return false;
  return row.to_agent.owner.id !== meId;
}

/** *Withdraw*, only where the server says the reader may cancel a live offer. */
export function mayWithdraw(row: Pick<PersonHandoffView, 'next_action' | 'state'>): boolean {
  return row.next_action === 'cancel' && isLive(row);
}

/** What each empty view says, so an empty filter is never mistaken for a failed read. */
export const EMPTY_VIEW_WORDS: Readonly<Record<PersonInboxView, string>> = {
  received: 'No hand-off or recovery offer is waiting for one of your agents.',
  sent: 'None of your agents has a hand-off out.',
  needs_approval: 'Nothing is waiting for your approval.',
  recovery: 'No task is waiting to be recovered.',
};

/** A row on screen: the server's row, or one kept in place that this view no longer lists. */
export interface ShownRow {
  readonly row: PersonHandoffView;
  /** No longer in this view's answer; kept only while the reader is acting nearby. */
  readonly gone: boolean;
}

/**
 * Merge a fresh read into what is on screen **without moving a row the
 * reader is acting on** (LAI-550).
 *
 * - Not holding: the server's order, as answered.
 * - Holding (a write in flight, or the focus inside the list): every row
 *   stays where it is — changed in place, kept and marked `gone` if the view
 *   no longer lists it — and new rows wait in `waiting` until the hold ends.
 */
export function mergeHeld(
  shown: readonly ShownRow[],
  fresh: readonly PersonHandoffView[],
  holding: boolean,
): { readonly rows: readonly ShownRow[]; readonly waiting: number } {
  if (!holding) return { rows: fresh.map((row) => ({ row, gone: false })), waiting: 0 };
  const byId = new Map(fresh.map((row) => [row.id, row]));
  const rows = shown.map((s): ShownRow => {
    const next = byId.get(s.row.id);
    return next === undefined ? { row: s.row, gone: true } : { row: next, gone: false };
  });
  const onScreen = new Set(shown.map((s) => s.row.id));
  return { rows, waiting: fresh.filter((row) => !onScreen.has(row.id)).length };
}
