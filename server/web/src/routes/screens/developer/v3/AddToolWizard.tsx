import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { RegisteredAgent } from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import { ApiError } from '../../../../api/errors.ts';
import type { MeProfile } from '../../../../api/me.ts';
import {
  addToolToDevice,
  getAgentVerification,
  getToolSetup,
  reconnectAgent,
  type AgentVerification,
  type ToolSetup,
} from '../../../../api/tool-setup.ts';
import { CheckIcon } from '../../../../components/wizard/CheckIcon.tsx';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import { Help } from '../../../../components/wizard/Help.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { StatusChip } from '../../../../components/wizard/StatusChip.tsx';
import { StepRail } from '../../../../components/wizard/StepRail.tsx';
import { ToolTile } from '../../../../components/wizard/ToolTile.tsx';
import { WizardCard } from '../../../../components/wizard/WizardCard.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import { CheckpointConsentSwitch } from '../CheckpointConsentSwitch.tsx';
import {
  POLL_FIRST_MS,
  nextPollDelay,
  pairedDevice,
  toolAddCommand,
  toolRefusal,
  type ToolRefusal,
} from './add-flow.ts';
import {
  MODE_MEANING,
  MODE_WORDS,
  catalogGroups,
  catalogTool,
  type ToolCapability,
} from './tool-catalog.ts';
import { checkLines, readiness, readinessSummary } from './tool-readiness.ts';
import '../../connect/connect.css';
import './add-wizards.css';

export interface AddToolWizardProps {
  readonly devices: readonly Device[] | undefined;
  readonly me: MeProfile | undefined;
  readonly canManage: boolean;
  /** `?device=`: a device to start on, when it is one of the reader's paired ones. */
  readonly initialDeviceId: string | undefined;
  /** `?tool=`: a tool to start on — a catalog slug, as Connect's guide ids are. */
  readonly initialTool: string | undefined;
  /** `?reconnect=`: give this agent a new credential on its paired device. */
  readonly reconnectId: string | undefined;
  /** `?exchange=`: an exchange to resume after a reload. */
  readonly resumeExchange: string | undefined;
  /** The exchange goes into the address once there is one, so a reload resumes it. */
  readonly onExchange: (id: string | undefined) => void;
  /** No paired device to add to: pair one, keeping the tool. */
  readonly onAddDevice: (deviceId: string | undefined, tool: string | undefined) => void;
  /** A legacy duplicate pair stands in the way: go to it in the conflicts section. */
  readonly onResolveConflict: (agentId: string) => void;
  /** Project setup, for this agent. */
  readonly onSetUpProject: (agentId: string) => void;
  readonly onClose: (changed: boolean) => void;
}

type Step = 1 | 2 | 3;

const STEP_NAMES: Readonly<Record<Step, string>> = {
  1: 'Choose the tool',
  2: 'Run it and check',
  3: 'Finish',
};

interface Setup {
  readonly agent: RegisteredAgent;
  readonly exchange: ToolSetup;
  readonly command: string;
  /**
   * The live credentials redeeming revokes, as the board said when it made
   * the exchange; `undefined` for one resumed after a reload, where only its
   * `purpose` is known.
   */
  readonly revokes: readonly string[] | undefined;
  readonly device: Device;
  readonly tool: ToolCapability;
}

/**
 * *Add tool* and *Reconnect* (LAI-1061, plan LAI-1042 §E.2, §E.3, §F.4, §H,
 * §M).
 *
 * 1. **Choose** a paired device and a tool. Each tool says, before it is
 *    picked, what Laika can honestly do with it — automatic, MCP only,
 *    manual, or unverified — and the list is the catalog's, never a count.
 * 2. **Run** the command the board returned on the device: it redeems the
 *    exchange with the device's own key and writes the credential to a 0600
 *    file there. **The browser never sees the secret.** Below it, the checks,
 *    asked of `GET /agents/:id/verification` with backoff: each passes only
 *    on evidence from this tool's own credential, and says what is missing.
 * 3. **Finish**: checkpoint consent for a tool that has sessions — offered,
 *    off until given — and *Set up a project* next.
 *
 * A reconnect skips step 1: `POST /agents/:id/reconnect` makes a `rotate`
 * exchange for the agent's own paired device, and the same command and
 * checks follow.
 */
export function AddToolWizard({
  devices,
  me,
  canManage,
  initialDeviceId,
  initialTool,
  reconnectId,
  resumeExchange,
  onExchange,
  onAddDevice,
  onResolveConflict,
  onSetUpProject,
  onClose,
}: AddToolWizardProps) {
  const ids = useId();
  const [message, announce] = useLiveRegion();
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const paired = (devices ?? []).filter(pairedDevice);
  const unpaired = (devices ?? []).filter((d) => d.status === 'active' && d.paired_at === null);
  const [deviceId, setDeviceId] = useState<string | undefined>(initialDeviceId);
  const device =
    paired.find((d) => d.id === deviceId) ?? (paired.length === 1 ? paired[0] : undefined);
  const [harness, setHarness] = useState<string | undefined>(catalogTool(initialTool)?.harness);
  const tool = catalogTool(harness);

  const [setup, setSetup] = useState<Setup | undefined>(undefined);
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<ToolRefusal | undefined>(undefined);
  const [verification, setVerification] = useState<AgentVerification | undefined>(undefined);
  const [pollTrouble, setPollTrouble] = useState<string | undefined>(undefined);
  const changed = useRef(false);

  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  const begin = useCallback(
    (made: {
      readonly agent: RegisteredAgent;
      readonly exchange: ToolSetup;
      readonly command: string;
      readonly revokes_on_redeem?: readonly string[];
    }): void => {
      const on = (devices ?? []).find((d) => d.id === made.exchange.device_id);
      const capability = catalogTool(made.agent.harness);
      if (on === undefined || capability === undefined) {
        setRefusal({ message: 'This tool’s device or kind is not one this page can set up.' });
        return;
      }
      changed.current = true;
      setSetup({
        agent: made.agent,
        exchange: made.exchange,
        command: made.command,
        revokes: made.revokes_on_redeem,
        device: on,
        tool: capability,
      });
      setVerification(undefined);
      setStep(2);
      onExchange(made.exchange.id);
    },
    [devices, onExchange],
  );

  // A reconnect, or an exchange to resume: once the devices are in, once — and
  // only what the address said when the wizard opened. The exchange this page
  // makes goes into the address too, and is not one to resume.
  const opened = useRef({ resumeExchange, reconnectId }).current;
  const started = useRef(false);
  useEffect(() => {
    if (started.current || devices === undefined) return;
    const { resumeExchange: resume, reconnectId: reconnecting } = opened;
    if (resume !== undefined) {
      started.current = true;
      getToolSetup(resume)
        .then((exchange) => {
          const agent = devices.flatMap((d) => d.agents).find((a) => a.id === exchange.agent_id);
          if (agent === undefined) throw new ApiError('not_found', 'No such tool setup', 404);
          begin({ agent, exchange, command: toolAddCommand(agent.harness, exchange.id) });
        })
        .catch((cause: unknown) => {
          onExchange(undefined);
          setRefusal(toolRefusal(cause, 'this tool'));
        });
    } else if (reconnecting !== undefined) {
      started.current = true;
      setBusy(true);
      reconnectAgent(reconnecting)
        .then(begin)
        .catch((cause: unknown) => {
          setRefusal(toolRefusal(cause, 'this tool'));
        })
        .finally(() => {
          setBusy(false);
        });
    }
  }, [devices, opened, begin, onExchange]);

  const add = (): void => {
    if (device === undefined || tool === undefined) return;
    setBusy(true);
    setRefusal(undefined);
    addToolToDevice(device.id, tool.harness)
      .then(begin)
      .catch((cause: unknown) => {
        setRefusal(toolRefusal(cause, tool.name));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  // The checks, asked again with backoff until the tool is Ready.
  const agentId = setup?.agent.id;
  const exchangeId = setup?.exchange.id;
  const current =
    verification === undefined || setup === undefined
      ? undefined
      : readiness(verification, setup.tool);
  const done = current?.key === 'ready';
  const lastSeen = useRef('');
  useEffect(() => {
    if (agentId === undefined || exchangeId === undefined || done) return;
    const controller = new AbortController();
    let delay = POLL_FIRST_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let exchangeOpen = true;
    const tick = (first: boolean): void => {
      const reads: [Promise<AgentVerification>, Promise<ToolSetup | undefined>] = [
        getAgentVerification(agentId, controller.signal),
        exchangeOpen ? getToolSetup(exchangeId, controller.signal) : Promise.resolve(undefined),
      ];
      Promise.all(reads)
        .then(([v, exchange]) => {
          const key = JSON.stringify([v.checks, v.last_seen_at, exchange?.state]);
          const moved = key !== lastSeen.current;
          lastSeen.current = key;
          setPollTrouble(undefined);
          setVerification(v);
          if (exchange !== undefined) {
            exchangeOpen = exchange.state === 'open';
            setSetup((s) => (s?.exchange.id === exchange.id ? { ...s, exchange } : s));
          }
          delay = first ? POLL_FIRST_MS : nextPollDelay(delay, moved, false);
          timer = setTimeout(() => {
            tick(false);
          }, delay);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          const limited = cause instanceof ApiError && cause.code === 'rate_limited';
          setPollTrouble(
            limited
              ? 'The board asked us to slow down; still checking.'
              : 'Could not reach the board just now; still trying.',
          );
          delay = nextPollDelay(delay, false, limited);
          timer = setTimeout(() => {
            tick(false);
          }, delay);
        });
    };
    tick(true);
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [agentId, exchangeId, done]);

  const lines =
    verification === undefined || setup === undefined
      ? undefined
      : checkLines(verification, setup.tool, setup.device.display_name);
  useEffect(() => {
    if (current === undefined || lines === undefined || setup === undefined) return;
    announce(readinessSummary(current, lines, setup.tool.name));
  }, [current, lines, setup, announce]);

  const close = (): void => {
    onClose(changed.current);
  };

  let body: ReactNode = null;
  let primary: ReactNode = null;
  let hint = '';
  let line = '';

  if (step === 1) {
    line = 'A coding tool on one of your paired devices. It gets a credential of its own.';
    const already =
      device !== undefined && tool !== undefined
        ? device.agents.find((a) => a.status === 'active' && a.harness === tool.harness)
        : undefined;
    body =
      devices === undefined ? (
        <p className="dv3w-quiet">Loading your devices…</p>
      ) : paired.length === 0 ? (
        <div className="dv3w-stack" data-no-paired>
          <p>
            <strong>Pair a device first.</strong> A tool is added to a device this board knows by
            its key, so its credential can be fetched there and nowhere else.
          </p>
          {tool !== undefined && (
            <p data-kept-tool={tool.harness}>
              {tool.name} is kept: once the device is paired, you add it there.
            </p>
          )}
          {unpaired.length > 0 && (
            <Help>
              {unpaired.map((d) => d.display_name).join(', ')}{' '}
              {unpaired.length === 1 ? 'is' : 'are'} imported, not paired yet.
            </Help>
          )}
        </div>
      ) : (
        <div className="dv3w-stack">
          <fieldset className="dv3w-set">
            <legend className="conn-label">Device</legend>
            {paired.map((d) => (
              <label key={d.id} className="dv3w-option">
                <input
                  type="radio"
                  name={`${ids}-device`}
                  checked={device?.id === d.id}
                  onChange={() => {
                    setDeviceId(d.id);
                  }}
                />
                <span>
                  {d.display_name}{' '}
                  <span className="dv3w-quiet">
                    — {d.kind === 'cloud' ? 'Cloud' : 'Local'}, paired
                  </span>
                </span>
              </label>
            ))}
            {unpaired.map((d) => (
              <div key={d.id} className="dv3w-option dv3w-option-off">
                <span>
                  {d.display_name} <span className="dv3w-quiet">— imported, not paired</span>
                </span>
                <button
                  type="button"
                  className="conn-link-button"
                  onClick={() => {
                    onAddDevice(d.id, harness);
                  }}
                >
                  Pair {d.display_name}
                </button>
              </div>
            ))}
          </fieldset>

          <fieldset
            className="conn-picker dv3w-picker"
            role="radiogroup"
            aria-labelledby={`${ids}-tools`}
          >
            <legend className="conn-label" id={`${ids}-tools`}>
              Coding tool
            </legend>
            {catalogGroups().map((group) => (
              <div key={group.mode} className="conn-group" data-mode={group.mode}>
                <h3 className="conn-group-title">
                  {MODE_WORDS[group.mode]}
                  <span className="dv3w-mode-meaning">{MODE_MEANING[group.mode]}</span>
                </h3>
                <div className="conn-agents">
                  {group.tools.map((t) => (
                    <ToolTile
                      key={t.harness}
                      id={t.harness}
                      name={t.name}
                      client={t.harness}
                      beta={t.harness === 'antigravity'}
                      checked={harness === t.harness}
                      group={`${ids}-tool`}
                      onChange={setHarness}
                    />
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
          {already !== undefined && tool !== undefined && device !== undefined && (
            <Help tone="info">
              {tool.name} is already on {device.display_name}. This gives it a new credential, which
              replaces the current one when the device fetches it.
            </Help>
          )}
        </div>
      );
    hint =
      paired.length === 0
        ? 'Pair a device, then come back.'
        : device === undefined
          ? 'Choose a device.'
          : tool === undefined
            ? 'Choose a tool.'
            : `Next, the command to run on ${device.display_name}.`;
    primary =
      devices !== undefined && paired.length === 0 ? (
        <button
          type="button"
          className="conn-continue"
          onClick={() => {
            onAddDevice(undefined, harness);
          }}
        >
          Add a device <span aria-hidden="true">→</span>
        </button>
      ) : (
        <button
          type="button"
          className="conn-continue"
          disabled={device === undefined || tool === undefined || busy || !canManage}
          aria-busy={busy || undefined}
          onClick={add}
        >
          Get the command <span aria-hidden="true">→</span>
        </button>
      );
  } else if (setup !== undefined && step === 2) {
    const { exchange, tool: t, device: d } = setup;
    line = `On ${d.display_name}, in a terminal.`;
    const expired = exchange.state === 'expired' || exchange.state === 'cancelled';
    body = (
      <div className="dv3w-stack">
        {expired && lines?.find((l) => l.id === 'credential_installed')?.state !== 'pass' ? (
          <div className="dv3w-error" role="alert">
            <p>
              This command {exchange.state === 'expired' ? 'expired' : 'was replaced'} before{' '}
              {d.display_name} used it.
            </p>
            <button
              type="button"
              className="bar-control"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                (reconnectId === undefined
                  ? addToolToDevice(d.id, t.harness)
                  : reconnectAgent(setup.agent.id)
                )
                  .then(begin)
                  .catch((cause: unknown) => {
                    setRefusal(toolRefusal(cause, t.name));
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              Get a new command
            </button>
          </div>
        ) : (
          <>
            <CodeBlock
              label={`On ${d.display_name}`}
              labelId={`${ids}-command`}
              text={setup.command}
              what="the command"
              main
            />
            <Help>
              No secret is in this command. {d.display_name} fetches {t.name}’s credential with its
              own key and keeps it in a file only you can read; it never passes through this
              browser. The command works once, for ten minutes.
            </Help>
            {setup.revokes !== undefined && setup.revokes.length > 0 ? (
              <Help tone="warn">
                <span data-revokes-on-redeem={setup.revokes.length}>
                  <strong>This replaces {t.name}’s current credential.</strong> When the command
                  runs,{' '}
                  {setup.revokes.length === 1
                    ? 'the credential it uses now stops'
                    : `the ${String(setup.revokes.length)} credentials it holds now stop`}{' '}
                  working at once; anything still using {setup.revokes.length === 1 ? 'it' : 'them'}{' '}
                  is cut off.
                </span>
              </Help>
            ) : (
              setup.revokes === undefined &&
              exchange.purpose === 'rotate' && (
                <Help tone="warn">
                  This replaces {t.name}’s current credential: it stops working when the command
                  runs.
                </Help>
              )
            )}
          </>
        )}

        <div className="dv3w-mode">
          <StatusChip
            tone={t.mode === 'automatic' ? 'ok' : t.mode === 'unverified' ? 'warn' : 'neutral'}
            word={MODE_WORDS[t.mode]}
            reason={MODE_MEANING[t.mode]}
          />
        </div>
        {t.notes.length > 0 && (
          <ul className="dv3w-notes" aria-label={`${t.name}: what you do by hand`}>
            {t.notes.map((note) => (
              <li key={note}>
                <InlineCode text={note} />
              </li>
            ))}
          </ul>
        )}

        <Checklist tool={t} verification={verification} lines={lines} trouble={pollTrouble} />
      </div>
    );
    hint =
      current?.key === 'ready'
        ? `${t.name} is Ready.`
        : 'This checks by itself. You can finish now and come back.';
    primary = (
      <button
        type="button"
        className="conn-continue"
        onClick={() => {
          setStep(3);
        }}
      >
        {current?.key === 'ready' ? 'Continue' : 'Finish for now'} <span aria-hidden="true">→</span>
      </button>
    );
  } else if (setup !== undefined && step === 3) {
    const { tool: t, agent } = setup;
    line = `${t.name} on ${setup.device.display_name}.`;
    body = (
      <div className="dv3w-stack">
        {current !== undefined ? (
          <StatusChip tone={current.tone} word={current.word} reason={current.reason} />
        ) : (
          <StatusChip tone="waiting" word="Checking" reason="Not read from the board yet" />
        )}
        {current?.versionUnknown === true && (
          <span className="dv3-tag dv3-tag-quiet">Version unknown</span>
        )}
        {current?.key !== 'ready' && (
          <Help>
            Not Ready yet: the checks keep going on the Devices tab, where this tool’s row says what
            is still missing.
          </Help>
        )}
        {t.sessions ? (
          <div className="dv3w-consent">
            <p className="conn-label">Automatic checkpoints</p>
            <Help>
              Off until you turn it on. With it on, {t.name}’s hooks save a checkpoint of its work
              on a task as it goes, so another session can pick it up.
            </Help>
            <CheckpointConsentSwitch agent={agent} me={me} canManage={canManage} now={Date.now()} />
          </div>
        ) : (
          <Help>
            {t.name} has no session hooks, so there are no automatic checkpoints to turn on.
          </Help>
        )}
        <Help>
          A new tool reaches no project until you give it one. Set up a project next: its access,
          and the instructions its repository needs.
        </Help>
        <div className="dv3w-actions">
          <button
            type="button"
            className="bar-control"
            onClick={() => {
              setSetup(undefined);
              setVerification(undefined);
              setHarness(undefined);
              setStep(1);
              onExchange(undefined);
            }}
          >
            Add another tool
          </button>
        </div>
      </div>
    );
    hint = 'Next, give it a project.';
    primary = (
      <button
        type="button"
        className="conn-continue"
        onClick={() => {
          onSetUpProject(agent.id);
        }}
      >
        Set up a project <span aria-hidden="true">→</span>
      </button>
    );
  } else {
    line = reconnectId === undefined ? '' : 'A new credential, fetched by the device.';
    body = busy ? <p className="dv3w-quiet">Asking the board…</p> : null;
  }

  const shownStep: Step = setup === undefined ? 1 : step;
  return (
    <section
      className="dv3w"
      aria-label={reconnectId === undefined ? 'Add a tool' : 'Reconnect a tool'}
      data-wizard="tool"
      data-step={shownStep}
      data-status={current?.key}
    >
      <LiveRegion message={message} />
      <div className="conn-wizard dv3w-grid">
        <StepRail
          label="Tool setup steps"
          intro={
            reconnectId === undefined
              ? 'Each tool gets its own credential, fetched by its device.'
              : 'A new credential, fetched by the device; the old one stops when it arrives.'
          }
          current={shownStep}
          steps={([1, 2, 3] as const).map((n) => ({
            n,
            name: STEP_NAMES[n],
            sub:
              n === 1
                ? tool === undefined
                  ? 'Not yet'
                  : `${tool.name}${device === undefined ? '' : ` · ${device.display_name}`}`
                : n === 2
                  ? current === undefined
                    ? 'Not yet'
                    : current.word
                  : 'Consent and a project',
            done: n < shownStep,
            open: n === shownStep || (n === 3 && setup !== undefined),
            lockedReason: 'Opens once the command exists',
          }))}
          onSelect={(n) => {
            if (setup !== undefined && n >= 2) setStep(n as Step);
          }}
        />
        <WizardCard
          step={shownStep}
          total={3}
          title={STEP_NAMES[shownStep]}
          line={line}
          titleId={`${ids}-title`}
          titleRef={titleRef}
          footer={
            <footer className="conn-card-foot">
              <button type="button" className="conn-outline conn-back" onClick={close}>
                {shownStep === 1 ? 'Cancel' : 'Done'}
              </button>
              <p className="conn-foot-hint">{hint}</p>
              {primary}
            </footer>
          }
        >
          {body}
          {refusal !== undefined && (
            <div className="dv3w-error" role="alert" data-refusal>
              <p>{refusal.message}</p>
              {refusal.duplicates !== undefined && refusal.duplicates.length > 0 && (
                <button
                  type="button"
                  className="bar-control"
                  onClick={() => {
                    const first = refusal.duplicates?.[0];
                    if (first !== undefined) onResolveConflict(first);
                  }}
                >
                  Go to the conflicts
                </button>
              )}
              {refusal.needsPairing === true && (
                <button
                  type="button"
                  className="bar-control"
                  onClick={() => {
                    onAddDevice(device?.id, harness);
                  }}
                >
                  Pair the device
                </button>
              )}
            </div>
          )}
        </WizardCard>
      </div>
    </section>
  );
}

/** The checks, each with what passed it or what it is missing. */
function Checklist({
  tool,
  verification,
  lines,
  trouble,
}: {
  readonly tool: ToolCapability;
  readonly verification: AgentVerification | undefined;
  readonly lines: ReturnType<typeof checkLines> | undefined;
  readonly trouble: string | undefined;
}) {
  const r = verification === undefined ? undefined : readiness(verification, tool);
  return (
    <section className="dv3w-checks" aria-label={`Checks for ${tool.name}`} data-checks>
      <div className="dv3w-checks-head">
        <h3 className="dv3w-checks-title">Checks</h3>
        {r !== undefined ? (
          <span data-readiness={r.key}>
            <StatusChip tone={r.tone} word={r.word} reason={r.reason} />
          </span>
        ) : (
          <StatusChip tone="waiting" word="Checking" reason="Asking the board" />
        )}
        {r?.versionUnknown === true && (
          <span className="dv3-tag dv3-tag-quiet">Version unknown</span>
        )}
      </div>
      {lines === undefined ? (
        <p className="dv3w-quiet">Asking the board what it has seen…</p>
      ) : (
        <ul className="dv3w-check-list">
          {lines.map((l) => (
            <li key={l.id} className="dv3w-check" data-check={l.id} data-state={l.state}>
              <span className="dv3w-check-mark" aria-hidden="true">
                {l.state === 'pass' ? <CheckIcon /> : l.state === 'unsupported' ? '–' : '○'}
              </span>
              <span className="dv3w-check-text">
                <span className="dv3w-check-label">
                  {l.label}
                  <span className="dv3w-check-state">
                    {l.state === 'pass'
                      ? 'Done'
                      : l.state === 'unsupported'
                        ? 'Not supported'
                        : 'Missing'}
                  </span>
                </span>
                <span className="dv3w-check-detail">
                  <InlineCode text={l.detail} />
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="dv3w-quiet dv3w-honest">
        {tool.name}’s name for itself is what it reports; Ready means its own credential, announcing
        itself as {tool.name}.
      </p>
      {trouble !== undefined && <p className="dv3w-quiet">{trouble}</p>}
    </section>
  );
}

/** Text with `backticked` runs set as code. */
function InlineCode({ text }: { readonly text: string }) {
  return text
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 1 ? (
        <code key={i}>{part.slice(1, -1)}</code>
      ) : (
        part
      ),
    );
}
