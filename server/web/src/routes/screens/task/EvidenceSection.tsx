import { useEffect, useState } from 'react';
import {
  ciLine,
  ciVerdict,
  evidenceSummary,
  roundAgentName,
  getTaskRounds,
  safeHttpUrl,
  shortSha,
  type EvidenceState,
  type Round,
  type TaskRounds,
} from '../../../api/review.ts';
import { type TaskSendBack } from '../../../api/tasks.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { InfoTip } from '../profile/InfoTip.tsx';
import type { MentionCandidate } from './LazyRichEditor.tsx';
import { TaskMarkdown } from './TaskMarkdown.tsx';
import '../profile/profile.css';
import './evidence.css';

export interface EvidenceSectionProps {
  readonly taskId: string;
  /**
   * Re-read when this changes. The panel passes the task's `updated_at`,
   * which the board's store keeps current from the live stream, so a finish
   * or a send-back elsewhere redraws the proof without a poll of its own.
   */
  readonly refreshKey: number;
  /** The send-back the task carries, from the task itself (§6.4). */
  readonly sendBack: TaskSendBack | null;
  /** A person's name for an id, as the surrounding screen knows them. */
  readonly nameOf: (userId: string) => string;
  /** Draw nothing until the task has been finished at least once. */
  readonly hideWhenEmpty?: boolean | undefined;
  /** Whose `@` mention in a send-back is a pill, and who is reading (LAI-868). */
  readonly people?: readonly MentionCandidate[] | undefined;
  readonly meId?: string | undefined;
}

/**
 * A constant rather than JSX text: `endpoint-coverage.test.ts` scans source
 * for the client's call sites, and the label followed by a closing tag reads
 * to it as one.
 */
const PULL_REQUEST = 'Pull request';

const STATE_HINT: Record<EvidenceState, string> = {
  claimed: 'The agent said so. GitHub has not confirmed it yet.',
  confirmed: 'GitHub confirmed it.',
  failed: 'GitHub checked it, and it did not hold.',
};

/** One item's state, as a small badge (D-082): `claimed` until something checks it. */
export function StateBadge({ state }: { readonly state: EvidenceState }) {
  return (
    <span className={`ev-state ev-state-${state}`} title={STATE_HINT[state]}>
      {state}
    </span>
  );
}

/** A test run's exit code: green for 0, red for anything else. */
export function ExitCode({ code }: { readonly code: number }) {
  return (
    <span
      className={code === 0 ? 'ev-exit ev-exit-pass' : 'ev-exit ev-exit-fail'}
      title={code === 0 ? 'Exited 0: passed' : `Exited ${String(code)}: failed`}
    >
      <span aria-hidden="true">{code === 0 ? '✓' : '✗'}</span> exit {code}
    </span>
  );
}

/** The (i) beside the section: what a round and a state are. */
export function ProofInfo() {
  return (
    <InfoTip label="About proof">
      <dl className="prof-defs">
        <div>
          <dt>Round</dt>
          <dd>One finish. Sent back and finished again is round 2; earlier rounds are kept.</dd>
        </div>
        <div>
          <dt>claimed</dt>
          <dd>What the agent said it did. Nothing has checked it yet.</dd>
        </div>
        <div>
          <dt>confirmed · failed</dt>
          <dd>
            What GitHub reported: the commit was pushed, the pull request exists, CI passed or
            failed. Laika reads the webhook; it never calls GitHub.
          </dd>
        </div>
        <div>
          <dt>CI</dt>
          <dd>
            GitHub&rsquo;s checks for the round&rsquo;s head commit. A typed command cannot be
            matched to a CI job, so every test takes CI&rsquo;s answer.
          </dd>
        </div>
      </dl>
    </InfoTip>
  );
}

/** One round's proof: who finished it, then each item with its state. */
export function RoundProof({
  round,
  nameOf,
  now,
}: {
  readonly round: Round;
  readonly nameOf: (userId: string) => string;
  readonly now: number;
}) {
  const summary = evidenceSummary(round);
  // D-120: the agent as `<harness> · <device>`, never the client's own word.
  const agent = roundAgentName(round);
  const when = timeLabel(round.created_at, now);
  const pr = round.pull_request;
  const prHref = pr === null ? null : safeHttpUrl(pr.url);
  return (
    <div className="ev-round" data-round={round.number}>
      <p className="ev-by">
        <span className="ev-round-number">Round {round.number}</span>
        <span>
          Finished by <strong className="ev-agent">{agent ?? nameOf(round.finished_by)}</strong>
          {agent !== null && <> for {nameOf(round.finished_by)}</>}
        </span>
        <time className="ev-when" dateTime={when.iso} title={when.full}>
          {when.text}
        </time>
      </p>

      {summary.empty ? (
        <p className="panel-muted ev-none">No proof attached to this finish.</p>
      ) : (
        <dl className="ev-list">
          {round.commits.length > 0 && (
            <div className="ev-group">
              <dt className="ev-label">
                Commits <span className="ev-count">{round.commits.length}</span>
              </dt>
              <dd>
                <ul className="ev-items">
                  {round.commits.map((commit) => (
                    <li key={commit.id} className="ev-item">
                      <code className="ev-sha" title={commit.sha}>
                        {shortSha(commit.sha)}
                      </code>
                      {commit.message !== null && <span className="ev-text">{commit.message}</span>}
                      <StateBadge state={commit.state} />
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          )}
          {round.branch !== null && (
            <div className="ev-group">
              <dt className="ev-label">Branch</dt>
              <dd className="ev-item">
                <code className="ev-code">{round.branch.name}</code>
                <StateBadge state={round.branch.state} />
              </dd>
            </div>
          )}
          {pr !== null && (
            <div className="ev-group">
              <dt className="ev-label">{PULL_REQUEST}</dt>
              <dd className="ev-item">
                {prHref === null ? (
                  <span className="ev-text">{pr.url}</span>
                ) : (
                  <a className="ev-link" href={prHref} target="_blank" rel="noopener noreferrer">
                    {pr.url.replace(/^https?:\/\//, '')}
                  </a>
                )}
                {pr.merged !== null && (
                  <span className={pr.merged ? 'ev-merged ev-merged-yes' : 'ev-merged'}>
                    {pr.merged ? 'merged' : 'not merged'}
                  </span>
                )}
                <StateBadge state={pr.state} />
              </dd>
            </div>
          )}
          {round.tests.length > 0 && (
            <div className="ev-group">
              <dt className="ev-label">
                Tests{' '}
                <span className="ev-count">
                  {summary.testsPassed} passed · {summary.testsFailed} failed
                </span>
              </dt>
              <dd>
                <ul className="ev-items">
                  {round.tests.map((test) => (
                    <li key={test.id} className="ev-item">
                      <code className="ev-code ev-command">{test.command}</code>
                      <ExitCode code={test.exit_code} />
                      <StateBadge state={test.state} />
                    </li>
                  ))}
                </ul>
                {round.ci !== null && <CiLine round={round} />}
              </dd>
            </div>
          )}
          {round.tests.length === 0 && round.ci !== null && (
            <div className="ev-group">
              <dt className="ev-label">CI</dt>
              <dd>
                <CiLine round={round} />
              </dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

/** GitHub's CI for the round's head commit, as one line (D-083). */
export function CiLine({ round }: { readonly round: Round }) {
  if (round.ci === null) return null;
  const verdict = ciVerdict(round);
  return (
    <p className={`ev-ci ev-ci-${verdict}`} data-ci={verdict}>
      <span className="ev-ci-line">{ciLine(round.ci)}</span>
      <code className="ev-ci-sha" title={round.ci.head_sha}>
        on {shortSha(round.ci.head_sha)}
      </code>
    </p>
  );
}

/** The current send-back, read first (§4.27). */
export function SendBackNote({
  sendBack,
  nameOf,
  now,
  people,
  meId,
}: {
  readonly sendBack: TaskSendBack;
  readonly nameOf: (userId: string) => string;
  readonly now: number;
  readonly people?: readonly MentionCandidate[] | undefined;
  readonly meId?: string | undefined;
}) {
  const when = timeLabel(sendBack.created_at, now);
  return (
    <div className="ev-sendback" role="note" aria-label="Sent back">
      <p className="ev-sendback-head">
        <span className="ev-sendback-label">
          <span aria-hidden="true">↩</span> Sent back
        </span>
        <span>by {nameOf(sendBack.decided_by)}</span>
        <time className="ev-when" dateTime={when.iso} title={when.full}>
          {when.text}
        </time>
      </p>
      <div className="ev-sendback-body">
        <TaskMarkdown source={sendBack.reason_md} people={people} meId={meId} />
      </div>
    </div>
  );
}

/**
 * The proof on a task (D-082, LAI-758): the send-back it carries, first, then
 * the latest round with every item and its state, and earlier rounds folded.
 * Reads `GET /tasks/:id/rounds`, again whenever `refreshKey` changes.
 */
export function EvidenceSection({
  taskId,
  refreshKey,
  sendBack,
  nameOf,
  hideWhenEmpty,
  people,
  meId,
}: EvidenceSectionProps) {
  const [rounds, setRounds] = useState<TaskRounds | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const now = Date.now();

  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    getTaskRounds(taskId, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setRounds(answer);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
    };
  }, [taskId, refreshKey]);

  const latest = rounds?.rounds[0];
  const earlier = rounds?.rounds.slice(1) ?? [];

  if (hideWhenEmpty === true && sendBack === null && rounds !== undefined && latest === undefined) {
    return null;
  }

  return (
    <section className="panel-section ev" aria-label="Proof" data-section="proof">
      <h3 className="panel-section-title ev-title">
        Proof
        {latest !== undefined && <span className="panel-count">round {latest.number}</span>}
        <ProofInfo />
      </h3>

      {sendBack !== null && (
        <SendBackNote sendBack={sendBack} nameOf={nameOf} now={now} people={people} meId={meId} />
      )}

      {failed ? (
        <p className="panel-alert" role="alert">
          Could not load the proof for this task.
        </p>
      ) : rounds === undefined ? (
        <p className="panel-muted" aria-busy="true">
          Loading proof…
        </p>
      ) : latest === undefined ? (
        <p className="panel-muted ev-none">
          Not finished yet. An agent attaches proof when it calls finish_task.
        </p>
      ) : (
        <>
          <RoundProof round={latest} nameOf={nameOf} now={now} />
          {earlier.length > 0 && (
            <details className="ev-earlier">
              <summary>
                Earlier {earlier.length === 1 ? 'round' : 'rounds'} ({earlier.length})
              </summary>
              {earlier.map((round) => (
                <RoundProof key={round.id} round={round} nameOf={nameOf} now={now} />
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
