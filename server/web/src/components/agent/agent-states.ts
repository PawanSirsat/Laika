/**
 * The words for every agent state the proposal names (LAI-536, proposal §6).
 *
 * **Plain data, no JSX**, so a `node --test` can read it and a live screen
 * (LAI-538, LAI-543, LAI-549, LAI-550) can take the same words when its
 * endpoint lands. Every exceptional state is spelled out here in text: the
 * components draw an icon beside the words and never let a colour carry the
 * meaning on its own.
 */

/** What a task's execution is doing, as a card and the drawer say it. */
export const EXECUTION_STATES = [
  'waiting_for_agent',
  'waiting_for_approval',
  'working',
  'connection_lost',
  'recovery_available',
  'save_needs_attention',
  'verification_pending',
] as const;

export type ExecutionState = (typeof EXECUTION_STATES)[number];

/** Each state's label and the one line that says what it means. */
export const EXECUTION_STATE_WORDS: Readonly<
  Record<ExecutionState, { readonly label: string; readonly meaning: string }>
> = {
  waiting_for_agent: {
    label: 'Waiting for agent',
    meaning: 'An agent was picked. Nothing has accepted the work yet.',
  },
  waiting_for_approval: {
    label: 'Waiting for approval',
    meaning: 'A hand-off to another owner needs a person to approve it first.',
  },
  working: {
    label: 'Working',
    meaning: 'An agent session holds the task and is checking in.',
  },
  connection_lost: {
    label: 'Connection lost',
    meaning: 'The agent stopped checking in. Its claim expires if it does not return.',
  },
  recovery_available: {
    label: 'Recovery available',
    meaning: 'The claim expired. Another agent can continue from the last verified save.',
  },
  save_needs_attention: {
    label: 'Save needs attention',
    meaning: 'The saved work could not be fetched or did not match. A person has to look.',
  },
  verification_pending: {
    label: 'Verification pending',
    meaning: 'The save is registered. GitHub has not confirmed the push yet.',
  },
};

/**
 * A claim the expiry scan marked `expired` (LAI-541, LAI-543). Not one of the
 * states above: it is a fact about the claim, and what follows it — a
 * recovery offer — is Phase 3 (LAI-546). Nothing gives the claim back by
 * itself, and the words say so.
 */
export const CLAIM_EXPIRED_WORDS = {
  label: 'Claim expired',
  meaning: 'The agent must reclaim explicitly; nothing was restored automatically.',
} as const;

/** How a picked agent can be reached, as the Agent picker says it. */
export type AgentAvailability = 'available' | 'offline' | 'unavailable';

export const AVAILABILITY_WORDS: Readonly<Record<AgentAvailability, string>> = {
  available: 'Available',
  offline: 'Offline',
  unavailable: 'Cannot be picked',
};

/** What the written note says about the save it travels with (proposal §4.3). */
export type NoteState = 'current' | 'earlier' | 'missing';

export const NOTE_WORDS: Readonly<Record<NoteState, string>> = {
  current: 'Note describes this save',
  earlier: 'Note describes an earlier save',
  missing: 'No continuation note',
};

/**
 * What a checkpoint's proof is — D-116's four states, `task_checkpoints.
 * verification` (SPEC §4.70), each worded as §4.70's *What the UI says*.
 */
export type CheckpointVerification = 'verified' | 'pending' | 'ref_deleted' | 'uncertain';

export const VERIFICATION_WORDS: Readonly<Record<CheckpointVerification, string>> = {
  verified: 'Verified',
  pending: 'Verification pending',
  ref_deleted: 'Save removed from GitHub',
  uncertain: 'Save needs attention — GitHub’s notices do not match a single clean save',
};

/**
 * `pending` past §9.1.1's ten-minute notice — `pending_notice`, which the
 * server decides on its own clock, never this page's (SPEC §4.70).
 */
export const PENDING_NOTICE_WORDS = 'Verification pending — no push notice from GitHub yet';

/** The pointer §4.70 gives owners and admins beside {@link PENDING_NOTICE_WORDS}. */
export const PENDING_NOTICE_HINT =
  'Open the repository webhook’s Recent Deliveries on GitHub, find the push for this save and choose Redeliver.';

/** No checkpoint at all: never an automatic path (SPEC §4.73, proposal §4.4). */
export const NO_CHECKPOINT = 'Automatic recovery unavailable — no saved checkpoint';

/** Saves exist, and none is verified: still no automatic path (§4.73). */
export const NO_VERIFIED_CHECKPOINT = 'Automatic recovery unavailable — no verified checkpoint';

/** What a person does instead (§4.73): reassign it, or release it to the backlog. */
export const RECOVERY_BY_HAND = 'A person reassigns this task or releases it to the backlog.';

/** The dialog's promise, verbatim from proposal §6. */
export const RECEIVER_MUST_ACCEPT = 'The receiver must accept';

/** The three kinds of offer an inbox carries (`handoff_offers.kind`). */
export const HANDOFF_KINDS = ['work_request', 'handoff', 'recovery'] as const;
export type HandoffKind = (typeof HANDOFF_KINDS)[number];

export const HANDOFF_KIND_WORDS: Readonly<Record<HandoffKind, string>> = {
  work_request: 'Work request',
  handoff: 'Hand-off',
  recovery: 'Recovery offer',
};

/** Inbox → Hand-offs filters, in order (proposal §6). */
export const HANDOFF_FILTERS = ['received', 'sent', 'needs_approval', 'recovery'] as const;
export type HandoffFilter = (typeof HANDOFF_FILTERS)[number];

export const HANDOFF_FILTER_WORDS: Readonly<Record<HandoffFilter, string>> = {
  received: 'Received',
  sent: 'Sent',
  needs_approval: 'Needs approval',
  recovery: 'Recovery',
};

/** The registration wizard's five steps (proposal §6). */
export const REGISTRATION_STEPS = [
  'Harness and device',
  'Projects and permissions',
  'Credential',
  'Harness instructions',
  'Verify a request from this agent',
] as const;

/**
 * Three facts about a registered agent, **kept apart**: a credential that
 * exists has not necessarily been used, and an agent that has connected may
 * still not be able to take over work.
 */
export const READINESS = ['credential_created', 'connected', 'ready_for_recovery'] as const;
export type Readiness = (typeof READINESS)[number];

export const READINESS_WORDS: Readonly<
  Record<Readiness, { readonly label: string; readonly done: string; readonly notYet: string }>
> = {
  credential_created: {
    label: 'Credential created',
    done: 'A token exists for this agent. It is shown once and not stored in the clear.',
    notYet: 'No token yet.',
  },
  connected: {
    label: 'Connected',
    done: 'Laika has seen a request signed with this agent’s token.',
    notYet: 'Laika has not seen a request from this agent yet.',
  },
  ready_for_recovery: {
    label: 'Ready for recovery',
    done: 'The helper is running and can fetch and check a saved commit.',
    notYet: 'The helper has not checked in, so this agent cannot take over work yet.',
  },
};

/**
 * *Credential created*, said of an agent that had a token and has none live:
 * every one expired or was revoked. *No token yet* would be false of it, and
 * *yet* would say it is on its way to one (LAI-318).
 */
export const CREDENTIAL_LAPSED = {
  verdict: 'none live',
  why: 'No live credential: every token for this agent has expired or been revoked. It cannot reach Laika until it is given a new one.',
} as const;

/** The last step's three outcomes: the proof is a request **from this agent's own token**. */
export const VERIFY_STATES = ['waiting', 'verified', 'failed'] as const;
export type VerifyState = (typeof VERIFY_STATES)[number];

export const VERIFY_WORDS: Readonly<Record<VerifyState, string>> = {
  waiting: 'Waiting for a request from this agent',
  verified: 'Verified — this agent reached Laika with its own token',
  failed: 'Not verified yet',
};

/**
 * A project's hand-off policy (proposal §4.5), edited on Settings → Access.
 * The defaults are the proposal's.
 */
export interface HandoffPolicy {
  readonly allowOtherOwners: boolean;
  readonly crossOwnerRequiresApproval: boolean;
  readonly maxHandoffs: number;
  readonly offerTtlMinutes: number;
}

export const DEFAULT_HANDOFF_POLICY: HandoffPolicy = {
  allowOtherOwners: false,
  crossOwnerRequiresApproval: true,
  maxHandoffs: 3,
  offerTtlMinutes: 30,
};

/** What an offer's lifetime may be set to, in minutes. */
export const OFFER_TTL_CHOICES = [15, 30, 60, 120] as const;

/**
 * Project context (proposal §4.6): what Laika can know is that a revision
 * **reached** a session. It cannot know that the model read or understood it,
 * and nothing here may say so.
 */
export const CONTEXT_RECEIVED_ONLY =
  'Received means the revision reached that session. It does not mean the agent read or understood it.';
