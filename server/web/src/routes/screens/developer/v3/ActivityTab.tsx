import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { listDevices, type Device } from '../../../../api/devices.ts';
import { updateOrg } from '../../../../api/org.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { CopyButton } from '../../../../components/CopyButton.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { Spinner } from '../../../../components/Spinner.tsx';
import { Switch } from '../../../../components/Switch.tsx';
import { Tooltip } from '../../../../components/tooltip/Tooltip.tsx';
import {
  ActivityFolds,
  collectionAudience,
  collectionManager,
  ScopeChoice,
  useShareActivity,
} from '../../connect/ShareActivity.tsx';
import {
  activityCommands,
  activityHeadline,
  activitySteps,
  TROUBLES,
  type ActivityHeadline,
  type ActivityInputs,
  type ActivityStep,
} from './activity-state.ts';
import type { ChipTone } from './DesignChip.tsx';
import { DesignChip } from './DesignChip.tsx';
import { DxIcon } from './DxIcon.tsx';
import { StaleNotice } from './StaleNotice.tsx';
import '../../connect/connect.css';
import './activity.css';

export interface ActivityTabProps {
  /** This board's address: step 4's command, and the OpenTelemetry block. */
  readonly origin: string;
  /** `org.developer_insights.set`: step 1 is a switch for whoever holds it. */
  readonly canSetInsights: boolean;
  /** The grants have answered, so a switch is never offered and then taken away. */
  readonly insightsSettled: boolean;
  /** The reader is a viewer: their machines cannot send, so step 4 is locked. */
  readonly readOnly: boolean;
  readonly onNavigate: (to: string) => void;
}

const HEADLINE_TONE: Readonly<Record<ActivityHeadline['kind'], ChipTone>> = {
  off: 'warn',
  'not-set-up': 'accent',
  stalled: 'warn',
  collecting: 'ok',
};

/** How often *4 min ago* moves on by itself. */
const TICK_MS = 30_000;
/**
 * How long the tab waits before asking again while step 5 waits: 20 s, then
 * 60 s and 120 s after one and two failures in a row; an answer resets it
 * (LAI-1327 follow-up).
 */
const POLL_BACKOFF_MS = [20_000, 60_000, 120_000] as const;

/** An in-app link: a real `href`, and a plain click stays in the page. */
function AppLink({
  href,
  className,
  onNavigate,
  children,
}: {
  readonly href: string;
  readonly className?: string;
  readonly onNavigate: (to: string) => void;
  readonly children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  };
  return (
    <a href={href} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

/** A line whose `backticked` spans are commands, set as code. */
function withCode(text: string): ReactNode {
  return text
    .split('`')
    .map((part, i) => (i % 2 === 1 ? <code key={String(i)}>{part}</code> : part));
}

/**
 * Developer access V3 → **Activity** (LAI-1327, the owner's decision): local
 * activity set up as one checklist, each step live (`activity-state.ts`), then
 * what the person chooses and may read — the *Count work in* scope, and the
 * folds *Share local activity* always had, with *It isn't working* after them.
 *
 * - **Step 1 is a switch** for whoever may turn Developer insights on — the
 *   same `PATCH /org {developer_insights}` as Organisation's own, gated
 *   `org.developer_insights.set` and session only on the server — and a line
 *   naming who can, for everyone else.
 * - **Steps 2 and 3 open the Add device and Add tool wizards** where they
 *   live, on Devices and Tools.
 * - **Step 4 is the two commands** for this board, to copy.
 * - **Step 5 is the board's own answer**, `last_received_at`.
 *
 * **It stays current by itself** (LAI-1327 review 1), since steps 2 to 5
 * finish on the reader's machine, not here: it reads everything again when
 * the reader comes back to the window, asks again every 20 s while step 5
 * waits for a report that can arrive — step 4 next: the organisation
 * collects, a device and a tool are there, the reader is no viewer — and the
 * page is in view, backing off to 60 s and 120 s while it fails; and it moves
 * *4 min ago* on every 30 s. A re-read that fails keeps what is shown and says
 * so (`StaleNotice`).
 */
export function ActivityTab({
  origin,
  canSetInsights,
  insightsSettled,
  readOnly,
  onNavigate,
}: ActivityTabProps) {
  const model = useShareActivity();
  const { reload, poll } = model;
  const [devices, setDevices] = useState<readonly Device[] | undefined>(undefined);
  const [devicesError, setDevicesError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState<string | undefined>(undefined);
  /**
   * The organisation's switch as `PATCH /org` answered it, until the next read
   * lands — so the switch never flashes back to where it was.
   */
  const [insightsAnswer, setInsightsAnswer] = useState<boolean | undefined>(undefined);
  const [retrying, setRetrying] = useState(false);
  const commandRef = useRef<HTMLPreElement | null>(null);

  const loadDevices = useCallback(
    (signal?: AbortSignal): Promise<void> =>
      listDevices(signal)
        .then((page) => {
          setDevices(page.data);
          setDevicesError(null);
          setNow(Date.now());
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setDevicesError(cause);
        }),
    [],
  );

  /** Every read again: the reader came back, or asked to retry. */
  const refresh = useCallback(
    (signal?: AbortSignal): Promise<void> =>
      Promise.all([loadDevices(signal), reload()]).then(() => undefined),
    [loadDevices, reload],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadDevices(controller.signal);
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh(controller.signal);
    };
    const onFocus = (): void => {
      void refresh(controller.signal);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadDevices, refresh]);

  useEffect(() => {
    const tick = window.setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);
    return () => {
      window.clearInterval(tick);
    };
  }, []);

  // Any read that lands after the switch's answer replaces it (LAI-1327
  // follow-up): a failed re-read cannot pin the switch, and a change made in
  // another tab shows on the next read.
  useEffect(() => {
    setInsightsAnswer(undefined);
  }, [model.loadedAt]);

  const shown = model.state.kind === 'ready' ? model.state : undefined;
  const orgEnabled = insightsAnswer ?? shown?.sharing.org_enabled ?? false;
  const inputs: ActivityInputs | undefined =
    shown === undefined || devices === undefined
      ? undefined
      : {
          orgEnabled,
          devices,
          lastReceivedAt: shown.held.last_received_at,
          collectors: shown.held.collectors,
          readOnly,
          // Never before the answer shown was read: *4 min ago*, not *-1 min*.
          now: Math.max(now, model.loadedAt ?? 0),
        };
  const steps = inputs === undefined ? undefined : activitySteps(inputs);

  // Ask again only while a report can still arrive: step 4 is next — the
  // organisation collects, a device is paired and a tool connected, the
  // reader is no viewer, and nothing has come yet. Only while the page is in
  // view, and slower while it fails.
  const waiting = steps?.find((step) => step.key === 'command')?.state === 'active';
  useEffect(() => {
    if (!waiting) return undefined;
    let failures = 0;
    let timer = 0;
    let stopped = false;
    const next = (): void => {
      const wait = POLL_BACKOFF_MS[Math.min(failures, POLL_BACKOFF_MS.length - 1)];
      timer = window.setTimeout(() => {
        if (document.visibilityState !== 'visible') {
          next();
          return;
        }
        void poll().then((result) => {
          if (stopped) return;
          if (result === 'fresh') failures = 0;
          if (result === 'failed') failures += 1;
          next();
        });
      }, wait);
    };
    next();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [waiting, poll]);

  const setInsights = (on: boolean): void => {
    setInsightsBusy(true);
    setInsightsError(undefined);
    updateOrg({ developer_insights: on })
      .then((org) => {
        // Shown from the answer at once, as Organisation does; the switch stays
        // busy until the re-read brings the steps that hang on it, and that
        // read — or any later one — replaces the answer.
        setInsightsAnswer(org.developer_insights);
        return reload();
      })
      .catch((cause: unknown) => {
        setInsightsError(cause instanceof Error ? cause.message : 'That change was refused.');
      })
      .finally(() => {
        setInsightsBusy(false);
      });
  };

  const retry = (): void => {
    setRetrying(true);
    void refresh().finally(() => {
      setRetrying(false);
    });
  };

  if (model.state.kind === 'error') {
    return (
      <div className="dx dev-activity">
        <ApiErrorState
          error={new Error(model.state.message)}
          resource="your activity setting"
          onRetry={() => {
            void reload();
          }}
        />
      </div>
    );
  }
  if (devicesError !== null && devices === undefined) {
    return (
      <div className="dx dev-activity">
        <ApiErrorState
          error={devicesError}
          resource="your devices"
          onRetry={() => {
            setDevicesError(null);
            void loadDevices();
          }}
        />
      </div>
    );
  }
  if (shown === undefined || inputs === undefined || steps === undefined) {
    return (
      <div className="dx dev-activity">
        <LoadingState shape="card" count={2} label="Loading your activity setup" />
      </div>
    );
  }

  const { sharing, permissions } = shown;
  const staleCause = model.stale !== undefined ? model.stale.cause : devicesError;
  const headline = activityHeadline(inputs);
  const commands = activityCommands(origin);

  /** Each step's control, after its line: a switch, a link, the commands, or nothing. */
  const control = (step: ActivityStep): ReactNode => {
    if (step.key === 'org') {
      if (!insightsSettled) return null;
      if (canSetInsights) {
        return (
          <div className="dx-activity-switch">
            <Switch
              checked={orgEnabled}
              labelledBy="dx-activity-org-name"
              describedBy="dx-activity-org-line"
              disabled={insightsBusy}
              onChange={setInsights}
            >
              {orgEnabled ? 'On' : 'Off'}
            </Switch>
            {insightsBusy && <Spinner size="sm" />}
          </div>
        );
      }
      return null;
    }
    if (step.action === undefined) return null;
    if (step.locked !== undefined) {
      return (
        <Tooltip content={step.locked}>
          <button type="button" className="dx-btn dx-btn-sm" data-locked-step aria-disabled="true">
            {step.action.label}
            <span className="visually-hidden">{`: ${step.name}. ${step.locked}`}</span>
          </button>
        </Tooltip>
      );
    }
    return (
      <AppLink href={step.action.href} className="dx-btn dx-btn-sm" onNavigate={onNavigate}>
        {step.action.label}
        <span className="visually-hidden">{`: ${step.name}`}</span>
      </AppLink>
    );
  };

  return (
    <div className="dx dev-activity" data-headline={headline.kind}>
      {staleCause !== null && (
        <StaleNotice
          what="your activity setup"
          error={staleCause}
          loadedAt={model.loadedAt}
          retrying={retrying}
          onRetry={retry}
        />
      )}
      <section className="dx-card" aria-labelledby="dx-activity-title" data-checklist="">
        <div className="dx-card-pad dx-activity-head">
          <div className="dx-card-head">
            <h2 className="dx-card-title" id="dx-activity-title">
              Share local activity
            </h2>
            <span data-status-line="">
              <DesignChip tone={HEADLINE_TONE[headline.kind]}>{headline.text}</DesignChip>
            </span>
          </div>
          <p className="dx-card-sub">
            Daily counts from your own machines, on your profile and never a score.{' '}
            {collectionAudience(permissions)} can see them, and you can see who looked.
          </p>
        </div>
        <ol className="dx-flow">
          {steps.map((step, i) => (
            <li
              key={step.key}
              className="dx-flow-row dx-activity-step"
              data-step={step.key}
              data-state={step.state}
            >
              <span
                className="dx-flow-n"
                aria-hidden="true"
                {...(step.state === 'pending'
                  ? {}
                  : { 'data-state': step.attention === true ? 'attention' : step.state })}
              >
                {step.attention === true ? (
                  <DxIcon name="alert" size={16} />
                ) : step.state === 'done' ? (
                  <DxIcon name="check" size={16} />
                ) : (
                  i + 1
                )}
              </span>
              <div className="dx-flow-text">
                <strong
                  className="dx-flow-name"
                  {...(step.key === 'org' ? { id: 'dx-activity-org-name' } : {})}
                >
                  <span className="visually-hidden">
                    {`Step ${String(i + 1)}, ${step.attention === true ? 'needs attention' : step.state === 'done' ? 'done' : step.state === 'active' ? 'next' : 'later'}: `}
                  </span>
                  {step.name}
                </strong>
                <span
                  className="dx-flow-line"
                  {...(step.key === 'org' ? { id: 'dx-activity-org-line' } : {})}
                >
                  {withCode(step.line)}
                </span>
                {step.key === 'org' && !orgEnabled && insightsSettled && !canSetInsights && (
                  <span className="dx-flow-line" data-ask="">
                    Ask {collectionManager(permissions)} to turn it on, in Organisation.
                  </span>
                )}
                {step.key === 'org' && insightsError !== undefined && (
                  <span className="dx-flow-line dx-activity-error" role="alert">
                    {insightsError}
                  </span>
                )}
                {step.state === 'pending' &&
                  step.action === undefined &&
                  step.locked !== undefined && (
                    <span className="dx-flow-line dx-activity-locked" data-locked="">
                      {step.locked}
                    </span>
                  )}
                {step.key === 'command' && step.state !== 'pending' && (
                  <div className="conn-block dx-activity-command">
                    <div className="conn-block-bar">
                      <span className="conn-block-label" id="dx-activity-command-label">
                        On that machine — no credential to paste
                      </span>
                      <CopyButton text={commands} selects={commandRef} what="the commands" />
                    </div>
                    <pre
                      className="conn-pre"
                      ref={commandRef}
                      tabIndex={0}
                      aria-labelledby="dx-activity-command-label"
                      data-commands=""
                    >
                      {commands}
                    </pre>
                  </div>
                )}
              </div>
              {control(step)}
            </li>
          ))}
        </ol>
      </section>

      <section className="dx-card" aria-labelledby="dx-activity-more" data-activity-more="">
        <div className="dx-card-pad dx-activity-more">
          <h2 className="visually-hidden" id="dx-activity-more">
            Your choice, and what it sends
          </h2>
          {orgEnabled && (
            <ScopeChoice
              scope={sharing.scope}
              busy={model.busy}
              setupTabName="Project setup"
              onChange={model.change}
            />
          )}
          <ActivityFolds model={model} origin={origin}>
            <details className="dev-fold" data-fold="trouble">
              <summary>
                <span className="dev-fold-title">It isn’t working</span>
                <span className="dev-fold-sub">What the collector says, and what to do</span>
              </summary>
              <div className="dev-fold-body">
                <dl className="dx-activity-troubles">
                  {TROUBLES.map((trouble) => (
                    <div
                      key={trouble.key}
                      className="dx-activity-trouble"
                      data-trouble={trouble.key}
                    >
                      <dt>{withCode(trouble.says)}</dt>
                      <dd>{withCode(trouble.fix)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </details>
          </ActivityFolds>
          {model.error !== undefined && (
            <p className="conn-note conn-note-warn" role="alert">
              {model.error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
