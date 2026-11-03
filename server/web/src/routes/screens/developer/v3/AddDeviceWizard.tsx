import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { loadCliSource, type CliSource } from '../../../../api/developer-compat.ts';
import {
  approvePairingRequest,
  cancelPairingRequest,
  createPairingRequest,
  denyPairingRequest,
  getPairingRequest,
  type DevicePairing,
} from '../../../../api/device-pairing.ts';
import type { Device, DeviceKind } from '../../../../api/devices.ts';
import { ApiError } from '../../../../api/errors.ts';
import { timeLabel } from '../../../../api/time-label.ts';
import { useConfirm } from '../../../../components/ConfirmProvider.tsx';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import { UpdateCliHelp } from './UpdateCliGuide.tsx';
import { WIZARD_SUMMARY } from './update-cli.ts';
import { Help } from '../../../../components/wizard/Help.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { StatusChip } from '../../../../components/wizard/StatusChip.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import {
  POLL_FIRST_MS,
  bootstrapCommands,
  fingerprintGroups,
  nextPollDelay,
  pairingFinished,
  pairingNotBehind,
  pairingRefusal,
  type Refusal,
} from './add-flow.ts';
import { CLOUD_NOTE } from './devices-view.ts';
import { DesignWizard } from './DesignWizard.tsx';
import { DetailTiles } from './DetailTiles.tsx';
import { DxIcon } from './DxIcon.tsx';
import { NoteBlock } from './NoteBlock.tsx';
import { SectionTitle } from './SectionTitle.tsx';
import '../../connect/connect.css';
import './add-wizards.css';

export interface AddDeviceWizardProps {
  /** The reader's devices, for *pair one you already have*; `undefined` while loading. */
  readonly devices: readonly Device[] | undefined;
  /** A pairing request to resume, from `?pairing=` — its code is not shown again. */
  readonly resumeId: string | undefined;
  /** An imported device to pair, from `?device=` — chosen explicitly, never guessed. */
  readonly initialDeviceId: string | undefined;
  /** The request id goes into the address once there is one, so a reload resumes it. */
  readonly onRequest: (id: string | undefined) => void;
  /** *Add a tool to …* on the finished step. */
  readonly onAddTool: (deviceId: string) => void;
  readonly onClose: (changed: boolean) => void;
}

type Step = 1 | 2 | 3 | 4;

/** The card's title per step; the fourth is the third rail step, finished. */
const STEP_NAMES: Readonly<Record<Step, string>> = {
  1: 'Name your device',
  2: 'Pair the device',
  3: 'Approve & finish',
  4: 'Device paired',
};

/**
 * The rail's three steps, as the owner's design draws them (LAI-1081). The
 * board's four states fold into them: checking the key and *Paired* are both
 * the third — approve, then finish.
 */
const RAIL: readonly { readonly n: 1 | 2 | 3; readonly name: string; readonly sub: string }[] = [
  { n: 1, name: 'Name your device', sub: 'Name and type' },
  { n: 2, name: 'Pair the device', sub: 'A one-use code' },
  { n: 3, name: 'Approve & finish', sub: 'Check its key here' },
];

/**
 * *Add device* (LAI-1061, plan LAI-1042 §E.1, §F.3, §F.6), in the owner's
 * design since LAI-1081: three rail steps over the board's four states, each
 * moved on **by the board's answer, never by a click**:
 *
 * 1. **Name** it and say whether it is a laptop or a cloud runner — or choose
 *    an imported device of yours to pair. No coding tool is asked here.
 * 2. **Run** the bootstrap on the device: clone the helper at this board's
 *    own commit, link it without any token, and `laika device pair` with the
 *    one-use code. The page waits, asking the board with backoff.
 * 3. **Check the key** the device claimed the code with: the fingerprint, its
 *    system and helper version, when. Approve only if it is what the
 *    terminal printed; the fingerprint shown is echoed back, so a key that
 *    changed underneath is refused.
 * 4. **Paired** only once the board says `completed` — the device signed
 *    with the key that was approved.
 *
 * The code lives in this component's memory only: not the address, not
 * storage. A reload resumes the request by its id and says the code is not
 * shown again.
 */
export function AddDeviceWizard({
  devices,
  resumeId,
  initialDeviceId,
  onRequest,
  onAddTool,
  onClose,
}: AddDeviceWizardProps) {
  const ids = useId();
  const confirm = useConfirm();
  const [message, announce] = useLiveRegion();
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const pairable = (devices ?? []).filter(
    (d) => d.status === 'active' && d.paired_at === null && d.key_fingerprint === null,
  );
  const [existing, setExisting] = useState<string | undefined>(initialDeviceId);
  const chosen = pairable.find((d) => d.id === existing);
  const [kind, setKind] = useState<DeviceKind>('local');
  const [name, setName] = useState('');
  const [installed, setInstalled] = useState(false);

  const [source, setSource] = useState<CliSource | undefined | 'loading'>('loading');
  const [code, setCode] = useState<{ readonly command: string } | undefined>(undefined);
  const [pairing, setPairing] = useState<DevicePairing | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);
  const [pollTrouble, setPollTrouble] = useState<string | undefined>(undefined);
  const [resumeError, setResumeError] = useState<Refusal | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const changed = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void loadCliSource(controller.signal).then((answer) => {
      if (!controller.signal.aborted) setSource(answer);
    });
    return () => {
      controller.abort();
    };
  }, []);

  const signature =
    pairing === undefined ? '' : `${pairing.state}:${pairing.claimed?.key_fingerprint ?? ''}`;
  const lastSignature = useRef(signature);
  /**
   * The state on screen, ahead of React's: a poll answer behind it — one that
   * set out before an Approve or a Deny landed — is ignored, so a decision
   * never flickers back to the Approve buttons.
   */
  const shown = useRef<DevicePairing['state'] | undefined>(undefined);
  const show = useCallback((next: DevicePairing): void => {
    if (!pairingNotBehind(shown.current, next.state)) return;
    shown.current = next.state;
    lastSignature.current = `${next.state}:${next.claimed?.key_fingerprint ?? ''}`;
    setPairing(next);
  }, []);

  // Resume `?pairing=`: read it once; the code is not shown again.
  useEffect(() => {
    if (resumeId === undefined || pairing !== undefined) return;
    const controller = new AbortController();
    getPairingRequest(resumeId, controller.signal)
      .then(show)
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setResumeError(pairingRefusal(cause, ''));
      });
    return () => {
      controller.abort();
    };
  }, [resumeId, pairing, show]);

  // Ask the board again until the request finishes, backing off while nothing moves.
  const pairingId = pairing?.id;
  const finished = pairing === undefined || pairingFinished(pairing.state);

  useEffect(() => {
    if (pairingId === undefined || finished) return;
    const controller = new AbortController();
    let delay = POLL_FIRST_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (): void => {
      getPairingRequest(pairingId, controller.signal)
        .then((next) => {
          if (!pairingNotBehind(shown.current, next.state)) {
            delay = nextPollDelay(delay, false, false);
            timer = setTimeout(tick, delay);
            return;
          }
          const sig = `${next.state}:${next.claimed?.key_fingerprint ?? ''}`;
          const moved = sig !== lastSignature.current;
          lastSignature.current = sig;
          setPollTrouble(undefined);
          setNow(Date.now());
          if (moved) {
            shown.current = next.state;
            setPairing(next);
          }
          if (pairingFinished(next.state)) return;
          delay = nextPollDelay(delay, moved, false);
          timer = setTimeout(tick, delay);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          const limited = cause instanceof ApiError && cause.code === 'rate_limited';
          if (cause instanceof ApiError && cause.code === 'not_found') {
            setRefusal(pairingRefusal(cause, ''));
            return;
          }
          setPollTrouble(
            limited
              ? 'The board asked us to slow down; still waiting.'
              : 'Could not reach the board just now; still trying.',
          );
          delay = nextPollDelay(delay, false, limited);
          timer = setTimeout(tick, delay);
        });
    };
    timer = setTimeout(tick, delay);
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pairingId, finished]);

  const step: Step =
    pairing === undefined
      ? 1
      : pairing.state === 'open'
        ? 2
        : pairing.state === 'claimed' || pairing.state === 'approved'
          ? 3
          : pairing.state === 'completed'
            ? 4
            : pairing.claimed === null
              ? 2
              : 3;

  // Focus follows the step: to the card's title on open and on every move.
  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  const displayName = chosen?.display_name ?? pairing?.display_name ?? name.trim();
  useEffect(() => {
    if (pairing === undefined) return;
    const said: Record<DevicePairing['state'], string> = {
      open: `Waiting for ${pairing.display_name} to claim the code.`,
      claimed: `${pairing.display_name} claimed the code. Check its key fingerprint against your terminal before you approve.`,
      approved: `Approved. Waiting for ${pairing.display_name} to finish pairing.`,
      completed: `${pairing.display_name} is paired.`,
      denied: 'Denied. Nothing was paired.',
      expired: 'This code expired. Nothing was paired.',
      cancelled: 'Cancelled. Nothing was paired.',
    };
    announce(said[pairing.state]);
  }, [pairing, announce]);

  const create = (): void => {
    setBusy(true);
    setRefusal(undefined);
    createPairingRequest(
      chosen === undefined
        ? { kind, display_name: name.trim() }
        : { kind: chosen.kind, display_name: chosen.display_name, device_id: chosen.id },
    )
      .then((created) => {
        changed.current = true;
        setCode({ command: created.command });
        shown.current = undefined;
        show(created.pairing);
        setNow(Date.now());
        onRequest(created.pairing.id);
      })
      .catch((cause: unknown) => {
        setRefusal(pairingRefusal(cause, chosen?.display_name ?? name.trim()));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const decide = (approve: boolean): void => {
    const shown = pairing?.claimed?.key_fingerprint;
    if (pairing === undefined || shown === undefined) return;
    setBusy(true);
    setRefusal(undefined);
    (approve ? approvePairingRequest : denyPairingRequest)(pairing.id, shown)
      .then((next) => {
        show(next);
      })
      .catch((cause: unknown) => {
        setRefusal(pairingRefusal(cause, pairing.display_name));
        // The answer may say why: read the request as it is now.
        getPairingRequest(pairing.id).then(show, () => undefined);
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const startAgain = (): void => {
    shown.current = undefined;
    setPairing(undefined);
    setCode(undefined);
    setRefusal(undefined);
    setResumeError(undefined);
    setPollTrouble(undefined);
    onRequest(undefined);
  };

  const close = (): void => {
    const live = pairing !== undefined && !pairingFinished(pairing.state);
    if (!live) {
      onClose(changed.current || pairing?.state === 'completed');
      return;
    }
    void confirm({
      title: 'Cancel this pairing?',
      body: 'The code stops working at once and nothing is paired. You can start again whenever you like.',
      confirmLabel: 'Cancel pairing',
      cancelLabel: 'Keep waiting',
      icon: 'warning',
    }).then((yes) => {
      if (!yes) return;
      cancelPairingRequest(pairing.id)
        .catch(() => undefined)
        .finally(() => {
          onClose(true);
        });
    });
  };

  const nameValid = chosen !== undefined || (name.trim().length >= 1 && name.trim().length <= 80);
  const minutesLeft =
    pairing === undefined ? 0 : Math.max(0, Math.ceil((pairing.expires_at - now) / 60_000));

  let body: ReactNode;
  let primary: ReactNode = null;
  let hint = '';

  if (resumeError !== undefined) {
    body = (
      <p className="dv3w-error" role="alert">
        {resumeError.message}
      </p>
    );
    primary = (
      <button type="button" className="dx-btn dx-btn-primary" onClick={startAgain}>
        Start again
      </button>
    );
  } else if (step === 1) {
    body = (
      <div className="dv3w-stack">
        {pairable.length > 0 && (
          <fieldset className="dv3w-set">
            <legend className="dx-label">Which device?</legend>
            <div className="dx-options">
              <label className="dx-option">
                <input
                  type="radio"
                  name={`${ids}-which`}
                  checked={chosen === undefined}
                  onChange={() => {
                    setExisting(undefined);
                  }}
                />
                <span className="dx-icon">
                  <DxIcon name="device" />
                </span>
                <span>
                  <strong className="dx-option-name">A new device</strong>
                  <span className="dx-option-sub">Name it on this step</span>
                </span>
              </label>
              {pairable.map((d) => (
                <label key={d.id} className="dx-option">
                  <input
                    type="radio"
                    name={`${ids}-which`}
                    checked={chosen?.id === d.id}
                    onChange={() => {
                      setExisting(d.id);
                    }}
                  />
                  <span className="dx-icon">
                    <DxIcon name={d.kind === 'cloud' ? 'cloud' : 'device'} />
                  </span>
                  <span>
                    <strong className="dx-option-name">{d.display_name}</strong>
                    <span className="dx-option-sub">
                      Imported · {d.kind === 'cloud' ? 'Cloud' : 'Local'}, not paired yet
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <Help>
              An imported device came from the names your tools reported. Pairing one gives it a key
              of its own; its tools keep working as they are.
            </Help>
          </fieldset>
        )}

        {chosen === undefined && (
          <>
            <fieldset className="dv3w-set">
              <legend className="dx-label">Where will Laika run?</legend>
              <div className="dx-options">
                <label className="dx-option">
                  <input
                    type="radio"
                    name={`${ids}-kind`}
                    checked={kind === 'local'}
                    onChange={() => {
                      setKind('local');
                    }}
                  />
                  <span className="dx-icon">
                    <DxIcon name="device" />
                  </span>
                  <span>
                    <strong className="dx-option-name">My computer</strong>
                    <span className="dx-option-sub">
                      A Mac, Windows or Linux machine you work on
                    </span>
                  </span>
                </label>
                <label className="dx-option">
                  <input
                    type="radio"
                    name={`${ids}-kind`}
                    checked={kind === 'cloud'}
                    onChange={() => {
                      setKind('cloud');
                    }}
                  />
                  <span className="dx-icon">
                    <DxIcon name="cloud" />
                  </span>
                  <span>
                    <strong className="dx-option-name">Cloud runner</strong>
                    <span className="dx-option-sub">A hosted or temporary environment</span>
                  </span>
                </label>
              </div>
              {kind === 'cloud' && <Help tone="info">{CLOUD_NOTE}</Help>}
            </fieldset>

            <div className="conn-field">
              <label className="conn-label" htmlFor={`${ids}-name`}>
                Device name
              </label>
              <input
                id={`${ids}-name`}
                className="conn-input dv3w-name"
                value={name}
                maxLength={80}
                autoComplete="off"
                aria-describedby={`${ids}-name-help`}
                onChange={(event) => {
                  setName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && nameValid && !busy) create();
                }}
              />
              <Help>
                <span id={`${ids}-name-help`}>
                  What you call this machine. It is shown beside every tool on it.
                </span>
              </Help>
            </div>
          </>
        )}

        <fieldset className="dv3w-set">
          <legend className="dx-label">Is Laika’s helper already installed on it?</legend>
          <div className="dx-options">
            <label className="dx-option">
              <input
                type="radio"
                name={`${ids}-installed`}
                checked={!installed}
                onChange={() => {
                  setInstalled(false);
                }}
              />
              <span>
                <strong className="dx-option-name">No, install it</strong>
                <span className="dx-option-sub">The next step installs it, with no token</span>
              </span>
            </label>
            <label className="dx-option">
              <input
                type="radio"
                name={`${ids}-installed`}
                checked={installed}
                onChange={() => {
                  setInstalled(true);
                }}
              />
              <span>
                <strong className="dx-option-name">Yes</strong>
                <span className="dx-option-sub">
                  Its terminal has a laika command, from any folder
                </span>
              </span>
            </label>
          </div>
        </fieldset>
      </div>
    );
    hint = nameValid ? 'Next, a one-use code for the device.' : 'Give the device a name first.';
    primary = (
      <button
        type="button"
        className="dx-btn dx-btn-primary"
        disabled={!nameValid || busy}
        aria-busy={busy || undefined}
        onClick={create}
      >
        Get a pairing code <span aria-hidden="true">→</span>
      </button>
    );
  } else if (step === 2 && pairing !== undefined) {
    const commands =
      code === undefined || source === 'loading'
        ? undefined
        : bootstrapCommands(source, code.command, installed);
    body = (
      <div className="dv3w-stack">
        <NoteBlock tone="accent" title="Device pairing only">
          <p>
            This gives the device an identity of its own. It does not register Claude Code, Codex or
            any other tool — you add those next.
          </p>
        </NoteBlock>
        {code === undefined ? (
          <Help tone="warn">
            The pairing code is shown once, when it is made. If your terminal already has it, carry
            on there; otherwise cancel this request and start again.
          </Help>
        ) : commands === undefined ? (
          <p className="dv3w-quiet">Reading where this board’s helper comes from…</p>
        ) : (
          <>
            <UpdateCliHelp summary={WIZARD_SUMMARY} place="add-device" />
            {commands.updateFirst && (
              <Help>
                <span data-update-first="">
                  Bring its Laika helper up to date first: the line above has the commands, for a
                  helper with <code>laika update</code> and for one too old to have it, wherever its
                  checkout is. This code lasts ten minutes: if updating takes longer, cancel this
                  pairing and start again for a fresh code. Then pair:
                </span>
              </Help>
            )}
            <CodeBlock
              label={
                commands.updateFirst ? 'On the device: pair' : 'On the device: install, then pair'
              }
              labelId={`${ids}-bootstrap`}
              text={commands.text}
              what="the commands"
              main
            />
            {commands.versionNote !== undefined && <Help tone="info">{commands.versionNote}</Help>}
            <Help>
              The code works once, for ten minutes, and gives nothing on its own: the device still
              needs you to approve its key here. No token is asked for or stored by these commands.
            </Help>
          </>
        )}
        <WaitLine
          word="Waiting for the device"
          reason={`Code expires in about ${String(minutesLeft)} min`}
          trouble={pollTrouble}
        />
      </div>
    );
    hint = 'This moves on by itself when the device claims the code.';
  } else if (step === 3 && pairing !== undefined && pairing.claimed !== null) {
    const claim = pairing.claimed;
    const at = timeLabel(claim.claimed_at, now);
    body = (
      <div className="dv3w-stack">
        <div className="dv3w-fingerprint" aria-labelledby={`${ids}-fp-label`}>
          <p className="conn-label" id={`${ids}-fp-label`}>
            Key fingerprint
          </p>
          <p className="dv3w-fingerprint-value" data-fingerprint={claim.key_fingerprint}>
            {fingerprintGroups(claim.key_fingerprint).map((group, i) => (
              <span key={i}>{group}</span>
            ))}
          </p>
        </div>
        <DetailTiles
          items={[
            { label: 'Device', value: pairing.display_name, id: 'device' },
            { label: 'System', value: claim.os ?? 'Not said', id: 'system' },
            { label: 'Helper', value: claim.cli_version ?? 'Version unknown', id: 'helper' },
            {
              label: 'Claimed',
              value: (
                <time dateTime={at.iso} title={at.full}>
                  {at.text}
                </time>
              ),
              id: 'claimed',
            },
            { label: 'Tool credentials', value: 'None created', id: 'credentials' },
          ]}
        />
        {pairing.state === 'claimed' ? (
          <>
            <Help tone="warn">
              <strong>Approve only if this matches your terminal.</strong> If your terminal shows a
              different fingerprint, or said the code was already used, someone else claimed it:
              deny it and start again.
            </Help>
            <div className="dv3w-actions">
              <button
                type="button"
                className="dx-btn dx-btn-primary"
                disabled={busy}
                aria-busy={busy || undefined}
                onClick={() => {
                  decide(true);
                }}
              >
                Approve {pairing.display_name}
              </button>
              <button
                type="button"
                className="dx-btn dv3w-deny"
                disabled={busy}
                onClick={() => {
                  decide(false);
                }}
              >
                Deny
              </button>
            </div>
          </>
        ) : pairing.state === 'approved' ? (
          <WaitLine
            word="Approved"
            reason={`Waiting for ${pairing.display_name} to finish — your terminal says when`}
            trouble={pollTrouble}
          />
        ) : null}
      </div>
    );
    hint =
      pairing.state === 'approved'
        ? 'Paired only once the device proves it holds the key.'
        : 'Compare every character before you approve.';
  } else if (step === 4 && pairing !== undefined) {
    body = (
      <div className="dv3w-stack">
        <div className="dx-status-head">
          <span className="dx-orb">
            <DxIcon name="check" />
          </span>
          <div>
            <StatusChip
              tone="ok"
              word="Paired"
              reason={`${pairing.display_name} holds its own key`}
            />
          </div>
        </div>
        <DetailTiles
          items={[
            { label: 'Device', value: pairing.display_name, id: 'device' },
            { label: 'Type', value: pairing.kind === 'cloud' ? 'Cloud runner' : 'Local computer' },
            ...(pairing.claimed === null
              ? []
              : [
                  {
                    label: 'Key fingerprint',
                    value: <code>{pairing.claimed.key_fingerprint}</code>,
                    id: 'fingerprint',
                  },
                ]),
            { label: 'Tool credentials', value: 'None yet', id: 'credentials' },
          ]}
        />
        <Help>
          Next, add the coding tools you use on it. Each gets its own credential, fetched by the
          device — never shown in this browser.
        </Help>
      </div>
    );
    hint = 'Add a coding tool next.';
    primary =
      pairing.device_id === null ? null : (
        <button
          type="button"
          className="dx-btn dx-btn-primary"
          onClick={() => {
            if (pairing.device_id !== null) onAddTool(pairing.device_id);
          }}
        >
          Add a tool to {pairing.display_name} <span aria-hidden="true">→</span>
        </button>
      );
  }

  // A request that ended without pairing.
  const ended =
    pairing !== undefined &&
    (pairing.state === 'denied' || pairing.state === 'expired' || pairing.state === 'cancelled');
  if (ended) {
    const words = {
      denied: 'Denied. Nothing was paired, and the code no longer works.',
      expired: 'This code expired before the device finished. Nothing was paired.',
      cancelled: 'This request was cancelled. Nothing was paired.',
    } as const;
    body = (
      <div className="dv3w-stack">
        <p className="dv3w-ended" data-ended={pairing.state}>
          {words[pairing.state]}
        </p>
      </div>
    );
    hint = 'Start again for a new code.';
    primary = (
      <button type="button" className="dx-btn dx-btn-primary" onClick={startAgain}>
        Start again
      </button>
    );
  }

  const lines: Readonly<Record<Step, string>> = {
    1: 'The computer is separate from the coding tools you add to it afterwards.',
    2: `Run the pairing step in a terminal on ${displayName || 'the device'}. No coding tool needs to be open.`,
    3: `${displayName} claimed the code with this key. Approve it before its first tool.`,
    4: `${displayName} is paired with this board.`,
  };
  const railStep: 1 | 2 | 3 = step === 4 ? 3 : step;
  const pairedDone = step === 4 && !ended;

  return (
    <section className="dv3w" aria-label="Add a device" data-wizard="device" data-step={step}>
      <LiveRegion message={message} />
      <SectionTitle
        title="Add device"
        titleId={`${ids}-section`}
        actions={
          <button type="button" className="dx-btn dx-btn-sm" onClick={close}>
            Back to devices
          </button>
        }
      />
      <DesignWizard
        railTitle="Connect a device"
        railIntro="Set up your computer once."
        railLabel="Pairing steps"
        current={railStep}
        steps={RAIL.map(({ n, name: stepName, sub }) => ({
          n,
          name: stepName,
          sub: n < railStep || (n === 3 && pairedDone) ? 'Done' : n === railStep ? 'Now' : sub,
          done: n < railStep || (n === 3 && pairedDone),
          open: n === railStep,
          lockedReason: n > railStep ? 'Each step opens when the board moves on' : undefined,
        }))}
        onSelect={() => undefined}
        step={railStep}
        total={3}
        kind="Device"
        title={ended ? 'Not paired' : STEP_NAMES[step]}
        line={lines[step]}
        titleId={`${ids}-title`}
        titleRef={titleRef}
        note={hint}
        actions={
          <>
            <button type="button" className="dx-btn" onClick={close}>
              {step === 4 || ended ? 'Done' : pairing === undefined ? 'Cancel' : 'Cancel pairing'}
            </button>
            {primary}
          </>
        }
      >
        {body}
        {refusal !== undefined && (
          <div className="dv3w-error" role="alert">
            <p>{refusal.message}</p>
            {refusal.startAgain && (
              <button type="button" className="dx-btn dx-btn-sm" onClick={startAgain}>
                Start again
              </button>
            )}
          </div>
        )}
      </DesignWizard>
    </section>
  );
}

/** The live wait: a status chip, and any trouble reaching the board in words. */
function WaitLine({
  word,
  reason,
  trouble,
}: {
  readonly word: string;
  readonly reason: string;
  readonly trouble: string | undefined;
}) {
  return (
    <div className="dv3w-wait" data-waiting>
      <StatusChip tone="waiting" word={word} reason={reason} />
      {trouble !== undefined && <p className="dv3w-quiet">{trouble}</p>}
    </div>
  );
}
