import { useRef, useState, type ReactNode } from 'react';
import { AgentChip } from '../agent/AgentChip.tsx';
import { AgentPicker, choiceLabel, NO_AGENT } from '../agent/AgentPicker.tsx';
import { AgentReadiness, RegistrationSteps } from '../agent/AgentRegistration.tsx';
import { ExecutionPanel, type PanelAgent } from '../agent/ExecutionPanel.tsx';
import { ExecutionStateLine } from '../agent/ExecutionStateLine.tsx';
import { HandoffDialog } from '../agent/HandoffDialog.tsx';
import { HandoffInbox } from '../agent/HandoffInbox.tsx';
import type { ExecutionState, HandoffFilter } from '../agent/agent-states.ts';
import {
  AGENT_CHOICES,
  CARD_STATES,
  CARD_TITLE,
  DESKTOP,
  HANDOFF_NOTE,
  HANDOFF_REASON,
  INBOX,
  LAPTOP,
  OTHER_OWNER,
  OWNER,
  PENDING,
  SAMS,
  TASK_KEY,
  VERIFIED,
  VERIFIED_NO_NOTE,
  VERIFIED_OLD_NOTE,
} from './agent-state-fixtures.ts';
import './agent-state-gallery.css';

/**
 * The **proposed** agent UI as reviewable states (LAI-536, proposal §6 and
 * §4.8) — drawn before any live screen is built, so the owner can argue with
 * it and pick the agent colour (D-020) having seen it.
 *
 * Loaded by `StateGallery` with `import()`, so this file and its example data
 * are their own chunk and reach the browser only on `/design/states`.
 *
 * The cards borrow the board card's own classes (`board.css`, which the board
 * already puts in the app's stylesheet) so the chip is judged where it will
 * live. Nothing on a live screen changes here.
 */
export default function AgentStateGallery() {
  return (
    <section className="agent-gallery" aria-labelledby="agent-gallery-heading" data-agent-gallery>
      <h2 id="agent-gallery-heading" className="gallery-heading">
        Agents — proposed
      </h2>
      <p className="gallery-sub">
        Proposed for agent identities and hand-off (LAI-532). Neutral chips until the agent colour
        is chosen. Every exceptional state is written out, never shown by colour alone.
      </p>
      <div className="gallery-grid">
        <Specimen
          id="chip"
          title="Card — agent chip beside the person"
          note="The avatar stays the assignee. The chip is the agent picked to do the work."
        >
          <GalleryCard title={CARD_TITLE} taskKey={TASK_KEY} agent={LAPTOP} byAgent={false} />
        </Specimen>
        <Specimen
          id="chip-and-badge"
          title="Card — chip and the existing agent badge"
          note="The badge on the avatar still means written through an agent (created via MCP). The chip means an agent is picked to do it. Both can be true."
        >
          <GalleryCard title={CARD_TITLE} taskKey={TASK_KEY} agent={LAPTOP} byAgent />
          <p className="agent-gallery-legend">
            Badge on the avatar: <i>written by {OWNER}’s agent</i>. Chip: <i>picked to do it</i>.
          </p>
        </Specimen>
        <Specimen
          id="card-states"
          title="Card — execution states"
          note="Text and a shape on every one. Grey in both themes until the colour is decided."
          wide
        >
          <div className="agent-gallery-cards">
            {CARD_STATES.map((c) => (
              <GalleryCard
                key={c.state}
                title={c.title}
                taskKey={TASK_KEY}
                agent={c.state === 'waiting_for_approval' ? SAMS : LAPTOP}
                byAgent={false}
                state={c.state}
                detail={c.detail}
              />
            ))}
          </div>
        </Specimen>
        <Specimen
          id="picker"
          title="Drawer — Agent row under Assignee"
          note="The app's Dropdown. Owner and device on every agent; one that cannot be picked says why."
        >
          <DrawerRows />
        </Specimen>
        <Specimen
          id="panel-working"
          title="Drawer — execution panel, working"
          note="Intended agent, the session actually working, last seen, the latest verified save and its age."
        >
          <ExecutionPanel
            state="working"
            intended={LAPTOP}
            session={LAPTOP}
            lastSeen="20 s ago"
            checkpoint={VERIFIED}
            generation={4}
          />
        </Specimen>
        <Specimen
          id="panel-earlier-note"
          title="Drawer — note describes an earlier save"
          note="A newer save is still unverified and shown beside the verified one, never instead of it."
        >
          <ExecutionPanel
            state="verification_pending"
            intended={LAPTOP}
            session={LAPTOP}
            lastSeen="40 s ago"
            checkpoint={VERIFIED_OLD_NOTE}
            pendingCheckpoint={PENDING}
            generation={4}
          />
        </Specimen>
        <Specimen
          id="panel-no-note"
          title="Drawer — no continuation note, connection lost"
          note="The save is real; nobody wrote what it is for."
        >
          <ExecutionPanel
            state="connection_lost"
            intended={LAPTOP}
            session={LAPTOP}
            lastSeen="2 min ago"
            checkpoint={VERIFIED_NO_NOTE}
            generation={4}
          />
        </Specimen>
        <Specimen
          id="panel-no-checkpoint"
          title="Drawer — recovery, nothing saved"
          note="No checkpoint: no automatic path. A person reassigns or releases the task."
        >
          <ExecutionPanel
            state="recovery_available"
            intended={LAPTOP}
            session={null}
            lastSeen="6 min ago"
            checkpoint={null}
            generation={4}
          />
        </Specimen>
        <Specimen
          id="panel-offered"
          title="Drawer — after offering"
          note="The sender sees offered, never accepted on the receiver’s behalf."
        >
          <ExecutionPanel
            state="working"
            intended={DESKTOP}
            session={LAPTOP}
            lastSeen="10 s ago"
            checkpoint={VERIFIED}
            handoff={`Offered to Codex · desktop-2 — waiting for it to accept`}
            generation={4}
          />
        </Specimen>
        <Specimen
          id="dialog"
          title="Hand-off dialog"
          note="From → to, reason, the save and when, the note, approval. Focus is held inside and returns to the button."
        >
          <DialogLaunchers />
        </Specimen>
        <Specimen
          id="inbox"
          title="Inbox — Hand-offs"
          note="Counts are open items that need your action. A work request and a recovery offer say which they are."
          wide
        >
          <InboxSpecimen />
        </Specimen>
        <Specimen
          id="wizard"
          title="Agents tab — registration steps"
          note="Five steps. Here, on the third: the credential."
        >
          <RegistrationSteps current={2} />
        </Specimen>
        <Specimen
          id="credential-created"
          title="Agents tab — credential created"
          note="A token exists. Nothing has called in with it."
        >
          <AgentReadiness reached={new Set(['credential_created'])} />
        </Specimen>
        <Specimen
          id="connected"
          title="Agents tab — connected"
          note="A request from this agent arrived. It cannot take over work yet."
        >
          <AgentReadiness reached={new Set(['credential_created', 'connected'])} />
        </Specimen>
        <Specimen
          id="ready"
          title="Agents tab — ready for recovery"
          note="The helper is running and can fetch and check a save."
        >
          <AgentReadiness
            reached={new Set(['credential_created', 'connected', 'ready_for_recovery'])}
          />
        </Specimen>
      </div>
    </section>
  );
}

function Specimen({
  id,
  title,
  note,
  wide,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly note: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <article
      className={wide === true ? 'gallery-item agent-gallery-wide' : 'gallery-item'}
      data-specimen={id}
    >
      <header>
        <h3 className="gallery-item-title">{title}</h3>
        <p className="gallery-item-note">{note}</p>
      </header>
      <div className="gallery-stage agent-gallery-stage">{children}</div>
    </article>
  );
}

function GalleryCard({
  title,
  taskKey,
  agent,
  byAgent,
  state,
  detail,
}: {
  readonly title: string;
  readonly taskKey: string;
  readonly agent: PanelAgent;
  readonly byAgent: boolean;
  readonly state?: ExecutionState;
  readonly detail?: string;
}) {
  return (
    <article className="card agent-gallery-card" data-gallery-card={state ?? 'plain'}>
      <p className="card-title t-body">{title}</p>
      {state !== undefined && <ExecutionStateLine state={state} detail={detail} />}
      <div className="card-foot">
        <span className="card-key">{taskKey}</span>
        <span className="card-spacer" />
        <AgentChip {...agent} />
        <span className="card-who">
          <span className="card-avatar t-avatar agent-gallery-avatar" title={OWNER}>
            AO
          </span>
          {byAgent && (
            <span className="card-bot" title={`Written by ${OWNER}'s agent`} data-mcp-badge>
              <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.4" aria-hidden="true">
                <rect x="4" y="8" width="16" height="12" rx="3" />
                <path d="M12 4v4M9 14h.01M15 14h.01" strokeLinecap="round" />
              </svg>
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

function DrawerRows() {
  const [agent, setAgent] = useState<string>('ag-laptop');
  const picked = AGENT_CHOICES.find((a) => a.id === agent);
  return (
    <div className="agent-gallery-drawer">
      <div className="agent-picker">
        <span className="agent-row-label">Assignee</span>
        <span className="agent-gallery-person">{OWNER}</span>
      </div>
      <AgentPicker agents={AGENT_CHOICES} value={agent} onChange={setAgent} />
      <p className="agent-gallery-legend" data-picked={agent}>
        {agent === NO_AGENT || picked === undefined
          ? 'Human only.'
          : `Picked: ${choiceLabel(picked)}.`}{' '}
        Agents {OTHER_OWNER} owns need approval before they can accept.
      </p>
    </div>
  );
}

function DialogLaunchers() {
  const [open, setOpen] = useState<'same' | 'cross' | null>(null);
  const [offered, setOffered] = useState<string | null>(null);
  const same = useRef<HTMLButtonElement>(null);
  const cross = useRef<HTMLButtonElement>(null);
  return (
    <div className="agent-gallery-launchers">
      <button
        ref={same}
        type="button"
        className="button button-secondary"
        data-open-handoff="same"
        onClick={() => {
          setOpen('same');
        }}
      >
        Offer to Codex · desktop-2
      </button>
      <button
        ref={cross}
        type="button"
        className="button button-secondary"
        data-open-handoff="cross"
        onClick={() => {
          setOpen('cross');
        }}
      >
        Offer to another owner’s agent
      </button>
      <p className="agent-gallery-legend" role="status">
        {offered ?? 'Nothing offered yet.'}
      </p>
      {open !== null && (
        <HandoffDialog
          taskKey={TASK_KEY}
          from={LAPTOP}
          to={open === 'same' ? DESKTOP : SAMS}
          reason={HANDOFF_REASON}
          checkpoint={{ summary: VERIFIED.summary, savedAt: VERIFIED.age }}
          note={HANDOFF_NOTE}
          approver={open === 'same' ? null : OWNER}
          onCancel={() => {
            setOpen(null);
          }}
          onOffer={() => {
            setOffered(
              open === 'same'
                ? 'Offered — waiting for Codex · desktop-2 to accept.'
                : `Waiting for ${OWNER} to approve.`,
            );
            setOpen(null);
          }}
          restoreFocus={() => (open === 'same' ? same.current : cross.current)}
        />
      )}
    </div>
  );
}

function InboxSpecimen() {
  const [filter, setFilter] = useState<HandoffFilter>('received');
  return <HandoffInbox items={INBOX} filter={filter} onFilter={setFilter} />;
}
