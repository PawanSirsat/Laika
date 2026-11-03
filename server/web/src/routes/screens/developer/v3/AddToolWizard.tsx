import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getCheckpointConsent, type RegisteredAgent } from '../../../../api/agents.ts';
import type { Device } from '../../../../api/devices.ts';
import { ApiError } from '../../../../api/errors.ts';
import {
  addToolToDevice,
  cancelToolSetup,
  getAgentVerification,
  getToolSetup,
  reconnectAgent,
  type AgentVerification,
  type ToolSetup,
} from '../../../../api/tool-setup.ts';
import { AgentMark } from '../../../../components/agent-mark/AgentMark.tsx';
import { Dropdown } from '../../../../components/Dropdown.tsx';
import { CheckIcon } from '../../../../components/wizard/CheckIcon.tsx';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import { UpdateCliHelp } from './UpdateCliGuide.tsx';
import { WIZARD_SUMMARY } from './update-cli.ts';
import { Help } from '../../../../components/wizard/Help.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { StatusChip } from '../../../../components/wizard/StatusChip.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import { useConfirm } from '../../../../components/ConfirmProvider.tsx';
import {
  POLL_FIRST_MS,
  exchangeEnded,
  nextPollDelay,
  pairedDevice,
  toolAddCommand,
  toolRefusal,
  type ToolRefusal,
} from './add-flow.ts';
import {
  MODE_MEANING,
  MODE_WORDS,
  catalogTool,
  featuredTools,
  moreTools,
  toolSub,
  type ToolCapability,
} from './tool-catalog.ts';
import { kindName } from './devices-view.ts';
import {
  checkLines,
  readiness,
  readinessSummary,
  type CheckId,
  type CheckLine,
} from './tool-readiness.ts';
import { DesignWizard } from './DesignWizard.tsx';
import { DxIcon } from './DxIcon.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import '../../connect/connect.css';
import './add-wizards.css';

export interface AddToolWizardProps {
  readonly devices: readonly Device[] | undefined;
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
  /** This tool's details panel: where its checkpoint switch and every check are. */
  readonly onOpenDetails: (agentId: string) => void;
  /** Advanced, for a tool the helper cannot set up: a personal token, by hand. */
  readonly onOpenAdvanced: () => void;
  readonly onClose: (changed: boolean) => void;
}

type Step = 1 | 2 | 3;

/**
 * The owner's design's steps (LAI-1081), less its *Authorize identity*: the
 * browser authorizes when it asks the board for the command, and the device
 * fetches the credential itself — a step of its own would be a click that
 * does nothing.
 */
const STEP_NAMES: Readonly<Record<Step, string>> = {
  1: 'Choose tool',
  2: 'Configure on your device',
  3: 'Verify & finish',
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
 * 1. **Choose** a paired device and a tool. The tools the helper sets up are
 *    the design's option cards, each saying what kind it is and how it is set
 *    up; the ones connected by hand are behind *More tools*. The lists are
 *    the catalog's, never a count.
 * 2. **Run** the command the board returned on the device: it redeems the
 *    exchange with the device's own key and writes the credential to a 0600
 *    file there. **The browser never sees the secret.** Below it, the checks,
 *    asked of `GET /agents/:id/verification` with backoff: each passes only
 *    on evidence from this tool's own credential, and says what is missing.
 * 3. **Verify**: the tool's status, from `readiness()` alone, and four checks
 *    — each not met saying what is missing. Automatic checkpoints are one
 *    line: the board's answer, and a way to its details, where the switch is.
 *    *Set up a project* next.
 *
 * A reconnect skips step 1: `POST /agents/:id/reconnect` makes a `rotate`
 * exchange for the agent's own paired device, and the same command and
 * checks follow.
 */
export function AddToolWizard({
  devices,
  canManage,
  initialDeviceId,
  initialTool,
  reconnectId,
  resumeExchange,
  onExchange,
  onAddDevice,
  onResolveConflict,
  onSetUpProject,
  onOpenDetails,
  onOpenAdvanced,
  onClose,
}: AddToolWizardProps) {
  const ids = useId();
  const confirm = useConfirm();
  const [message, announce] = useLiveRegion();
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const paired = (devices ?? []).filter(pairedDevice);
  const unpaired = (devices ?? []).filter((d) => d.status === 'active' && d.paired_at === null);
  const [deviceId, setDeviceId] = useState<string | undefined>(initialDeviceId);
  const device =
    paired.find((d) => d.id === deviceId) ?? (paired.length === 1 ? paired[0] : undefined);
  const [harness, setHarness] = useState<string | undefined>(catalogTool(initialTool)?.harness);
  const tool = catalogTool(harness);
  // *More tools* starts open when the address chose one of them.
  const [more, setMore] = useState(() => moreTools().some((t) => t.harness === harness));

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
          // End states: nothing more will arrive, so stop asking. A revoked
          // agent, or an exchange that closed without being redeemed — its
          // own screen offers a new command, which starts a new poll.
          if (v.status === 'revoked' || (exchange !== undefined && exchangeEnded(exchange))) return;
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

  /**
   * Leave this setup, then `then`. An exchange still open is cancelled first,
   * after asking — as closing a pairing does — so the command copied for it
   * stops working rather than staying live for ten minutes nobody watches.
   */
  const leave = (then: () => void): void => {
    const open = setup?.exchange.state === 'open' ? setup.exchange : undefined;
    if (open === undefined) {
      then();
      return;
    }
    void confirm({
      title: 'Cancel this tool setup?',
      body: `The command for ${setup?.tool.name ?? 'this tool'} stops working at once and no credential is fetched. If ${setup?.device.display_name ?? 'the device'} already ran it, nothing changes.`,
      confirmLabel: 'Cancel setup',
      cancelLabel: 'Keep it',
      icon: 'warning',
    }).then((yes) => {
      if (!yes) return;
      cancelToolSetup(open.id)
        .catch(() => undefined)
        .finally(then);
    });
  };

  const close = (): void => {
    leave(() => {
      onClose(changed.current);
    });
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
          <fieldset className="dv3w-picker">
            <legend className="dx-label">Choose the app that will connect to Laika</legend>
            <div className="dx-options" data-tools="featured">
              {featuredTools().map((t) => (
                <ToolOption
                  key={t.harness}
                  tool={t}
                  group={`${ids}-tool`}
                  checked={harness === t.harness}
                  onChange={setHarness}
                />
              ))}
            </div>
            <button
              type="button"
              className="dx-btn dx-btn-sm dx-btn-ghost dv3w-more"
              aria-expanded={more}
              aria-controls={`${ids}-more`}
              onClick={() => {
                setMore((open) => !open);
              }}
            >
              {more ? 'Fewer tools' : `More tools (${String(moreTools().length)})`}
            </button>
            {more && (
              <div className="dv3w-more-tools" id={`${ids}-more`}>
                <Help>Laika’s helper cannot set these up: you connect them by hand.</Help>
                <div className="dx-options" data-tools="more">
                  {moreTools().map((t) => (
                    <ToolOption
                      key={t.harness}
                      tool={t}
                      group={`${ids}-tool`}
                      checked={harness === t.harness}
                      onChange={setHarness}
                    />
                  ))}
                </div>
              </div>
            )}
          </fieldset>
          {tool !== undefined && (
            <Help>
              <span id={`${ids}-mode`} data-mode-meaning={tool.mode}>
                <strong>{MODE_WORDS[tool.mode]}:</strong>{' '}
                <InlineCode text={MODE_MEANING[tool.mode]} />
              </span>
            </Help>
          )}
          <div className="dv3w-set" data-device-choice>
            <span className="dx-label" id={`${ids}-device`}>
              On device
            </span>
            {paired.length === 1 && device !== undefined ? (
              <p className="dv3w-on-device" data-on-device={device.id}>
                <strong>{device.display_name}</strong> · {kindName(device)}
              </p>
            ) : (
              <div className="dv3w-device-pick">
                <Dropdown
                  value={device?.id ?? ''}
                  options={paired.map((d) => ({
                    value: d.id,
                    label: `${d.display_name} · ${kindName(d)}`,
                  }))}
                  onChange={setDeviceId}
                  aria-labelledby={`${ids}-device`}
                  placeholder="Choose a device"
                  noun="Device"
                />
              </div>
            )}
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
          </div>

          {tool !== undefined && !tool.cliSetup && (
            <div className="dv3w-manual" data-manual={tool.harness}>
              <Help tone="warn">
                <InlineCode text={tool.notes[0] ?? ''} />
              </Help>
              <button type="button" className="bar-control" onClick={onOpenAdvanced}>
                Open Advanced
              </button>
            </div>
          )}
          {already !== undefined && tool !== undefined && device !== undefined && tool.cliSetup && (
            <Help tone="info">
              {tool.name} is already on {device.display_name}. This gives it a new credential, which
              replaces the current one when the device fetches it.
            </Help>
          )}
        </div>
      );
    hint = !canManage
      ? 'Adding a tool needs a signed-in browser session; this one is not allowed to.'
      : paired.length === 0
        ? 'Pair a device, then come back.'
        : device === undefined
          ? 'Choose a device.'
          : tool === undefined
            ? 'Choose a tool.'
            : !tool.cliSetup
              ? `The helper cannot set up ${tool.name}, so there is no command: connect it by hand.`
              : `Next, the command to run on ${device.display_name}.`;
    primary =
      devices !== undefined && paired.length === 0 ? (
        <button
          type="button"
          className="dx-btn dx-btn-primary"
          onClick={() => {
            onAddDevice(undefined, harness);
          }}
        >
          Add a device <span aria-hidden="true">→</span>
        </button>
      ) : (
        <button
          type="button"
          className="dx-btn dx-btn-primary"
          disabled={
            device === undefined || tool === undefined || !tool.cliSetup || busy || !canManage
          }
          aria-busy={busy || undefined}
          aria-describedby={`${ids}-hint`}
          onClick={add}
        >
          Get the command <span aria-hidden="true">→</span>
        </button>
      );
  } else if (setup !== undefined && step === 2) {
    const { exchange, tool: t, device: d } = setup;
    line = `Configure ${t.name} on ${d.display_name}, in a terminal.`;
    const expired = exchangeEnded(exchange);
    body = (
      <div className="dv3w-stack">
        {expired ? (
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
            <UpdateCliHelp summary={WIZARD_SUMMARY} place="add-tool" />
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
      </div>
    );
    hint = 'Existing tools and projects are not changed.';
    primary = (
      <button
        type="button"
        className="dx-btn dx-btn-primary"
        onClick={() => {
          setStep(3);
        }}
      >
        I ran it <span aria-hidden="true">→</span>
      </button>
    );
  } else if (setup !== undefined && step === 3) {
    const { tool: t, agent } = setup;
    line = `Checks for ${t.name} on ${setup.device.display_name}, from its own requests.`;
    body = (
      <div className="dv3w-stack">
        <div className="dx-status-head dv3w-verify-head" data-verify-status={current?.key}>
          <span
            className="dx-orb"
            data-tone={
              current?.key === 'ready'
                ? undefined
                : current?.key === 'needs-setup' || current?.key === 'offline'
                  ? 'warn'
                  : 'accent'
            }
          >
            <DxIcon name={current?.key === 'ready' ? 'check' : 'tool'} />
          </span>
          <div>
            <p className="dv3w-status-word">
              {current === undefined ? 'Checking' : `${t.name} is ${current.word}`}
            </p>
            <p className="dv3w-quiet">
              {current?.reason ?? 'Not read from the board yet'} · on {setup.device.display_name}
            </p>
          </div>
        </div>
        <Checklist tool={t} lines={lines} trouble={pollTrouble} />
        {t.sessions && (
          <ConsentLine
            agentId={agent.id}
            onDetails={() => {
              leave(() => {
                onOpenDetails(agent.id);
              });
            }}
          />
        )}
      </div>
    );
    hint =
      current?.key === 'ready'
        ? 'A new tool reaches no project until you set one up.'
        : 'Not Ready yet: the checks keep going here and in its details. You can set up a project now.';
    primary = (
      <button
        type="button"
        className="dx-btn dx-btn-primary"
        onClick={() => {
          leave(() => {
            onSetUpProject(agent.id);
          });
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
  // Step 1's word: what was chosen — by the picker, or by the setup a
  // Reconnect or a resumed exchange opened on, which skips the picker (LAI-1071).
  const railTool = setup?.tool ?? tool;
  const railDevice = setup?.device ?? device;

  const reconnecting = reconnectId !== undefined;
  return (
    <section
      className="dv3w"
      aria-label={reconnecting ? 'Reconnect a tool' : 'Add a tool'}
      data-wizard="tool"
      data-step={shownStep}
      data-status={current?.key}
    >
      <LiveRegion message={message} />
      <SectionTitle
        title={reconnecting ? 'Reconnect a coding tool' : 'Add a coding tool'}
        titleId={`${ids}-section`}
        actions={
          <button type="button" className="dx-btn dx-btn-sm" onClick={close}>
            Back to tools
          </button>
        }
      />
      <DesignWizard
        railTitle={reconnecting ? 'Reconnect a tool' : 'Connect a tool'}
        railIntro={
          reconnecting
            ? 'A new credential, fetched by the device; the old one stops when it arrives.'
            : 'Each tool gets its own credential, fetched by its device.'
        }
        railLabel="Tool setup steps"
        current={shownStep}
        steps={([1, 2, 3] as const).map((n) => ({
          n,
          name: STEP_NAMES[n],
          sub:
            n === 1
              ? railTool === undefined
                ? 'Not yet'
                : `${railTool.name}${railDevice === undefined ? '' : ` · ${railDevice.display_name}`}`
              : n === 2
                ? setup === undefined
                  ? 'The command, on the device'
                  : 'Command ready'
                : current === undefined
                  ? 'Real requests, checked'
                  : current.word,
          done: n < shownStep,
          open: n === shownStep || (n >= 2 && setup !== undefined),
          lockedReason: 'Opens once the command exists',
        }))}
        onSelect={(n) => {
          if (setup !== undefined && n >= 2) setStep(n as Step);
        }}
        step={shownStep}
        total={3}
        kind="Tool"
        title={STEP_NAMES[shownStep]}
        line={line}
        titleId={`${ids}-title`}
        titleRef={titleRef}
        note={hint}
        noteId={`${ids}-hint`}
        actions={
          <>
            {shownStep === 3 ? (
              <button
                type="button"
                className="dx-btn"
                onClick={() => {
                  setStep(2);
                }}
              >
                Back
              </button>
            ) : (
              <button type="button" className="dx-btn" onClick={close}>
                {shownStep === 1 ? 'Cancel' : 'Done'}
              </button>
            )}
            {primary}
          </>
        }
      >
        {body}
        {refusal !== undefined && (
          <div className="dv3w-error" role="alert" data-refusal>
            <p>{refusal.message}</p>
            {refusal.duplicates !== undefined && refusal.duplicates.length > 0 && (
              <button
                type="button"
                className="dx-btn dx-btn-sm"
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
                className="dx-btn dx-btn-sm"
                onClick={() => {
                  onAddDevice(device?.id, harness);
                }}
              >
                Pair the device
              </button>
            )}
          </div>
        )}
      </DesignWizard>
    </section>
  );
}

/** One tool as the design's option card: its mark, its name, and its line (`toolSub`). */
function ToolOption({
  tool,
  group,
  checked,
  onChange,
}: {
  readonly tool: ToolCapability;
  readonly group: string;
  readonly checked: boolean;
  readonly onChange: (harness: string) => void;
}) {
  return (
    <label className="dx-option" data-tool={tool.harness}>
      <input
        type="radio"
        name={group}
        value={tool.harness}
        checked={checked}
        onChange={() => {
          onChange(tool.harness);
        }}
      />
      <span className="dx-icon">
        <AgentMark client={tool.harness} size="sm" />
      </span>
      <span>
        <strong className="dx-option-name">{tool.name}</strong>
        <span className="dx-option-sub">{toolSub(tool)}</span>
      </span>
    </label>
  );
}

/**
 * The four checks a tool is set up by (LAI-1097, the owner's verify step is a
 * status and a short note): its device paired, its credential installed, its
 * own request, and its hooks where it has them. A check not met says what is
 * missing, in `checkLines`' words; one met says only *Done* — its evidence is
 * in the tool's details, with every other check. `readiness()` alone says
 * *Ready*, in the status above.
 */
export const VERIFY_CHECKS: readonly CheckId[] = [
  'device_paired',
  'credential_installed',
  'tool_request',
  'session_hooks',
];

const CHECK_STATE: Readonly<Record<CheckLine['state'], string>> = {
  pass: 'Done',
  fail: 'Missing',
  unsupported: 'Not needed: it has no hooks',
};

function Checklist({
  tool,
  lines,
  trouble,
}: {
  readonly tool: ToolCapability;
  readonly lines: readonly CheckLine[] | undefined;
  readonly trouble: string | undefined;
}) {
  const shown = lines?.filter((l) => VERIFY_CHECKS.includes(l.id));
  return (
    <section className="dv3w-checks" aria-label={`Checks for ${tool.name}`} data-checks>
      {shown === undefined ? (
        <p className="dv3w-quiet">Asking the board what it has seen…</p>
      ) : (
        <ul className="dv3w-check-list">
          {shown.map((l) => (
            <li key={l.id} className="dv3w-check" data-check={l.id} data-state={l.state}>
              <span className="dv3w-check-mark" aria-hidden="true">
                {l.state === 'pass' ? <CheckIcon /> : l.state === 'unsupported' ? '–' : '○'}
              </span>
              <span className="dv3w-check-text">
                <span className="dv3w-check-label">
                  {l.label}
                  <span className="dv3w-check-state">{CHECK_STATE[l.state]}</span>
                </span>
                {l.state === 'fail' && (
                  <span className="dv3w-check-detail">
                    <InlineCode text={l.detail} />
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {trouble !== undefined && <p className="dv3w-quiet">{trouble}</p>}
    </section>
  );
}

/**
 * Automatic checkpoints, in one line: what the board holds, read from it, and
 * where to change it — the switch is in the tool's details (LAI-1097), not in
 * this wizard.
 */
function ConsentLine({
  agentId,
  onDetails,
}: {
  readonly agentId: string;
  readonly onDetails: () => void;
}) {
  const [given, setGiven] = useState<boolean | 'failed' | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    getCheckpointConsent(agentId, controller.signal)
      .then((consent) => {
        setGiven(consent.given);
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setGiven('failed');
      });
    return () => {
      controller.abort();
    };
  }, [agentId]);
  return (
    <p
      className="dv3w-quiet dv3w-consent-line"
      data-consent-line={given === undefined ? 'reading' : String(given)}
    >
      Automatic checkpoints:{' '}
      {given === undefined
        ? 'reading…'
        : given === 'failed'
          ? 'could not be read'
          : given
            ? 'On'
            : 'Off'}{' '}
      ·{' '}
      <button type="button" className="conn-link-button" onClick={onDetails}>
        change in its details
      </button>
    </p>
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
