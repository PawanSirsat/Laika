import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { AgentChip } from '../../../components/agent/AgentChip.tsx';
import { AgentReadiness } from '../../../components/agent/AgentReadiness.tsx';
import { RegistrationSteps } from '../../../components/agent/RegistrationSteps.tsx';
import { REGISTRATION_STEPS } from '../../../components/agent/agent-states.ts';
import {
  agentHarness,
  agentState,
  getAgent,
  listAgents,
  liveToken,
  overlayWrites,
  registerAgent,
  revokeAgent,
  mintedTokenSeen,
  rotateAgentToken,
  setAgentGrants,
  updateAgent,
  type AgentGrant,
  type AgentWrite,
  type CreatedAgentToken,
  type RegisteredAgent,
} from '../../../api/agents.ts';
import { everyPage } from '../../../api/every-page.ts';
import type { MeProfile } from '../../../api/me.ts';
import { useGates } from '../../../api/permissions.ts';
import { isTombstone, listProjects, type Project } from '../../../api/projects.ts';
import { agentDevice } from '../../../api/selected-agent.ts';
import { lastUsedLabel } from '../../../api/tokens.ts';
import { AGENT_GUIDES, guideFor, setupBlocks } from '../connect/connect-agents.ts';
import { suggestTokenName } from '../connect/connect-token-name.ts';
import { SetupBlockView } from '../connect/ConnectScreen.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { agentReadiness } from './agent-readiness.ts';
import {
  agentFooterHint,
  agentStepOpen,
  choicesFrom,
  deviceProblem,
  grantsFrom,
  nameProblem,
  sameGrants,
  VERIFY_BUDGET_MS,
  VERIFY_POLL_MS,
  VERIFY_REQUEST_TIMEOUT_MS,
  verifyStateFrom,
  type AgentStep,
  type GrantChoice,
  type VerifyState,
} from './agent-wizard.ts';
import '../tokens/tokens.css';
import './agents.css';

export interface AgentsTabProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
}

/**
 * Developer access → Agents (proposal §6, LAI-537; API by LAI-534).
 *
 * The reader's registered agents, and a five-step wizard to add one. Every
 * value on this tab comes from `/api/v1/agents` and `/api/v1/projects` — the
 * agent's name, harness, device, grants and stamps — and nothing is filled in
 * when they are absent.
 *
 * ## The secret, once
 *
 * Registering and rotating each answer with one plaintext. It lives in
 * component state and nowhere else — not the address, not storage, not a log —
 * and leaves through {@link useOnceSecret}'s two-step forget, the pattern
 * `TokensScreen` measured: blanked through state first, so React's retained
 * tree does not keep it, then unmounted.
 */
export function AgentsTab({ me, origin }: AgentsTabProps) {
  const gates = useGates(me !== undefined);
  // §3.1: managing is a web session's, which this page always is — but the
  // server is the one that says so, through the permissions it reports.
  const canManage = gates.org('agent.manage_own');
  const confirm = useConfirm();

  const [agents, setAgents] = useState<readonly RegisteredAgent[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [projects, setProjects] = useState<readonly Project[] | undefined>(undefined);
  const [projectsError, setProjectsError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());
  const [wizard, setWizard] = useState(false);
  /**
   * The agent the open wizard registered, whose secret the wizard still
   * shows. Its row offers no rotate or revoke meanwhile (review round 1): a
   * rotation there would leave the wizard showing, and verifying, a revoked
   * credential.
   */
  const [wizardAgent, setWizardAgent] = useState<string | undefined>(undefined);
  /**
   * An agent whose registration answered after its wizard closed, and the
   * token nobody saw. The notice about it goes once that token is replaced or
   * the agent revoked — the reader has acted on it.
   */
  const [abandoned, setAbandoned] = useState<
    { readonly id: string; readonly name: string; readonly tokenId: string | undefined } | undefined
  >(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const registerButton = useRef<HTMLButtonElement | null>(null);

  /**
   * **An older answer never overwrites a newer one** (review round 3). Cancel
   * starts a reload; a registration that answers late then adds its row; and
   * the reload, asked before that row existed, used to land last and erase
   * it. So:
   *
   * - each read carries a generation, and one that lands after a newer read
   *   has been applied is dropped;
   * - each row the screen writes is numbered (`put`), and a read lays every
   *   write made since it began over what it got (`overlayWrites`).
   */
  const readGen = useRef(0);
  /**
   * How many list reads have settled, applied or dropped — written to the
   * card as `data-reads-settled`, so a test can wait for a stale answer to
   * have been *handled* rather than for a fixed time (review round 4).
   */
  const [readsSettled, setReadsSettled] = useState(0);
  const appliedGen = useRef(0);
  const writeSeq = useRef(0);
  const writes = useRef(new Map<string, AgentWrite>());

  const reload = useCallback((signal?: AbortSignal): void => {
    readGen.current += 1;
    const gen = readGen.current;
    const since = writeSeq.current;
    /**
     * Success and failure alike pass one check (review round 4): an outcome
     * from a read older than one already applied is dropped, and applying
     * either outcome advances the mark. Otherwise an older failure could hide
     * a newer list, and an older success could clear a newer failure.
     */
    const settle = (apply: () => void): void => {
      if (gen >= appliedGen.current) {
        appliedGen.current = gen;
        apply();
      }
      setReadsSettled((n) => n + 1);
    };
    everyPage((cursor) =>
      listAgents(signal, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }),
    )
      .then(({ items }) => {
        settle(() => {
          setAgents(overlayWrites(items, writes.current.values(), since));
          setLoadError(null);
          setNow(Date.now());
          // Writes this read already includes need no overlay any more.
          for (const [id, write] of writes.current) {
            if (write.seq <= since) writes.current.delete(id);
          }
        });
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        settle(() => {
          setLoadError(cause);
        });
      });
  }, []);

  /**
   * The projects the reader can see. **Unloaded is not empty** (review round
   * 1): until this answers, `projects` stays `undefined`, a failure is kept
   * and shown with a retry, and nothing that writes grants is enabled — a
   * grants payload built from a list that never loaded would replace every
   * grant with none.
   */
  const loadProjects = useCallback((signal?: AbortSignal): void => {
    setProjectsError(null);
    everyPage((cursor) =>
      listProjects(cursor === undefined ? { limit: 100 } : { limit: 100, cursor }, signal),
    )
      .then(({ items }) => {
        setProjects(items.filter((p): p is Project => !isTombstone(p)));
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setProjectsError(cause);
      });
  }, []);
  const retryProjects = useCallback((): void => {
    loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    loadProjects(controller.signal);
    return () => {
      controller.abort();
    };
  }, [reload, loadProjects]);

  /** One agent's fresh row, folded in without refetching the list. */
  const put = (agent: RegisteredAgent): void => {
    writeSeq.current += 1;
    writes.current.set(agent.id, { agent, seq: writeSeq.current });
    setAgents((current) => {
      if (current === undefined) return [agent];
      const at = current.findIndex((a) => a.id === agent.id);
      return at === -1 ? [agent, ...current] : current.map((a) => (a.id === agent.id ? agent : a));
    });
    setNow(Date.now());
  };

  // Focus goes back to *Register an agent* when the wizard closes — after the
  // render that brings the button back, which a microtask would run before.
  const refocus = useRef(false);
  useEffect(() => {
    if (wizard || !refocus.current) return;
    refocus.current = false;
    registerButton.current?.focus();
  }, [wizard]);

  const closeWizard = (): void => {
    refocus.current = true;
    setWizard(false);
    setWizardAgent(undefined);
    reload();
  };

  const viewer = me?.org_role === 'viewer';

  // The notice stands until that agent is revoked or its unseen token replaced.
  const abandonedRow =
    abandoned === undefined ? undefined : agents?.find((a) => a.id === abandoned.id);
  const abandonedStands =
    abandonedRow === undefined ||
    (abandonedRow.status === 'active' && abandonedRow.tokens[0]?.id === abandoned?.tokenId);

  const revoke = (agent: RegisteredAgent): void => {
    void confirm({
      title: `Revoke “${agent.display_name}”?`,
      body: 'Every token it holds stops working at once, and the agent cannot be restored. Your own tokens and your other agents are not touched. Its history keeps its name.',
      confirmLabel: 'Revoke agent',
      danger: true,
      icon: 'warning',
    }).then((yes) => {
      if (!yes) return;
      setActionError(undefined);
      revokeAgent(agent.id)
        .then(put)
        .catch((cause: unknown) => {
          setActionError(errorText(cause, 'Could not revoke that agent.'));
        });
    });
  };

  return (
    <div className="dev-card agents" data-testid="agents-tab" data-reads-settled={readsSettled}>
      <div className="dev-card-head">
        <h2 className="dev-card-title" id="agents-title">
          Registered agents
        </h2>
        {agents !== undefined && (
          <span className="conn-chip conn-chip-scope">
            {agents.length} {agents.length === 1 ? 'agent' : 'agents'}
          </span>
        )}
        {canManage && !wizard && (
          <button
            type="button"
            ref={registerButton}
            className="bar-control bar-control-primary"
            onClick={() => {
              setWizard(true);
            }}
          >
            + Register an agent
          </button>
        )}
      </div>

      <p className="agents-intro">
        An agent is its own identity on this board: it acts as you, never with more than you can
        reach, through a credential of its own — so you can see which agent did what, narrow it to
        some projects, and rotate or revoke it without touching your own tokens.
      </p>

      {!canManage && gates.settled && (
        <p className="agents-note" role="note">
          Registering and changing agents needs a signed-in browser session. This one is not allowed
          to — the list below is read only.
        </p>
      )}

      {wizard && (
        <RegisterWizard
          me={me}
          origin={origin}
          projects={projects}
          projectsError={projectsError}
          onRetryProjects={retryProjects}
          viewer={viewer}
          onRegistered={(agent) => {
            setWizardAgent(agent.id);
            put(agent);
          }}
          onAbandoned={(agent) => {
            // Created on the server after the wizard was gone: listed, never
            // locked, and its secret was never kept (review round 2).
            put(agent);
            setAbandoned({ id: agent.id, name: agent.display_name, tokenId: agent.tokens[0]?.id });
          }}
          onClose={closeWizard}
        />
      )}

      {abandoned !== undefined && abandonedStands && (
        <p className="agents-note" role="status">
          “{abandoned.name}” was registered after you cancelled, so its credential was never shown
          and nobody holds it. Rotate its token to get one, or revoke it.
        </p>
      )}

      {actionError !== undefined && (
        <p className="agents-error" role="alert">
          {actionError}
        </p>
      )}

      {loadError !== null ? (
        <ApiErrorState
          error={loadError}
          resource="your agents"
          scope="organisation"
          onRetry={() => {
            setLoadError(null);
            reload();
          }}
        />
      ) : agents === undefined ? (
        <LoadingState shape="row" count={3} label="Loading your agents" />
      ) : agents.length === 0 ? (
        <EmptyState
          headline="No agents registered yet"
          body="Register one to give a coding agent its own credential, narrowed to the projects you choose."
        />
      ) : (
        <ul className="agents-list" aria-labelledby="agents-title">
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              now={now}
              me={me}
              projects={projects}
              projectsError={projectsError}
              onRetryProjects={retryProjects}
              viewer={viewer}
              canManage={canManage}
              heldByWizard={agent.id === wizardAgent}
              onChanged={put}
              onRevoke={revoke}
              confirmRotate={confirm}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ the secret

/** A reveal's copy of the answer: the one object that carries the plaintext. */
interface HeldSecret {
  readonly agent: RegisteredAgent;
  readonly token: CreatedAgentToken['token'];
  secret: string;
}

/**
 * A plaintext held for one reveal.
 *
 * - **`forget`** blanks it **through state** and then drops it on the next
 *   tick — `TokensScreen`'s measured pattern: set straight to `undefined`,
 *   React's previous hook state still holds the string; overwritten first,
 *   neither the current nor the retained tree does. A caller that unmounts
 *   afterwards waits for `held` to be `undefined` — both renders committed —
 *   before it does (review round 1: unmounting at once meant the blanking
 *   render never committed).
 * - **`retire`** blanks it and keeps the rest, for a credential that stopped
 *   working while its screen stays open.
 * - **On unmount** — a tab change, a route change — no render can run, so
 *   the held object's own `secret` is overwritten in place, and anything
 *   still referencing that object finds `''`.
 *
 * **What the tests prove, and what they do not.** `agents-tab.test.ts` shows
 * that after Close the wizard's last frame was already blank (a mutant that
 * unmounts at once goes red), and that after Close or leaving the tab the
 * secret is in neither the DOM nor anything React's root still reaches. The
 * unmount scrub is **not** proved by them: React 19 detaches an unmounted
 * subtree itself, and the walk comes back clean with or without the scrub
 * (measured). It stays as defence for a reference no walk can see, such as a
 * closure, and makes no stronger claim than that.
 */
function useOnceSecret() {
  const [held, setHeldState] = useState<HeldSecret | undefined>(undefined);
  const box = useRef<HeldSecret | undefined>(undefined);
  const scrub = (): void => {
    if (box.current !== undefined) box.current.secret = '';
  };
  const hold = useCallback((answer: CreatedAgentToken): void => {
    scrub();
    const copy: HeldSecret = { agent: answer.agent, token: answer.token, secret: answer.secret };
    box.current = copy;
    setHeldState(copy);
  }, []);
  const retire = useCallback((): void => {
    setHeldState((current) => {
      if (current === undefined) return undefined;
      const blank: HeldSecret = { ...current, secret: '' };
      scrub();
      box.current = blank;
      return blank;
    });
  }, []);
  const forget = useCallback((): void => {
    retire();
    setTimeout(() => {
      scrub();
      box.current = undefined;
      setHeldState(undefined);
    }, 0);
  }, [retire]);
  useEffect(
    () => () => {
      scrub();
      box.current = undefined;
    },
    [],
  );
  return { held, hold, retire, forget } as const;
}

function SecretPanel({
  created,
  title,
  onDone,
  doneLabel = 'Done',
}: {
  readonly created: HeldSecret;
  readonly title: string;
  readonly onDone?: (() => void) | undefined;
  readonly doneLabel?: string;
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <section className="tok-reveal agents-secret" role="alert" tabIndex={-1} ref={ref}>
      <h3 className="tok-reveal-title">{title}</h3>
      <p className="tok-reveal-body">
        This is <strong>{created.agent.display_name}</strong>’s own credential and the only copy of
        it. Laika stores a hash, not the secret, so nobody can show it to you again. Keep it on the
        machine the agent runs on — never in a repository, a chat or a screenshot.
      </p>
      <div className="tok-reveal-row">
        <code className="tok-secret" data-testid="agent-secret">
          {created.secret}
        </code>
        <CopyButton text={created.secret} what="the agent’s token" className="tok-copy" />
        {onDone !== undefined && (
          <button type="button" className="tok-dismiss" onClick={onDone}>
            {doneLabel}
          </button>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ the wizard

interface WizardProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
  readonly projects: readonly Project[] | undefined;
  readonly projectsError: unknown;
  readonly onRetryProjects: () => void;
  readonly viewer: boolean;
  readonly onRegistered: (agent: RegisteredAgent) => void;
  /** Registration answered after this wizard closed or unmounted. Never carries the secret. */
  readonly onAbandoned: (agent: RegisteredAgent) => void;
  readonly onClose: () => void;
}

function RegisterWizard({
  me,
  origin,
  projects,
  projectsError,
  onRetryProjects,
  viewer,
  onRegistered,
  onAbandoned,
  onClose,
}: WizardProps) {
  const [step, setStep] = useState<AgentStep>(1);
  const [guideId, setGuideId] = useState(AGENT_GUIDES[0]?.id ?? 'claude-code');
  const guide = guideFor(guideId);
  const [name, setName] = useState(() => suggestTokenName(navigator.userAgent, guide.tokenWord));
  const nameTouched = useRef(false);
  const [device, setDevice] = useState('');
  const [choices, setChoices] = useState<Map<string, GrantChoice>>(() => new Map());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const { held: created, hold, retire, forget } = useOnceSecret();
  const [closing, setClosing] = useState(false);
  const [verify, setVerify] = useState<VerifyState>({ kind: 'watching' });
  const [round, setRound] = useState(0);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  const registered = created !== undefined;
  // `''` once retired or forgotten: a placeholder in the blocks, never a token.
  const secret = created === undefined || created.secret === '' ? undefined : created.secret;
  const order = (projects ?? []).map((p) => p.id);
  const grants = grantsFrom(choices, order, viewer);
  const nameError = nameProblem(name);
  const deviceError = deviceProblem(device);

  // Focus follows the step, as Connect's does: into the wizard when it opens,
  // and to each step's title as the reader moves.
  useEffect(() => {
    titleRef.current?.focus();
  }, [step]);

  /**
   * Close in three commits, never one: blank the secret, drop it, and only
   * then unmount — the effect below waits for `created` to be gone.
   */
  const close = (): void => {
    if (closing) return;
    live.current = false;
    forget();
    setClosing(true);
  };

  /**
   * Whether an answer may still land here (review round 2). *Cancel* stays
   * available while registration is in flight, so the answer can arrive after
   * Close or after the tab unmounted. Such an answer must not reach `hold` —
   * which would put the secret back after the scrub — nor `onRegistered`,
   * which would lock the agent's row for a wizard that no longer exists. It
   * goes to `onAbandoned` with the agent alone; the secret is dropped with
   * the response. Set again on mount, for React's development double mount.
   */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const abandonedRef = useRef(onAbandoned);
  abandonedRef.current = onAbandoned;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (closing && created === undefined) closeRef.current();
  }, [closing, created]);

  const register = (): void => {
    setPending(true);
    setError(undefined);
    registerAgent({
      display_name: name.trim(),
      harness: guide.client,
      device_label: device.trim() === '' ? null : device.trim(),
      grants,
    })
      .then((answer) => {
        if (!live.current) {
          abandonedRef.current(answer.agent);
          return;
        }
        hold(answer);
        onRegistered(answer.agent);
      })
      .catch((cause: unknown) => {
        if (live.current) setError(errorText(cause, 'Could not register that agent.'));
      })
      .finally(() => {
        if (live.current) setPending(false);
      });
  };

  // Step 5: ask the agent's row until the token minted here shows a request.
  // A chain of timeouts, not an interval: the next request is scheduled only
  // once the last one settled, each is abandoned after a timeout, and the
  // whole watch ends at a wall-clock deadline (review round 1).
  const registeredRef = useRef(onRegistered);
  registeredRef.current = onRegistered;
  const retireRef = useRef(retire);
  retireRef.current = retire;
  const agentId = created?.agent.id;
  const minted = created?.token;
  useEffect(() => {
    if (step !== 5 || agentId === undefined || minted === undefined) return;
    const started = Date.now();
    let stopped = false;
    let inflight: AbortController | undefined;
    let next: ReturnType<typeof setTimeout> | undefined;

    const finish = (state: VerifyState): void => {
      stopped = true;
      clearTimeout(next);
      clearTimeout(deadline);
      inflight?.abort();
      setVerify(state);
    };
    const deadline = setTimeout(() => {
      finish({ kind: 'spent' });
    }, VERIFY_BUDGET_MS);
    const schedule = (): void => {
      if (!stopped) next = setTimeout(ask, VERIFY_POLL_MS);
    };
    function ask(): void {
      if (stopped) return;
      const controller = new AbortController();
      inflight = controller;
      const timeout = setTimeout(() => {
        controller.abort();
      }, VERIFY_REQUEST_TIMEOUT_MS);
      getAgent(agentId ?? '', controller.signal)
        .then((agent) => {
          if (stopped || minted === undefined) return;
          const state = verifyStateFrom(mintedTokenSeen(agent, minted), Date.now() - started);
          if (state.kind === 'watching') {
            schedule();
            return;
          }
          finish(state);
          if (state.kind === 'verified') registeredRef.current(agent);
          if (state.kind === 'replaced') {
            // The setup shown can no longer work: take its secret off the page.
            retireRef.current();
            registeredRef.current(agent);
          }
        })
        .catch((cause: unknown) => {
          if (stopped) return;
          // A request the timeout abandoned is a miss, not a failure.
          if (cause instanceof DOMException && cause.name === 'AbortError') {
            schedule();
            return;
          }
          finish({ kind: 'error', error: cause });
        })
        .finally(() => {
          clearTimeout(timeout);
          if (inflight === controller) inflight = undefined;
        });
    }

    setVerify({ kind: 'watching' });
    ask();
    return () => {
      stopped = true;
      clearTimeout(next);
      clearTimeout(deadline);
      inflight?.abort();
    };
    // `round` restarts the watch; the parent's fold is read through a ref.
  }, [step, agentId, minted, round]);

  const canForward = ((): boolean => {
    switch (step) {
      case 1:
        return nameError === undefined && deviceError === undefined;
      case 2:
        return projects !== undefined;
      case 3:
        return registered;
      case 4:
        return true;
      case 5:
        return false;
    }
  })();

  const go = (to: AgentStep): void => {
    if (!agentStepOpen(to, registered)) return;
    setStep(to);
  };

  const blocks =
    created === undefined
      ? []
      : setupBlocks(guide.id, { origin, secret }).filter((b) => b.group !== 'alternative');

  return (
    <section className="agents-wizard" aria-labelledby="agents-step-title" data-step={step}>
      {/* LAI-536's step rail. Moving between steps is Back and Continue: the
          rail says where the reader is, in words, and is not a control. */}
      <RegistrationSteps current={step - 1} />

      <div className="agents-card">
        <header className="agents-card-head">
          <p className="conn-eyebrow">Step {String(step)} of 5</p>
          <h3 className="agents-card-title" id="agents-step-title" tabIndex={-1} ref={titleRef}>
            {REGISTRATION_STEPS[step - 1]}
          </h3>
        </header>

        <div className="agents-card-body">
          {step === 1 && (
            <div className="agents-fields">
              <label className="agents-field">
                <span className="agents-label">Name</span>
                <input
                  className="tok-input"
                  value={name}
                  maxLength={120}
                  aria-invalid={nameError !== undefined}
                  onChange={(event) => {
                    nameTouched.current = true;
                    setName(event.target.value);
                  }}
                />
                <span className="agents-hint">
                  {nameError ??
                    'Your name for it, shown here. Cards and history name it by harness and device, and add this name where two of your agents share both.'}
                </span>
              </label>
              <div className="agents-field">
                <span className="agents-label" id="agents-harness-label">
                  Harness
                </span>
                <Dropdown
                  value={guideId}
                  aria-labelledby="agents-harness-label"
                  noun="harnesses"
                  options={AGENT_GUIDES.map((g) => ({ value: g.id, label: g.name }))}
                  onChange={(id) => {
                    setGuideId(id);
                    if (!nameTouched.current) {
                      setName(suggestTokenName(navigator.userAgent, guideFor(id).tokenWord));
                    }
                  }}
                />
                <span className="agents-hint">
                  Self-reported: it labels the agent and picks the setup steps. It grants nothing.
                </span>
              </div>
              <label className="agents-field">
                <span className="agents-label">Device</span>
                <input
                  className="tok-input"
                  value={device}
                  placeholder="work laptop"
                  maxLength={120}
                  aria-invalid={deviceError !== undefined}
                  onChange={(event) => {
                    setDevice(event.target.value);
                  }}
                />
                <span className="agents-hint">
                  {deviceError ?? 'Optional and self-reported — which machine it runs on.'}
                </span>
              </label>
            </div>
          )}

          {step === 2 && (
            <GrantEditor
              projects={projects}
              projectsError={projectsError}
              onRetry={onRetryProjects}
              choices={choices}
              viewer={viewer}
              onChange={setChoices}
              disabled={registered}
            />
          )}

          {step === 3 && (
            <div className="agents-credential">
              {!registered && (
                <>
                  <dl className="agents-summary">
                    <div>
                      <dt>Name</dt>
                      <dd>{name.trim()}</dd>
                    </div>
                    <div>
                      <dt>Harness</dt>
                      <dd>{guide.name} (self-reported)</dd>
                    </div>
                    <div>
                      <dt>Device</dt>
                      <dd>
                        {device.trim() === '' ? 'Not given' : `${device.trim()} (self-reported)`}
                      </dd>
                    </div>
                    <div>
                      <dt>Projects</dt>
                      <dd>{grantSummary(grants, projects)}</dd>
                    </div>
                  </dl>
                  {me !== undefined && viewer && (
                    <p className="agents-note">
                      Your organisation role is viewer, so the agent’s credential reads and writes
                      nothing.
                    </p>
                  )}
                  <button
                    type="button"
                    className="bar-control bar-control-primary"
                    disabled={pending}
                    aria-busy={pending}
                    onClick={register}
                  >
                    {pending && <Spinner size="sm" />}
                    Register and create its credential
                  </button>
                </>
              )}
              {created !== undefined && secret !== undefined && (
                <SecretPanel created={created} title="Copy this now — it is not shown again" />
              )}
              {created !== undefined && secret === undefined && !closing && (
                <p className="agents-note" role="alert">
                  This credential has been rotated or revoked, so it is no longer shown. Close this
                  and use the agent’s current credential.
                </p>
              )}
            </div>
          )}

          {step === 4 && created !== undefined && (
            <div className="agents-setup">
              <p className="agents-note">
                These carry <strong>{created.agent.display_name}</strong>’s token, not yours. Run
                them on the machine the agent works from.
              </p>
              {blocks.map((block) => (
                <SetupBlockView
                  key={block.key}
                  block={block}
                  secret={secret}
                  tokenTag="carries the agent’s token"
                />
              ))}
            </div>
          )}

          {step === 5 && created !== undefined && (
            <VerifyPanel
              state={verify}
              agentName={created.agent.display_name}
              onRetry={() => {
                setRound((n) => n + 1);
              }}
            />
          )}

          {error !== undefined && (
            <p className="agents-error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="agents-card-foot">
          <button type="button" className="bar-control" disabled={closing} onClick={close}>
            {registered ? 'Close' : 'Cancel'}
          </button>
          <span className="agents-foot-hint">
            {agentFooterHint(step, registered, verify.kind === 'verified')}
          </span>
          {step > 1 && agentStepOpen((step - 1) as AgentStep, registered) && (
            <button
              type="button"
              className="bar-control"
              onClick={() => {
                go((step - 1) as AgentStep);
              }}
            >
              Back
            </button>
          )}
          {step < 5 ? (
            <button
              type="button"
              className="bar-control bar-control-primary"
              disabled={!canForward}
              onClick={() => {
                go((step + 1) as AgentStep);
              }}
            >
              Continue
            </button>
          ) : (
            <button
              type="button"
              className="bar-control bar-control-primary"
              disabled={closing}
              onClick={close}
            >
              Done
            </button>
          )}
        </footer>
      </div>
    </section>
  );
}

function VerifyPanel({
  state,
  agentName,
  onRetry,
}: {
  readonly state: VerifyState;
  readonly agentName: string;
  readonly onRetry: () => void;
}) {
  return (
    <div className="agents-verify" data-state={state.kind} aria-live="polite">
      {state.kind === 'watching' && (
        <p className="agents-verify-line">
          <Spinner size="sm" />
          <span>
            Waiting for a request authenticated as <strong>{agentName}</strong>…
          </span>
        </p>
      )}
      {state.kind === 'verified' && (
        <p className="agents-verify-line agents-verify-ok">
          <span>
            Connected — the board has seen a request from <strong>{agentName}</strong>’s own
            credential.
          </span>
        </p>
      )}
      {state.kind === 'spent' && (
        <>
          <p className="agents-verify-line">
            Nothing from <strong>{agentName}</strong> yet. It stays registered with its credential
            created; start the agent and look again.
          </p>
          <button type="button" className="bar-control" onClick={onRetry}>
            Check again
          </button>
        </>
      )}
      {state.kind === 'replaced' && (
        <p className="agents-verify-line" role="alert">
          The credential created here was rotated or revoked before <strong>{agentName}</strong>{' '}
          used it, so this setup can no longer connect. Close this and set the agent up with its
          current credential.
        </p>
      )}
      {state.kind === 'error' && (
        <ApiErrorState error={state.error} resource="this agent" onRetry={onRetry} />
      )}
      <p className="agents-hint">
        Only this agent’s credential can complete this step: your own session and your other tokens
        do not. It proves the credential reached the board — not which program sent it.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ grants

function GrantEditor({
  projects,
  projectsError,
  onRetry,
  choices,
  viewer,
  onChange,
  disabled = false,
}: {
  readonly projects: readonly Project[] | undefined;
  readonly projectsError: unknown;
  readonly onRetry: () => void;
  readonly choices: ReadonlyMap<string, GrantChoice>;
  readonly viewer: boolean;
  readonly onChange: (next: Map<string, GrantChoice>) => void;
  readonly disabled?: boolean;
}) {
  if (projectsError !== null) {
    return <ApiErrorState error={projectsError} resource="your projects" onRetry={onRetry} />;
  }
  if (projects === undefined)
    return <LoadingState shape="row" count={2} label="Loading projects" />;
  if (projects.length === 0) {
    return (
      <p className="agents-note">
        You can see no projects yet, so there is nothing to grant. The agent can be registered and
        reach nothing until you give it a project.
      </p>
    );
  }
  const options: readonly { value: GrantChoice; label: string }[] = [
    { value: 'none', label: 'No access' },
    { value: 'read_only', label: 'Read only' },
    { value: 'full', label: 'Full' },
  ];
  return (
    <div className="agents-grants">
      <p className="agents-hint">
        Only projects you can see are listed. The agent never reaches more than you do, and a
        project left at No access is closed to it.
      </p>
      {viewer && (
        <p className="agents-note">
          Your organisation role is viewer, so the most an agent of yours can have is read only.
        </p>
      )}
      <ul className="agents-grant-list">
        {projects.map((project) => {
          const current = choices.get(project.id) ?? 'none';
          return (
            <li key={project.id} className="agents-grant">
              <fieldset className="agents-grant-set" disabled={disabled}>
                <legend className="agents-grant-name">
                  <span className="agents-grant-prefix">{project.prefix}</span> {project.name}
                </legend>
                <div className="agents-grant-options">
                  {options.map((option) => (
                    <label key={option.value} className="agents-grant-option">
                      <input
                        type="radio"
                        name={`grant-${project.id}`}
                        checked={current === option.value}
                        disabled={viewer && option.value === 'full'}
                        onChange={() => {
                          const next = new Map(choices);
                          next.set(project.id, option.value);
                          onChange(next);
                        }}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function grantSummary(
  grants: readonly AgentGrant[],
  projects: readonly Project[] | undefined,
): string {
  if (grants.length === 0) return 'None — it reaches no project';
  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  return grants
    .map(
      (g) =>
        `${names.get(g.project_id) ?? 'A project you cannot see'} (${g.scope === 'full' ? 'full' : 'read only'})`,
    )
    .join(', ');
}

// ------------------------------------------------------------------ one agent

interface RowProps {
  readonly agent: RegisteredAgent;
  readonly now: number;
  readonly me: MeProfile | undefined;
  readonly projects: readonly Project[] | undefined;
  readonly projectsError: unknown;
  readonly onRetryProjects: () => void;
  readonly viewer: boolean;
  readonly canManage: boolean;
  /** The open wizard is still showing this agent's first secret. */
  readonly heldByWizard: boolean;
  readonly onChanged: (agent: RegisteredAgent) => void;
  readonly onRevoke: (agent: RegisteredAgent) => void;
  readonly confirmRotate: ReturnType<typeof useConfirm>;
}

type Panel = 'none' | 'rename' | 'access';

function AgentRow({
  agent,
  now,
  me,
  projects,
  projectsError,
  onRetryProjects,
  viewer,
  canManage,
  heldByWizard,
  onChanged,
  onRevoke,
  confirmRotate,
}: RowProps) {
  const state = agentState(agent, now);
  const readiness = agentReadiness(agent, now);
  const active = agent.status === 'active';
  const [panel, setPanel] = useState<Panel>('none');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const { held: rotated, hold: holdRotated, forget } = useOnceSecret();
  const renameButton = useRef<HTMLButtonElement | null>(null);
  const accessButton = useRef<HTMLButtonElement | null>(null);
  const rotateButton = useRef<HTMLButtonElement | null>(null);
  const live = liveToken(agent, now);
  // The list is the reader's own (the server filters it), so the owner is
  // the reader — named from `/me`, never assumed.
  const owner = me?.id === agent.owner_user_id ? `${me.name} (you)` : '—';

  const closePanel = (back: RefObject<HTMLButtonElement | null>): void => {
    setPanel('none');
    setError(undefined);
    queueMicrotask(() => back.current?.focus());
  };

  const rotate = (): void => {
    if (live === undefined || heldByWizard) return;
    void confirmRotate({
      title: `Rotate “${agent.display_name}”’s credential?`,
      body: 'A new token is created and the current one stops working at once. The agent keeps its name, grants and history; you give it the new token.',
      confirmLabel: 'Rotate token',
      icon: 'warning',
    }).then((yes) => {
      if (!yes) return;
      setBusy(true);
      setError(undefined);
      rotateAgentToken(agent.id, live.id)
        .then((answer) => {
          holdRotated(answer);
          onChanged(answer.agent);
        })
        .catch((cause: unknown) => {
          setError(errorText(cause, 'Could not rotate that token.'));
        })
        .finally(() => {
          setBusy(false);
        });
    });
  };

  return (
    <li className="agents-row" data-state={state} data-agent={agent.id}>
      <div className="agents-row-main">
        <span className="agents-row-name">{agent.display_name}</span>
        <span className="agents-row-meta">
          {/* Named as cards and history name it (LAI-536): harness and device. */}
          <AgentChip client={agentHarness(agent)} device={agentDevice(agent)} />
          <span className="agents-self">self-reported</span>
        </span>
      </div>

      {readiness === undefined ? (
        <p className="agents-revoked">Revoked — its credentials no longer work.</p>
      ) : (
        <AgentReadiness reached={readiness} />
      )}

      <dl className="agents-row-facts">
        <div>
          <dt>Owner</dt>
          <dd>{owner}</dd>
        </div>
        <div>
          <dt>Last seen</dt>
          <dd>
            {agent.last_seen_at === null
              ? 'Never seen'
              : lastUsedLabel(agent.last_seen_at, now).replace(/^Used/, 'Seen')}
          </dd>
        </div>
        <div>
          <dt>Projects</dt>
          <dd>{grantSummary(agent.grants, projects)}</dd>
        </div>
        <div>
          <dt>Credential</dt>
          <dd>{live === undefined ? 'None live' : <code>{live.prefix}…</code>}</dd>
        </div>
        <div>
          <dt>Recovery</dt>
          <dd>Not available yet</dd>
        </div>
      </dl>

      {canManage && active && (
        <div className="agents-row-actions">
          <button
            type="button"
            className="bar-control"
            ref={renameButton}
            aria-expanded={panel === 'rename'}
            onClick={() => {
              setPanel(panel === 'rename' ? 'none' : 'rename');
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="bar-control"
            ref={accessButton}
            aria-expanded={panel === 'access'}
            onClick={() => {
              setPanel(panel === 'access' ? 'none' : 'access');
            }}
          >
            Manage access
          </button>
          <button
            type="button"
            className="bar-control"
            ref={rotateButton}
            disabled={busy || live === undefined || heldByWizard}
            {...(heldByWizard ? { 'aria-describedby': `agents-held-${agent.id}` } : {})}
            onClick={rotate}
          >
            {busy && <Spinner size="sm" />}
            Rotate token
          </button>
          <button
            type="button"
            className="bar-control agents-danger"
            disabled={heldByWizard}
            {...(heldByWizard ? { 'aria-describedby': `agents-held-${agent.id}` } : {})}
            onClick={() => {
              onRevoke(agent);
            }}
          >
            Revoke
          </button>
          {heldByWizard && (
            <span className="agents-hint" id={`agents-held-${agent.id}`}>
              Finish or close its registration above to rotate or revoke it.
            </span>
          )}
        </div>
      )}

      {panel === 'rename' && (
        <RenameForm
          agent={agent}
          onSaved={(next) => {
            onChanged(next);
            closePanel(renameButton);
          }}
          onCancel={() => {
            closePanel(renameButton);
          }}
        />
      )}

      {panel === 'access' && (
        <AccessForm
          agent={agent}
          projects={projects}
          projectsError={projectsError}
          onRetryProjects={onRetryProjects}
          viewer={viewer}
          onSaved={(next) => {
            onChanged(next);
            closePanel(accessButton);
          }}
          onCancel={() => {
            closePanel(accessButton);
          }}
        />
      )}

      {rotated !== undefined && (
        <SecretPanel
          created={rotated}
          title="New credential — copy it now, it is not shown again"
          onDone={() => {
            forget();
            queueMicrotask(() => rotateButton.current?.focus());
          }}
        />
      )}

      {error !== undefined && (
        <p className="agents-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

function RenameForm({
  agent,
  onSaved,
  onCancel,
}: {
  readonly agent: RegisteredAgent;
  readonly onSaved: (agent: RegisteredAgent) => void;
  readonly onCancel: () => void;
}) {
  const [name, setName] = useState(agent.display_name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const problem = nameProblem(name);
  const save = (): void => {
    if (problem !== undefined || name.trim() === agent.display_name) return;
    setPending(true);
    setError(undefined);
    updateAgent(agent.id, { display_name: name.trim() })
      .then(onSaved)
      .catch((cause: unknown) => {
        setError(errorText(cause, 'Could not rename that agent.'));
      })
      .finally(() => {
        setPending(false);
      });
  };
  return (
    <form
      className="agents-panel"
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <label className="agents-field">
        <span className="agents-label">New name</span>
        <input
          ref={input}
          className="tok-input"
          value={name}
          maxLength={120}
          aria-invalid={problem !== undefined}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <span className="agents-hint">{problem ?? 'Its tokens are renamed with it.'}</span>
      </label>
      {error !== undefined && (
        <p className="agents-error" role="alert">
          {error}
        </p>
      )}
      <div className="agents-panel-actions">
        <button type="button" className="bar-control" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="bar-control bar-control-primary"
          disabled={pending || problem !== undefined || name.trim() === agent.display_name}
        >
          {pending && <Spinner size="sm" />}
          Save name
        </button>
      </div>
    </form>
  );
}

function AccessForm({
  agent,
  projects,
  projectsError,
  onRetryProjects,
  viewer,
  onSaved,
  onCancel,
}: {
  readonly agent: RegisteredAgent;
  readonly projects: readonly Project[] | undefined;
  readonly projectsError: unknown;
  readonly onRetryProjects: () => void;
  readonly viewer: boolean;
  readonly onSaved: (agent: RegisteredAgent) => void;
  readonly onCancel: () => void;
}) {
  const [choices, setChoices] = useState(() => choicesFrom(agent.grants));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /**
   * **Nothing is written until the projects have loaded** (review round 1).
   * An unloaded list read as `[]` made every grant "hidden", enabled *Save*,
   * and sent `grants: []` — wiping the agent's access. `loaded` is the list
   * itself, so a payload can only be built from projects that arrived.
   */
  const loaded = projectsError === null ? projects : undefined;
  const visible = loaded?.map((p) => p.id);
  // A grant on a project the reader can no longer see reaches nothing — the
  // agent never has more than its owner — and the server refuses to write
  // one (422), so saving drops it, and the form says so first.
  const hidden =
    visible === undefined ? [] : agent.grants.filter((g) => !visible.includes(g.project_id));
  const next = visible === undefined ? undefined : grantsFrom(choices, visible, viewer);
  const unchanged = next === undefined || sameGrants(next, agent.grants);
  const save = (): void => {
    if (next === undefined) return;
    setPending(true);
    setError(undefined);
    setAgentGrants(agent.id, next)
      .then(onSaved)
      .catch((cause: unknown) => {
        setError(errorText(cause, 'Could not change that agent’s access.'));
      })
      .finally(() => {
        setPending(false);
      });
  };
  return (
    <div
      className="agents-panel"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <GrantEditor
        projects={projects}
        projectsError={projectsError}
        onRetry={onRetryProjects}
        choices={choices}
        viewer={viewer}
        onChange={setChoices}
      />
      {hidden.length > 0 && (
        <p className="agents-hint">
          {hidden.length} {hidden.length === 1 ? 'grant is' : 'grants are'} on projects you cannot
          see any more. They reach nothing now, and saving removes them.
        </p>
      )}
      {error !== undefined && (
        <p className="agents-error" role="alert">
          {error}
        </p>
      )}
      <div className="agents-panel-actions">
        <button type="button" className="bar-control" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="bar-control bar-control-primary"
          disabled={pending || unchanged}
          onClick={save}
        >
          {pending && <Spinner size="sm" />}
          Save access
        </button>
      </div>
    </div>
  );
}

function errorText(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : fallback;
}
