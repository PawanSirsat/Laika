import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { listAgentDevices, type AgentDevice } from '../../../../api/agent-devices.ts';
import { agentLabel } from '../../../../api/selected-agent.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { Help } from '../../../../components/wizard/Help.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { StatusChip, type StatusTone } from '../../../../components/wizard/StatusChip.tsx';
import { StepRail, type RailStep } from '../../../../components/wizard/StepRail.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
// The wizard parts are still styled by Connect's sheet (LAI-1044); a V3 screen
// that renders them says so itself rather than relying on Connect being bundled.
import '../../connect/connect.css';
import {
  OVERVIEW_ADDRESSES,
  STEP_NAMES,
  overviewState,
  overviewSummary,
  toolActivity,
  toolAddress,
  type JourneyStep,
  type OverviewState,
  type ToolActivity,
} from './overview-state.ts';
import './v3.css';

export interface OverviewTabProps {
  readonly onNavigate: (to: string) => void;
  /** Where *Set up a project* goes; `preview` sends it to the new flow (LAI-1052). */
  readonly projectsHref?: string;
}

const ACTIVITY: Readonly<Record<ToolActivity, { tone: StatusTone; word: string }>> = {
  active: { tone: 'ok', word: 'Active' },
  idle: { tone: 'neutral', word: 'Idle' },
  offline: { tone: 'warn', word: 'Offline' },
  'not-connected': { tone: 'waiting', word: 'Not connected yet' },
};

/** An in-app link: a real `href`, and a plain click stays in the page. */
function AppLink({
  href,
  className,
  primary = false,
  onNavigate,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  /** The view's main action — where focus goes when the view changes under it. */
  readonly primary?: boolean;
  readonly onNavigate: (to: string) => void;
  readonly children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  };
  return (
    <a
      href={href}
      className={className}
      onClick={onClick}
      {...(primary ? { 'data-primary': '' } : {})}
    >
      {children}
    </a>
  );
}

/**
 * Developer access V3 → Overview (LAI-1048, plan §B, §J slice D1).
 *
 * **Quiet on a first visit, out of the way after it.** Someone with no tool
 * that has reached the board yet sees three steps — add a device, add a tool,
 * set up a project — with the next one marked and a single *Continue*. The
 * steps are worked out from `GET /agents/devices` every time
 * (`overview-state.ts`), so they resume where the reader is, not where a
 * browser remembers them being.
 *
 * Once a tool has connected there is no funnel: the page is a summary of
 * their devices and tools, and *Set up a project* is the first action.
 *
 * It reads again when the reader comes back to the tab — the step that sends
 * them away (running a command on their machine) finishes elsewhere — and a
 * change is announced through the throttled live region.
 */
export function OverviewTab({
  onNavigate,
  projectsHref = OVERVIEW_ADDRESSES.projects,
}: OverviewTabProps) {
  const [devices, setDevices] = useState<readonly AgentDevice[] | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [message, announce] = useLiveRegion();
  const spoken = useRef<string | undefined>(undefined);
  const root = useRef<HTMLDivElement | null>(null);
  const shownKind = useRef<OverviewState['kind'] | undefined>(undefined);

  const load = useCallback((signal?: AbortSignal): void => {
    listAgentDevices(signal)
      .then(({ data }) => {
        setDevices(data);
        setError(null);
        setNow(Date.now());
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setError(cause);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') load(controller.signal);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const state = useMemo(
    () => (devices === undefined ? undefined : overviewState(devices)),
    [devices],
  );

  // The first answer is what the page shows; a later one that changes it is news.
  useEffect(() => {
    if (state === undefined) return;
    const said = overviewSummary(state);
    if (spoken.current !== undefined && spoken.current !== said) announce(said);
    spoken.current = said;
  }, [state, announce]);

  /*
   * A refetch can swap the view under the reader — the journey becomes the
   * summary the moment their first tool connects — and the link they were on
   * (*Continue*) goes with it, which leaves focus on `body`. Then focus goes
   * to the new view's main action. Focus anywhere else is left alone.
   */
  useEffect(() => {
    if (state === undefined) return;
    const before = shownKind.current;
    shownKind.current = state.kind;
    if (before === undefined || before === state.kind) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (!lost) return;
    root.current?.querySelector<HTMLElement>('[data-primary]')?.focus();
  }, [state]);

  return (
    <div className="dev-body dev-overview" data-testid="dev-overview" ref={root}>
      <LiveRegion message={message} />
      {error !== null ? (
        <ApiErrorState
          error={error}
          resource="your devices"
          scope="organisation"
          onRetry={() => {
            setError(null);
            load();
          }}
        />
      ) : state === undefined ? (
        <LoadingState shape="card" count={1} label="Loading your developer access" />
      ) : state.kind === 'first-run' ? (
        <FirstRun state={state} onNavigate={onNavigate} />
      ) : (
        <Returning state={state} now={now} onNavigate={onNavigate} projectsHref={projectsHref} />
      )}
      <section className="dev-card dev-how" aria-labelledby="dev-how-title">
        <div className="dev-card-head">
          <h2 className="dev-card-title" id="dev-how-title">
            How this works
          </h2>
        </div>
        <div className="dev-how-body">
          <p>
            A <strong>device</strong> is a computer you work on. Each coding <strong>tool</strong>{' '}
            on it gets its own credential, so you can see which tool did what and disconnect one
            without touching the others.
          </p>
          <p>
            A tool reaches only the projects you give it. <strong>Project setup</strong> writes the
            short block a repository&apos;s instructions file needs, once per project.
          </p>
          <Help>
            Scripts and the API still use personal tokens, under{' '}
            <AppLink href="/developer?tab=advanced" onNavigate={onNavigate}>
              Advanced
            </AppLink>
            .
          </Help>
        </div>
      </section>
    </div>
  );
}

function FirstRun({
  state,
  onNavigate,
}: {
  readonly state: Extract<OverviewState, { kind: 'first-run' }>;
  readonly onNavigate: (to: string) => void;
}) {
  const order: readonly JourneyStep[] = ['device', 'tool', 'project'];
  const current = order.indexOf(state.next) + 1;
  const rail: RailStep[] = state.steps.map((s, i) => ({
    n: i + 1,
    name: STEP_NAMES[s.step],
    sub: s.sub,
    done: s.done,
    open: s.done || s.step === state.next,
    ...(s.step === 'project' ? { lockedReason: 'A tool must connect first' } : {}),
  }));
  const addressOf = (n: number): string | undefined => {
    if (n === 1) return OVERVIEW_ADDRESSES.addDevice;
    if (n === 2) return state.resume;
    return undefined;
  };

  return (
    <section className="dev-card dev-journey" aria-labelledby="dev-journey-title">
      <div className="dev-card-head">
        <h2 className="dev-card-title" id="dev-journey-title">
          Get started
        </h2>
        <span className="conn-chip conn-chip-scope">Once per device</span>
      </div>
      <div className="dev-journey-body">
        <StepRail
          label="Getting started"
          intro="Three steps. Your place is kept on the board, so you can stop and come back from any computer."
          steps={rail}
          current={current}
          onSelect={(n) => {
            const to = addressOf(n);
            if (to !== undefined) onNavigate(to);
          }}
        />
        <div className="dev-journey-next">
          <h3 className="dev-journey-next-title">
            <span className="visually-hidden">Next: </span>
            {STEP_NAMES[state.next]}
          </h3>
          {state.next === 'device' ? (
            <p>
              Register the first coding tool on the computer you work on. That computer becomes your
              first device.
            </p>
          ) : state.pending !== undefined ? (
            <p>
              <strong>{agentLabel(state.pending)}</strong> is registered, but its credential has not
              reached the board yet. Finish setting it up on that device.
            </p>
          ) : (
            <p>Add a coding tool on your device.</p>
          )}
          <AppLink
            href={state.resume}
            className="bar-control bar-control-primary dev-journey-continue"
            primary
            onNavigate={onNavigate}
          >
            Continue
          </AppLink>
        </div>
      </div>
    </section>
  );
}

function Returning({
  state,
  now,
  onNavigate,
  projectsHref,
}: {
  readonly state: Extract<OverviewState, { kind: 'returning' }>;
  readonly now: number;
  readonly onNavigate: (to: string) => void;
  readonly projectsHref: string;
}) {
  return (
    <section className="dev-card dev-summary" aria-labelledby="dev-summary-title">
      <div className="dev-card-head dev-summary-head">
        <h2 className="dev-card-title" id="dev-summary-title">
          Your devices and tools
        </h2>
        <div className="dev-summary-actions">
          <AppLink
            href={OVERVIEW_ADDRESSES.addTool}
            className="bar-control"
            onNavigate={onNavigate}
          >
            Add a tool
          </AppLink>
          <AppLink
            href={projectsHref}
            className="bar-control bar-control-primary"
            primary
            onNavigate={onNavigate}
          >
            Set up a project
          </AppLink>
        </div>
      </div>
      <dl className="dev-summary-facts">
        <div>
          <dt>Devices</dt>
          <dd>{state.devices}</dd>
        </div>
        <div>
          <dt>Tools</dt>
          <dd>{state.tools.length}</dd>
        </div>
        <div>
          <dt>Projects they can reach</dt>
          <dd>{state.projects}</dd>
        </div>
      </dl>
      {state.notConnected > 0 && (
        <Help tone="warn" className="dev-summary-note">
          {state.notConnected === 1
            ? 'One tool has not connected yet.'
            : `${String(state.notConnected)} tools have not connected yet.`}{' '}
          Open it below to finish setting it up.
        </Help>
      )}
      <ul className="dev-summary-tools" aria-label="Your tools">
        {state.tools.map((agent) => {
          const activity = toolActivity(agent, now);
          const look = ACTIVITY[activity];
          const reason =
            agent.last_seen_at === null
              ? 'No request from it yet'
              : `Last seen ${timeLabel(agent.last_seen_at, now).text}`;
          return (
            <li key={agent.id}>
              <AppLink
                href={toolAddress(agent.id)}
                className="dev-summary-tool"
                onNavigate={onNavigate}
              >
                {agentLabel(agent)}
              </AppLink>
              <StatusChip tone={look.tone} word={look.word} reason={reason} />
            </li>
          );
        })}
      </ul>
      <p className="dev-summary-more">
        <AppLink href={OVERVIEW_ADDRESSES.devices} onNavigate={onNavigate}>
          Manage devices and tools
        </AppLink>
      </p>
    </section>
  );
}
