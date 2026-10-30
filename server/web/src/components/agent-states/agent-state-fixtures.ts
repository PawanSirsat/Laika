/**
 * The example data for the agent states on `/design/states` (LAI-536).
 *
 * **Gallery only.** Every name, device, key and SHA here is made up to show a
 * state, and this module is imported by `AgentStateGallery.tsx` alone, which
 * `StateGallery` loads with `import()` — so these strings live in their own
 * chunk, fetched only when somebody opens `/design/states`.
 * `test/components/agent/agent-gallery-bundle.test.ts` builds the SPA and
 * proves no other chunk carries one. They never stand in for an endpoint
 * (D-032): no live screen imports this file.
 *
 * Type-only imports, so `node --test` can read it.
 */

import type { AgentChoice } from '../agent/AgentPicker.tsx';
import type { PanelAgent, PanelCheckpoint } from '../agent/ExecutionPanel.tsx';
import type { ContextRevision, ContextSession } from '../agent/ContextRevisions.tsx';
import type { HandoffItem } from '../agent/handoff-inbox.ts';
import type { ProjectGrant } from '../agent/RegistrationStep.tsx';
import type { ExecutionState } from '../agent/agent-states.ts';

export const OWNER = 'Ada Okafor';
export const OTHER_OWNER = 'Sam Reyes';

export const LAPTOP: PanelAgent = { client: 'claude-code', device: 'laptop-1', owner: OWNER };
export const DESKTOP: PanelAgent = { client: 'codex', device: 'desktop-2', owner: OWNER };
export const SAMS: PanelAgent = { client: 'cursor', device: 'studio-mac', owner: OTHER_OWNER };

export const CARD_TITLE = 'Parse nested lists in the importer';
export const TASK_KEY = 'LAI-142';

/** One card per execution state, with the short fact each would carry. */
export const CARD_STATES: readonly {
  readonly state: ExecutionState;
  readonly detail: string;
  readonly title: string;
}[] = [
  { state: 'waiting_for_agent', detail: 'picked 3 min ago', title: 'Retry webhook deliveries' },
  { state: 'waiting_for_approval', detail: 'Sam Reyes to approve', title: 'Split the export job' },
  { state: 'working', detail: 'seen 20 s ago', title: CARD_TITLE },
  { state: 'connection_lost', detail: 'last seen 2 min ago', title: 'Cache the board query' },
  {
    state: 'recovery_available',
    detail: 'from a save 9 min ago',
    title: 'Fix the sprint rollover',
  },
  { state: 'save_needs_attention', detail: 'commit did not match', title: 'Move tags to a table' },
  {
    state: 'verification_pending',
    detail: 'no push notice yet',
    title: 'Rename the status column',
  },
];

export const AGENT_CHOICES: readonly AgentChoice[] = [
  {
    id: 'ag-laptop',
    client: 'claude-code',
    owner: OWNER,
    device: 'laptop-1',
    availability: 'available',
  },
  { id: 'ag-desktop', client: 'codex', owner: OWNER, device: 'desktop-2', availability: 'offline' },
  {
    id: 'ag-studio',
    client: 'cursor',
    owner: OTHER_OWNER,
    device: 'studio-mac',
    availability: 'available',
  },
  {
    id: 'ag-runner',
    client: 'gemini-cli',
    owner: OWNER,
    device: 'ci-runner',
    availability: 'unavailable',
    reason: 'Not granted on this space',
  },
  {
    id: 'ag-old',
    client: 'opencode',
    owner: OTHER_OWNER,
    device: 'old-laptop',
    availability: 'unavailable',
    reason: 'Revoked',
  },
];

const VERIFIED_SHA = '9f3c2a17be0d4c6e8a51f27d3b9e40c6a1d5f8e2';
const NEWER_SHA = 'c41d7e09a2b35f86d1e04c7b9a2f63e85d0c1b47';

export const VERIFIED: PanelCheckpoint = {
  summary: 'Importer handles two levels of nesting; deeper still fails',
  age: '12 min ago',
  verification: 'verified',
  note: 'current',
  sha: VERIFIED_SHA,
};

export const VERIFIED_OLD_NOTE: PanelCheckpoint = { ...VERIFIED, note: 'earlier' };

export const VERIFIED_NO_NOTE: PanelCheckpoint = {
  ...VERIFIED,
  summary: 'Saved without a written note',
  note: 'missing',
};

export const PENDING: PanelCheckpoint = {
  summary: 'Deeper nesting passes; two tests still red',
  age: '1 min ago',
  verification: 'pending',
  note: 'current',
  sha: NEWER_SHA,
};

export const HANDOFF_REASON = 'Out of context window — a fresh session continues';
export const HANDOFF_NOTE =
  'Done: two-level nesting. Next: recursion for deeper levels. Failing: importer.nested.test 3 and 4.';

export const INBOX: readonly HandoffItem[] = [
  {
    id: 'h1',
    kind: 'work_request',
    direction: 'received',
    taskKey: 'LAI-151',
    taskTitle: 'Retry webhook deliveries',
    from: null,
    to: LAPTOP,
    state: 'Open',
    yourMove: true,
    needsApproval: false,
    age: '3 min ago',
  },
  {
    id: 'h2',
    kind: 'recovery',
    direction: 'received',
    taskKey: 'LAI-148',
    taskTitle: 'Fix the sprint rollover',
    from: null,
    to: null,
    state: 'Open',
    yourMove: true,
    needsApproval: false,
    age: '9 min ago',
  },
  {
    id: 'h3',
    kind: 'handoff',
    direction: 'sent',
    taskKey: TASK_KEY,
    taskTitle: CARD_TITLE,
    from: LAPTOP,
    to: DESKTOP,
    state: 'Offered — waiting for it to accept',
    yourMove: false,
    needsApproval: false,
    age: '1 min ago',
  },
  {
    id: 'h4',
    kind: 'handoff',
    direction: 'received',
    taskKey: 'LAI-139',
    taskTitle: 'Split the export job',
    from: SAMS,
    to: DESKTOP,
    state: 'Waiting for your approval',
    yourMove: true,
    needsApproval: true,
    age: '20 min ago',
  },
  {
    id: 'h5',
    kind: 'work_request',
    direction: 'sent',
    taskKey: 'LAI-133',
    taskTitle: 'Cache the board query',
    from: null,
    to: SAMS,
    state: 'Expired',
    yourMove: false,
    needsApproval: false,
    age: '2 h ago',
  },
];

export const REVISIONS: readonly ContextRevision[] = [
  {
    revision: 14,
    author: OWNER,
    age: '2 h ago',
    summary: 'Release checklist and the new branch rule',
  },
  {
    revision: 13,
    author: OTHER_OWNER,
    age: 'yesterday',
    summary: 'Importer owns the CSV parser now',
  },
  { revision: 12, author: OWNER, age: '3 days ago', summary: 'First brief for the importer work' },
];

export const CONTEXT_SESSIONS: readonly ContextSession[] = [
  { id: 's1', agent: LAPTOP, received: 14 },
  { id: 's2', agent: DESKTOP, received: 12 },
  { id: 's3', agent: SAMS, received: null },
];

/** An agent is named by its harness and device (D-120), never a typed name. */
export const AGENT_NAME = 'Claude Code · laptop-1';

export const GRANTS: readonly ProjectGrant[] = [
  { id: 'p1', name: 'Importer', scope: 'full' },
  { id: 'p2', name: 'Billing', scope: 'read_only' },
  { id: 'p3', name: 'Website', scope: 'none' },
];

/** Not a token, and not shaped like one: tokens start `lai_`. */
export const EXAMPLE_SECRET = 'EXAMPLE-shown-once-in-the-real-wizard';

export const VERIFIED_DETAIL =
  'A request signed with this agent’s token arrived from Claude Code on laptop-1, 10 s ago.';
export const WAITING_DETAIL =
  'Run laika agent session start on laptop-1. This page updates when the request arrives.';
export const FAILED_DETAIL =
  'A request arrived from laptop-1 signed with your own token, not this agent’s. Check LAIKA_TOKEN in the agent’s environment.';
