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
  type ActivityStep,
} from './activity-state.ts';
import type { ChipTone } from './DesignChip.tsx';
import { DesignChip } from './DesignChip.tsx';
import { DxIcon } from './DxIcon.tsx';
import '../../connect/connect.css';
import './activity.css';

export interface ActivityTabProps {
  /** This board's address: step 4's command, and the OpenTelemetry block. */
  readonly origin: string;
  /** `org.developer_insights.set`: step 1 is a switch for whoever holds it. */
  readonly canSetInsights: boolean;
  /** The grants have answered, so a switch is never offered and then taken away. */
  readonly insightsSettled: boolean;
  readonly onNavigate: (to: string) => void;
}

const HEADLINE_TONE: Readonly<Record<ActivityHeadline['kind'], ChipTone>> = {
  off: 'warn',
  'not-set-up': 'accent',
  collecting: 'ok',
};

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
 * It reads again when the reader comes back to the tab — steps 2 to 5 finish
 * on their machine, not here.
 */
export function ActivityTab({
  origin,
  canSetInsights,
  insightsSettled,
  onNavigate,
}: ActivityTabProps) {
  const model = useShareActivity();
  const { reload } = model;
  const [devices, setDevices] = useState<readonly Device[] | undefined>(undefined);
  const [devicesError, setDevicesError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [insightsError, setInsightsError] = useState<string | undefined>(undefined);
  const commandRef = useRef<HTMLPreElement | null>(null);

  const loadDevices = useCallback((signal?: AbortSignal) => {
    listDevices(signal)
      .then((page) => {
        setDevices(page.data);
        setDevicesError(null);
        setNow(Date.now());
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setDevicesError(cause);
      });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadDevices(controller.signal);
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      loadDevices(controller.signal);
      reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [loadDevices, reload]);

  const setInsights = (on: boolean): void => {
    setInsightsBusy(true);
    setInsightsError(undefined);
    updateOrg({ developer_insights: on })
      .then(() => {
        reload();
      })
      .catch((cause: unknown) => {
        setInsightsError(cause instanceof Error ? cause.message : 'That change was refused.');
      })
      .finally(() => {
        setInsightsBusy(false);
      });
  };

  if (model.state.kind === 'error') {
    return (
      <div className="dx dev-activity">
        <ApiErrorState
          error={new Error(model.state.message)}
          resource="your activity setting"
          onRetry={reload}
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
            loadDevices();
          }}
        />
      </div>
    );
  }
  if (model.state.kind === 'loading' || devices === undefined) {
    return (
      <div className="dx dev-activity">
        <LoadingState shape="card" count={2} label="Loading your activity setup" />
      </div>
    );
  }

  const { sharing, held, permissions } = model.state;
  const inputs = {
    orgEnabled: sharing.org_enabled,
    devices,
    lastReceivedAt: held.last_received_at,
    collectors: held.collectors,
    now,
  };
  const steps = activitySteps(inputs);
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
              checked={sharing.org_enabled}
              labelledBy="dx-activity-org-name"
              describedBy="dx-activity-org-line"
              disabled={insightsBusy}
              onChange={setInsights}
            >
              {sharing.org_enabled ? 'On' : 'Off'}
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
                {...(step.state === 'pending' ? {} : { 'data-state': step.state })}
              >
                {step.state === 'done' ? <DxIcon name="check" size={16} /> : i + 1}
              </span>
              <div className="dx-flow-text">
                <strong
                  className="dx-flow-name"
                  {...(step.key === 'org' ? { id: 'dx-activity-org-name' } : {})}
                >
                  <span className="visually-hidden">
                    {`Step ${String(i + 1)}, ${step.state === 'done' ? 'done' : step.state === 'active' ? 'next' : 'later'}: `}
                  </span>
                  {step.name}
                </strong>
                <span
                  className="dx-flow-line"
                  {...(step.key === 'org' ? { id: 'dx-activity-org-line' } : {})}
                >
                  {withCode(step.line)}
                </span>
                {step.key === 'org' &&
                  !sharing.org_enabled &&
                  insightsSettled &&
                  !canSetInsights && (
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
          {sharing.org_enabled && (
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
