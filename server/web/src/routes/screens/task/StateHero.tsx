import type { ReactNode } from 'react';
import type { ActivityEvent } from '../../../api/activity.ts';
import { sessionHarnessName } from '../../../api/agent-session.ts';
import { shortRange } from '../../../api/estimates.ts';
import type { HandoffOffer } from '../../../api/handoffs.ts';
import {
  roundAgentName,
  safeHttpUrl,
  shortSha,
  waitingFor,
  type TaskRounds,
} from '../../../api/review.ts';
import { agentLabel, agentProductName } from '../../../api/selected-agent.ts';
import type { TaskSummary } from '../../../api/tasks.ts';
import { timeLabel } from '../../../api/time-label.ts';
import {
  ageWords,
  heartbeatAge,
  liveConnection,
} from '../../../components/agent/execution-derive.ts';
import {
  confirmedSentence,
  heroKind,
  openWorkRequest,
  progressFraction,
  reviewFacts,
  workingFor,
  workingSince,
} from './hero-derive.ts';
import { firstLine } from './feed-groups.ts';
import { TaskMarkdown } from './TaskMarkdown.tsx';
import type { MentionCandidate } from './LazyRichEditor.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import './hero.css';

export interface StateHeroProps {
  readonly task: TaskSummary;
  /** The task's rounds, read once by the panel; `undefined` while it reads. */
  readonly rounds: TaskRounds | undefined;
  readonly activity: readonly ActivityEvent[];
  /** `GET /tasks/:id/handoff-offers`, for when a work request went out. */
  readonly offers: readonly HandoffOffer[];
  readonly nameOf: (userId: string) => string;
  /** The page's own clock for the live claim (LAI-597): Live turns to Connection lost on it. */
  readonly claimNow: number;
  /** Offer Approve / Send back (D-129 item 5); the server still decides. */
  readonly mayDecide: boolean;
  readonly deciding: 'accept' | 'send_back' | null;
  readonly decideError: string | undefined;
  readonly onApprove: () => void;
  readonly onSendBack: (opener: HTMLElement) => void;
  /** The rail's Ping, when this reader may ping the agent; nothing otherwise. */
  readonly ping?: ReactNode;
  /** Move to the rail's agent picker. Absent for a reader who may not change it. */
  readonly onChangeAgent?: (() => void) | undefined;
  readonly people?: readonly MentionCandidate[] | undefined;
  readonly meId?: string | undefined;
}

function Fact({
  label,
  value,
  sub,
  tone,
  children,
}: {
  readonly label: string;
  readonly value?: ReactNode;
  readonly sub?: ReactNode;
  readonly tone?: string | undefined;
  readonly children?: ReactNode;
}) {
  return (
    <div className="hero-fact">
      <span className="hero-fact-label">{label}</span>
      {value !== undefined && (
        <span
          className={tone === undefined ? 'hero-fact-value' : `hero-fact-value hero-tone-${tone}`}
        >
          {value}
        </span>
      )}
      {children}
      {sub !== undefined && sub !== '' && <span className="hero-fact-sub">{sub}</span>}
    </div>
  );
}

/**
 * The state panel at the top of the task detail (§11.4.2.1, D-129): one per
 * status — in review, in progress, sent back, waiting for an agent, done —
 * drawn only from what the server sends. The proof's detail, the saves and
 * the hand-off stay in their own sections; this says where the task stands.
 */
export function StateHero({
  task,
  rounds,
  activity,
  offers,
  nameOf,
  claimNow,
  mayDecide,
  deciding,
  decideError,
  onApprove,
  onSendBack,
  ping,
  onChangeAgent,
  people,
  meId,
}: StateHeroProps) {
  const kind = heroKind(task);
  if (kind === null) return null;
  const now = Date.now();
  const latest = rounds?.rounds[0];

  if (kind === 'review') {
    const facts = latest === undefined ? undefined : reviewFacts(latest);
    const sentence = latest === undefined ? undefined : confirmedSentence(latest);
    const agent = latest === undefined ? null : roundAgentName(latest);
    const when = latest === undefined ? undefined : timeLabel(latest.created_at, now);
    const prHref = facts === undefined ? null : safeHttpUrl(facts.pullRequest.url);
    return (
      <section className="hero hero-review" data-hero="review" aria-labelledby="hero-title">
        <div className="hero-head">
          <span id="hero-title" className="hero-pill hero-pill-warn" role="status">
            Ready for review
          </span>
          {latest !== undefined && when !== undefined && (
            <span className="hero-byline">
              Round {latest.number} · finished by{' '}
              <strong className="hero-strong">{nameOf(latest.finished_by)}</strong>
              {agent !== null && <span className="hero-agent">{agent}</span>}
              <time dateTime={when.iso} title={when.full} className="hero-when">
                {when.text}
              </time>
            </span>
          )}
          {mayDecide && (
            <span className="hero-actions">
              <button
                type="button"
                className="hero-button"
                disabled={deciding !== null}
                onClick={(event) => {
                  onSendBack(event.currentTarget);
                }}
              >
                Send back
              </button>
              <button
                type="button"
                className="hero-button hero-button-primary"
                disabled={deciding !== null}
                onClick={onApprove}
              >
                {deciding === 'accept' && <Spinner size="sm" />}
                Approve
              </button>
            </span>
          )}
        </div>
        {!mayDecide && (
          <p className="hero-why">
            Only the assignee, a space admin or an organisation admin decides this one.
          </p>
        )}
        {decideError !== undefined && (
          <p className="hero-error" role="alert">
            {decideError}
          </p>
        )}
        {latest === undefined ? (
          <p className="hero-quiet">
            {rounds === undefined ? 'Reading the proof…' : 'No finish recorded.'}
          </p>
        ) : (
          <>
            <p className="hero-summary">{firstLine(latest.summary_md)}</p>
            {facts !== undefined && (
              <div className="hero-grid">
                <Fact label="Pull request" sub={facts.pullRequest.merged}>
                  {prHref === null ? (
                    <span className="hero-fact-value">{facts.pullRequest.label}</span>
                  ) : (
                    <a
                      className="hero-fact-value hero-link"
                      href={prHref}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {facts.pullRequest.label}
                    </a>
                  )}
                </Fact>
                <Fact
                  label="CI"
                  value={facts.ci}
                  tone={facts.ciTone}
                  sub={latest.ci === null ? undefined : `on ${shortSha(latest.ci.head_sha)}`}
                />
                <Fact label="Tests" value={facts.tests} sub={facts.testsSub} />
                <Fact label="Commits" value={facts.commits} sub={facts.commitsSub} />
              </div>
            )}
            {sentence !== undefined && (
              <p
                className={`hero-confirmed hero-tone-${sentence.tone}`}
                data-confirmed={sentence.tone}
              >
                {sentence.text}
              </p>
            )}
          </>
        )}
      </section>
    );
  }

  if (kind === 'done') {
    const done = task.completed_at === null ? undefined : timeLabel(task.completed_at, now);
    return (
      <section className="hero hero-done" data-hero="done" aria-labelledby="hero-title">
        <div className="hero-head">
          <span id="hero-title" className="hero-pill hero-pill-ok" role="status">
            Done
          </span>
          {done !== undefined && (
            <span className="hero-byline">
              <time dateTime={done.iso} title={done.full}>
                {done.text}
              </time>
              {latest !== undefined &&
                ` · ${String(rounds?.rounds.length ?? 0)} round${rounds?.rounds.length === 1 ? '' : 's'}`}
            </span>
          )}
        </div>
      </section>
    );
  }

  const claim = task.claim ?? null;
  const live = claim === null ? null : liveConnection(claim, claimNow);
  const claimAgent =
    claim === null
      ? null
      : agentLabel({ harness: claim.harness ?? 'other', device_label: claim.device_label });
  const since = claim === null ? null : workingSince(activity, claim.generation, task.started_at);
  const sessionFacts =
    claim === null ? null : (
      <div className="hero-grid">
        <Fact
          label="Session"
          value={
            claim.harness === null || claim.harness === undefined
              ? 'Not reported'
              : sessionHarnessName(claim.harness)
          }
          sub={claim.harness_version ?? undefined}
        />
        <Fact label="Model" value={claim.model ?? 'Not reported'} tone="mono" />
        <Fact
          label="Connection"
          value={live === 'live' ? 'Live' : 'Connection lost'}
          tone={live === 'live' ? 'ok' : 'failed'}
          sub={`heartbeat ${ageWords(heartbeatAge(claim, claimNow))}`}
        />
        <ProgressFact since={since} now={now} size={task.size} />
      </div>
    );

  if (kind === 'progress' && claim !== null) {
    return (
      <section className="hero hero-progress" data-hero="progress" aria-labelledby="hero-title">
        <div className="hero-head">
          <span
            className={live === 'live' ? 'hero-pulse' : 'hero-pulse hero-pulse-lost'}
            aria-hidden="true"
          />
          <span id="hero-title" className="hero-title" role="status">
            {live === 'live' ? 'Working now' : 'Connection lost'}
            {since !== null && <span className="hero-quiet"> {workingFor(since, now)}</span>}
          </span>
          {ping !== undefined && <span className="hero-actions">{ping}</span>}
        </div>
        <p className="hero-agentline">
          <strong className="hero-strong">{claimAgent}</strong>
          {task.selected_agent?.owner !== undefined && (
            <span className="hero-quiet"> · owned by {task.selected_agent.owner.name}</span>
          )}
        </p>
        {sessionFacts}
      </section>
    );
  }

  const sendBack = task.send_back ?? null;
  if (kind === 'sent_back' && sendBack !== null) {
    const sent = timeLabel(sendBack.created_at, now);
    const prior = latest;
    return (
      <section className="hero hero-sentback" data-hero="sent_back" aria-labelledby="hero-title">
        <div className="hero-head">
          <span id="hero-title" className="hero-pill hero-pill-danger" role="status">
            Sent back
          </span>
          <span className="hero-byline">
            {prior !== undefined && `after round ${String(prior.number)} `}by{' '}
            <strong className="hero-strong">{nameOf(sendBack.decided_by)}</strong>{' '}
            <time dateTime={sent.iso} title={sent.full} className="hero-when">
              {sent.text}
            </time>
          </span>
        </div>
        <div className="hero-reason">
          <TaskMarkdown source={sendBack.reason_md} people={people} meId={meId} />
        </div>
        {claim !== null && (
          <>
            <p className="hero-agentline">
              <span
                className={live === 'live' ? 'hero-pulse' : 'hero-pulse hero-pulse-lost'}
                aria-hidden="true"
              />
              <strong className="hero-strong">
                Round {String((prior?.number ?? 0) + 1)} ·{' '}
                {live === 'live' ? 'working now' : 'connection lost'}
              </strong>
              <span className="hero-agent">{claimAgent}</span>
            </p>
            {sessionFacts}
          </>
        )}
        {claim === null && (
          <p className="hero-quiet">Round {String((prior?.number ?? 0) + 1)} has not started.</p>
        )}
      </section>
    );
  }

  // Waiting: a work request is out to the selected agent (D-114 item 7).
  const agent = task.selected_agent ?? null;
  if (agent === null) return null;
  const request = openWorkRequest(offers, agent.id);
  return (
    <section className="hero hero-waiting" data-hero="waiting" aria-labelledby="hero-title">
      <div className="hero-head">
        <span className="hero-agentmark" aria-hidden="true">
          {agentProductName(agent).slice(0, 1)}
        </span>
        <span className="hero-waiting-text">
          <span id="hero-title" className="hero-title" role="status">
            Waiting for {agentLabel(agent)} to accept
          </span>
          <span className="hero-quiet">
            {request === undefined
              ? 'A work request is out to this agent.'
              : `Work request sent ${waitingFor(request.created_at, now)}${waitingFor(request.created_at, now) === 'just now' ? '' : ' ago'}.`}{' '}
            The task changes only when the agent accepts.
          </span>
        </span>
        <span className="hero-actions">
          {ping}
          {onChangeAgent !== undefined && (
            <button type="button" className="hero-button hero-button-quiet" onClick={onChangeAgent}>
              Change agent
            </button>
          )}
        </span>
      </div>
    </section>
  );
}

/** *18 min of 35 min–1 h*, with a bar against the estimate's high end. */
function ProgressFact({
  since,
  now,
  size,
}: {
  readonly since: number | null;
  readonly now: number;
  readonly size: TaskSummary['size'];
}) {
  const range = size === null ? null : shortRange(size.build_p50_ms, size.build_p80_ms);
  if (since === null)
    return (
      <Fact
        label="Progress"
        value="Not known"
        sub={range === null ? undefined : `estimate ${range}`}
      />
    );
  const elapsed = Math.max(0, now - since);
  const fraction = progressFraction(elapsed, size?.build_p80_ms ?? null);
  const label = workingFor(since, now).replace(/^for /, '');
  return (
    <Fact label="Progress" value={range === null ? label : `${label} of ${range}`}>
      {fraction !== null && (
        <span
          className="hero-bar"
          role="progressbar"
          aria-label="Time spent against the estimate"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
        >
          <span
            className="hero-bar-fill"
            style={{ width: `${String(Math.round(fraction * 100))}%` }}
          />
        </span>
      )}
    </Fact>
  );
}
