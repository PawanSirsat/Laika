import { useEffect, useRef, useState } from 'react';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { AgentMark } from '../../../components/agent-mark/AgentMark.tsx';
import { everyPage } from '../../../api/every-page.ts';
import { canManageOrg } from '../../../api/invites.ts';
import { getOrg } from '../../../api/org.ts';
import { getPresence, hasLocation } from '../../../api/presence.ts';
import { pickProject } from '../../../api/pick-project.ts';
import {
  createToken,
  forcedTokenScope,
  listTokens,
  mayChooseScope,
  type CreatedToken,
} from '../../../api/tokens.ts';
import { useProjects } from '../../../api/use-projects.ts';
import type { MeProfile } from '../../../api/me.ts';
import {
  AGENT_GUIDES,
  guideFor,
  instructionsTarget,
  likelyCauses,
  setupBlocks,
  startGuide,
  type AgentChoice,
  type AgentGuide,
  type SetupBlock,
} from './connect-agents.ts';
import { projectBlock, type ProjectRef } from './connect-copy.ts';
import {
  connectedLabel,
  connectedNote,
  LIVE_POLL_MS,
  LIVE_TICKS,
  liveStateFrom,
  tokenLiveStateFrom,
  type LiveState,
} from './connect-live.ts';
import { suggestTokenName } from './connect-token-name.ts';
import {
  canContinue,
  commandRuns,
  footerHint,
  groupedAgents,
  railLabel,
  requirementChips,
  setupModes,
  stepOpen,
  WIZARD_STEPS,
  type SetupMode,
  type WizardStep,
} from './connect-wizard.ts';
import './connect.css';

/**
 * Connect — the front door for a developer with nothing set up (LAI-622), for
 * whichever coding agent they use (LAI-737).
 *
 * ## Why the secret is never stored twice
 *
 * The one-time plaintext lives in exactly one hook, and every string built from
 * it — the prompt, the commands, an inline config — is computed **during
 * render** and stored nowhere. A `useMemo` or a second `useState` holding "the
 * prompt text" would survive the blanking pass that {@link forget} performs and
 * defeat it entirely, one level of indirection out from where `TokensScreen`
 * measured the same failure.
 *
 * ## The agent choice
 *
 * Kept in `?agent=` so a lead can send a teammate the page already set to the
 * team's agent, and in `localStorage` so a person who comes back is not asked
 * again. The URL wins; storage is a convenience and may be unavailable, so
 * every read and write of it is allowed to fail.
 *
 * ## One step at a time (LAI-740)
 *
 * Laid out as a wizard on the owner's direct instruction: a rail of four steps
 * and one card showing the current one. Nothing the page *says* or *does*
 * changed with it — the blocks, the mint and the watch are the same calls —
 * only where they sit. Steps 3 and 4 open once a token exists, or once the
 * reader says they brought one from Tokens, which keeps the presence watch
 * for that reader reachable.
 */

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const AGENT_KEY = 'laika.connect.agent';

function storedAgent(): string | null {
  try {
    return window.localStorage.getItem(AGENT_KEY);
  } catch {
    return null;
  }
}

function storeAgent(id: AgentChoice): void {
  try {
    window.localStorage.setItem(AGENT_KEY, id);
  } catch {
    // Private mode or blocked storage: the URL still carries the choice.
  }
}

export interface ConnectScreenProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
  /** The route's query, for `?agent=`. Optional so the screen renders bare. */
  readonly params?: URLSearchParams | undefined;
  readonly setParams?:
    ((next: URLSearchParams, options?: { readonly push?: boolean }) => void) | undefined;
}

/** Enough of the minted token to watch it — the id and when it was made, never the secret. */
interface MintedRef {
  readonly id: string;
  readonly created_at: number;
  /** The name it was minted under — what the rail and the status row show. */
  readonly name: string;
}

export function ConnectScreen({ me, origin, params, setParams }: ConnectScreenProps) {
  const projects = useProjects();

  const [agentId, setAgentId] = useState<AgentChoice>(
    () => guideFor(params?.get('agent') ?? storedAgent()).id,
  );
  const guide = guideFor(agentId);

  const [name, setName] = useState(() => suggestTokenName(navigator.userAgent, guide.tokenWord));
  /** Once the reader types a name, choosing another agent stops rewriting it. */
  const nameTouched = useRef(false);
  const [revealed, setRevealed] = useState<CreatedToken | undefined>(undefined);
  const [minted, setMinted] = useState<MintedRef | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [mintError, setMintError] = useState<string | undefined>(undefined);
  const [slug, setSlug] = useState<string | undefined>(undefined);
  const [live, setLive] = useState<LiveState>({ kind: 'idle' });
  /*
   * **Remembered, not derived.** `forget()` blanks the secret and then drops
   * the whole record a tick later, so a note conditioned on "revealed but
   * blank" exists for one render and vanishes — it passed here by luck and
   * timed out under load. The reader needs to know where the token went for
   * longer than two frames.
   */
  const [forgotten, setForgotten] = useState(false);
  const ticks = useRef(0);
  const blockRef = useRef<HTMLPreElement | null>(null);

  /* The wizard's own state (LAI-740). None of it holds the secret. */
  const [step, setStep] = useState<WizardStep>(1);
  const [brought, setBrought] = useState(false);
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState('');
  const [setupMode, setSetupMode] = useState<SetupMode>('auto');
  const moved = useRef(false);
  const titleRef = useRef<HTMLHeadingElement | null>(null);

  /*
   * Remembered whichever way it was chosen — a click, the keyboard, or a link
   * that arrived with `?agent=`. Writing only on a click forgot the agent a
   * lead's link had set, which the browser test caught.
   */
  useEffect(() => {
    storeAgent(agentId);
  }, [agentId]);

  /*
   * An `?agent=` naming nothing known is dropped from the URL (review round
   * 1): the page shows Claude Code, and a link copied from the address bar
   * should say so rather than carry a value the page ignored.
   */
  useEffect(() => {
    const asked = params?.get('agent');
    if (asked === null || asked === undefined || setParams === undefined || params === undefined) {
      return;
    }
    if (guideFor(asked).id !== asked) {
      const next = new URLSearchParams(params);
      next.delete('agent');
      setParams(next);
    }
  }, [params, setParams]);

  const choose = (id: AgentChoice): void => {
    setAgentId(id);
    if (!nameTouched.current) {
      setName(suggestTokenName(navigator.userAgent, guideFor(id).tokenWord));
    }
    if (params !== undefined && setParams !== undefined) {
      const next = new URLSearchParams(params);
      next.set('agent', id);
      setParams(next);
    }
  };

  /**
   * Two phases, copied from `TokensScreen.forget()` and for the same measured
   * reason: setting `revealed` straight to `undefined` left `{token, secret}`
   * reachable in React's previous hook state. Blank it, let that render
   * commit, then drop it.
   */
  const forget = (): void => {
    setRevealed((current) =>
      current === undefined ? undefined : { token: current.token, secret: '' },
    );
    setTimeout(() => {
      setRevealed(undefined);
    }, 0);
    setForgotten(true);
  };

  const secret = revealed?.secret === '' ? undefined : revealed?.secret;
  const chosen = pickProject(projects.projects, slug);
  const project: ProjectRef | undefined =
    chosen === undefined
      ? undefined
      : { slug: chosen.slug, prefix: chosen.prefix, name: chosen.name };

  const blocks = setupBlocks(guide.id, { origin, secret, project });
  const target = instructionsTarget(guide.id);
  const block = project === undefined ? undefined : target.wrap(projectBlock(origin, project));
  const start = startGuide(guide.id);

  const mint = (): void => {
    if (me === undefined) return;
    setPending(true);
    setMintError(undefined);
    createToken({
      name:
        name.trim() === '' ? suggestTokenName(navigator.userAgent, guide.tokenWord) : name.trim(),
      scope: forcedTokenScope(me.org_role, 'full'),
      // A credential that is about to be pasted into a transcript or a config
      // should have an end date. Nothing else in the UI sets one; the field
      // has always existed.
      expires_at: Date.now() + NINETY_DAYS_MS,
    })
      .then((created) => {
        setRevealed(created);
        setMinted({
          id: created.token.id,
          created_at: created.token.created_at,
          name: created.token.name,
        });
        setForgotten(false);
        // Minting is the moment the reader is about to go and do it, so the
        // watch arms itself rather than waiting to be asked.
        ticks.current = 0;
        setLive({ kind: 'watching', ticks: 0 });
      })
      .catch((cause: unknown) => {
        setMintError(cause instanceof Error ? cause.message : 'Could not create that token.');
      })
      .finally(() => {
        setPending(false);
      });
  };

  const via = guide.via;

  /**
   * The watch. Bounded, and it stops on every terminal answer rather than
   * polling a server forever because somebody left a tab open.
   *
   * **By token when this page minted one** — the token's own `last_mcp_at`,
   * which only that token can move — and by presence otherwise, which any
   * agent session of the reader's satisfies.
   */
  useEffect(() => {
    if (live.kind !== 'watching' || me === undefined) return;

    const controller = new AbortController();

    /*
     * Whether the org records presence, asked once per watch. With it off the
     * server does not stamp `last_mcp_at`, so the token watch needs to know
     * to accept `last_used_at` instead (`tokenLiveStateFrom`). If the org
     * cannot be read, the strict reading stands: presence on.
     */
    const presenceOn: Promise<boolean> =
      minted === undefined
        ? Promise.resolve(true)
        : getOrg(controller.signal).then(
            (org) => org.presence_enabled,
            () => true,
          );

    const ask = (): void => {
      const answer: Promise<LiveState> =
        minted === undefined
          ? getPresence(controller.signal).then((presence) => {
              ticks.current += 1;
              return liveStateFrom(presence, me.id, ticks.current);
            })
          : // Every page, not the first: the list is newest-first so the token
            // is almost always on page one, but "almost" is a sample, and a
            // miss here would read as "not connected" with nothing to say why.
            Promise.all([
              everyPage((cursor) => listTokens(controller.signal, { cursor })),
              presenceOn,
            ]).then(([tokens, on]) => {
              ticks.current += 1;
              return tokenLiveStateFrom(tokens.items, minted.id, via, ticks.current, on);
            });

      answer
        .then((state) => {
          setLive(state);
        })
        .catch((cause: unknown) => {
          if (cause instanceof DOMException && cause.name === 'AbortError') return;
          setLive({ kind: 'error', error: cause });
        });
    };

    const timer = setInterval(ask, LIVE_POLL_MS);
    ask();

    return () => {
      clearInterval(timer);
      controller.abort();
    };
    /*
     * The tick count lives in a ref rather than state on purpose: as state it
     * would be a dependency, and every tick would tear the interval down and
     * build a new one — a watch that restarts itself is not a watch.
     */
  }, [live.kind, me, minted, via]);

  const viewerOnly = me !== undefined && !mayChooseScope(me.org_role);

  /*
   * What the page already knows, and nothing else (LAI-733). A token minted
   * here — still shown, or hidden since — is a token; so is one the reader
   * says they brought (LAI-740), which is what opens steps 3 and 4 to them.
   * Step 3 counts as done once something there was copied; step 4 once the
   * live check found the connection.
   */
  const mintedHere = revealed !== undefined || forgotten;
  const ready = mintedHere || brought;
  const connected = live.kind === 'found' || live.kind === 'connected';

  const modes = setupModes(blocks);
  const mode: SetupMode = modes.includes(setupMode) ? setupMode : (modes[0] ?? 'auto');
  const shown = blocks.filter((b) => b.group === (mode === 'auto' ? 'recommended' : 'manual'));
  const alternative = blocks.filter((b) => b.group === 'alternative');
  const carriesToken = blocks.some((b) => b.token !== 'none');

  const go = (next: number): void => {
    if (next < 1 || next > 4) return;
    const target = next as WizardStep;
    if (!stepOpen(target, ready)) return;
    moved.current = true;
    setStep(target);
  };

  /*
   * A step change moves focus to the new card's title, so a keyboard or
   * screen-reader user lands on what just appeared rather than on a button
   * that may now be disabled. Not on first render: arriving on the page is
   * not a step change.
   */
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    titleRef.current?.focus();
  }, [step]);

  /** *Connect another agent*: back to step 1, with a fresh token to mint. */
  const again = (): void => {
    if (revealed !== undefined) forget();
    setMinted(undefined);
    setForgotten(false);
    setBrought(false);
    setCopied(false);
    ticks.current = 0;
    setLive({ kind: 'idle' });
    moved.current = true;
    setStep(1);
  };

  const done: Readonly<Record<WizardStep, boolean>> = {
    1: step > 1,
    2: ready,
    3: copied,
    4: connected,
  };

  const rail = {
    agentName: guide.name,
    tokenName: minted?.name,
    brought,
    copied,
    connected,
    watching: live.kind === 'watching',
  };

  const stepName = (n: WizardStep): string =>
    n === 1
      ? 'Choose your agent'
      : n === 2
        ? 'Mint a token'
        : n === 3
          ? `Add Laika to ${guide.name}`
          : 'Check it connected';

  const stepLine: Readonly<Record<WizardStep, string>> = {
    1: 'Pick the coding agent on this machine — everything after this is filled in for it.',
    2: 'A token is how a tool acts as you. Treat it like a password.',
    3: 'Filled in for this board. Put it where the bar above it says, then continue.',
    4: `Start ${guide.name}, and this page watches for it to reach the board.`,
  };

  return (
    <div className="connect">
      <ScreenHeader title="Connect" context="Link your coding agent to this board">
        <span className="conn-url">
          <span className="conn-url-label">Board</span>
          <code className="conn-url-value">{origin}</code>
          <CopyButton text={origin} what="the board URL" />
        </span>
      </ScreenHeader>

      <div className="conn-page">
        <div className="conn-wizard">
          {/* ------------------------------------------------------ the rail */}
          <nav className="conn-rail" aria-label="Setup steps">
            <p className="conn-rail-intro">
              Four steps, about five minutes. At the end, an agent on your machine reads this board,
              claims tasks, and appears on Capacity while it works.
            </p>
            <ol className="conn-steps">
              {WIZARD_STEPS.map((n) => {
                const open = stepOpen(n, ready);
                const state = n === step ? 'current' : done[n] ? 'done' : 'todo';
                return (
                  <li key={n} className="conn-step" data-state={state} data-locked={!open}>
                    <button
                      type="button"
                      className="conn-rail-step"
                      disabled={!open}
                      {...(n === step ? { 'aria-current': 'step' as const } : {})}
                      {...(!open ? { title: 'Mint a token first' } : {})}
                      onClick={() => {
                        go(n);
                      }}
                    >
                      <span className="conn-step-n" aria-hidden="true">
                        {done[n] ? '✓' : n}
                      </span>
                      <span className="conn-rail-text">
                        <span className="conn-rail-name">
                          <span className="visually-hidden">Step {n}: </span>
                          {stepName(n)}
                        </span>
                        <span className="conn-rail-sub">{railLabel(n, rail)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>

          {/* ------------------------------------------------------ the card */}
          <section
            className="conn-card conn-wizard-card"
            aria-labelledby="conn-step-title"
            data-step={step}
          >
            <header className="conn-card-head">
              <p className="conn-eyebrow">Step {step} of 4</p>
              <h2 className="conn-card-title" id="conn-step-title" tabIndex={-1} ref={titleRef}>
                {stepName(step)}
              </h2>
              <p className="conn-card-line">{stepLine[step]}</p>
            </header>

            <div className="conn-card-body">
              {step === 1 && (
                <AgentPicker value={guide.id} onChange={choose} query={query} onQuery={setQuery} />
              )}

              {step === 2 && (
                <>
                  {viewerOnly && (
                    <p className="conn-note conn-note-warn">
                      Your organisation role reads the board and writes nothing, so this token will
                      too. An agent holding it can see tasks but cannot claim or finish them.
                    </p>
                  )}

                  <div className="conn-mint">
                    <label className="conn-label" htmlFor="conn-token-name">
                      Token name
                    </label>
                    <div className="conn-mint-row">
                      <input
                        id="conn-token-name"
                        className="conn-input"
                        value={name}
                        onChange={(event) => {
                          nameTouched.current = true;
                          setName(event.target.value);
                        }}
                      />
                      <button
                        type="button"
                        className="bar-control bar-control-primary conn-mint-button"
                        disabled={pending || me === undefined}
                        aria-busy={pending}
                        onClick={mint}
                      >
                        {pending && <Spinner size="sm" />}
                        Mint a token
                      </button>
                    </div>
                    <p className="conn-note">
                      It carries your permissions, so give it a name you will recognise on the
                      Tokens screen a year from now. The name starts with your agent, which is how
                      the board recognises an agent that does not introduce itself.
                    </p>
                  </div>

                  {mintError !== undefined && (
                    <p className="conn-error" role="alert">
                      {mintError}
                    </p>
                  )}

                  {secret !== undefined && (
                    <div className="conn-secret" role="alert">
                      <h3 className="conn-secret-title">
                        <CheckIcon />
                        Token minted
                      </h3>
                      <div className="conn-secret-row">
                        <code className="conn-secret-value">{secret}</code>
                        <div className="conn-secret-actions">
                          <CopyButton
                            text={secret}
                            what="the token"
                            className="conn-copy-primary"
                          />
                          <button
                            type="button"
                            className="conn-hide"
                            onClick={() => {
                              forget();
                            }}
                          >
                            Hide the token
                          </button>
                        </div>
                      </div>
                      <p className="conn-note">
                        <strong>Copy it now — it is not shown again.</strong> Laika keeps a hash,
                        not the secret, so nobody — including an administrator — can show it to you
                        again. It expires in 90 days. If you lose it, revoke it on Tokens and mint
                        another.
                      </p>
                      <p className="conn-note">
                        The blocks in step 3 marked <em>carries your token</em> now include it —
                        paste them only into your own terminal, shell profile or agent. Every config
                        that can read it from <code>LAIKA_TOKEN</code> does, and carries no token at
                        all. Revoking it on Tokens stops it working immediately.
                      </p>
                    </div>
                  )}

                  {forgotten && secret === undefined && (
                    <p className="conn-note conn-forgotten">
                      The token is gone from this page. Mint another, or revoke the old one on
                      Tokens.
                    </p>
                  )}

                  {!ready && (
                    <p className="conn-note conn-brought">
                      Brought a token from Tokens?{' '}
                      <button
                        type="button"
                        className="conn-link-button"
                        onClick={() => {
                          setBrought(true);
                        }}
                      >
                        Use a token I already have
                      </button>
                    </p>
                  )}
                </>
              )}

              {step === 3 && (
                <div
                  className="conn-setup-step"
                  onClickCapture={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest('.copy-button') !== null) setCopied(true);
                  }}
                >
                  {guide.beta !== undefined && (
                    <p className="conn-note conn-note-warn conn-beta">{guide.beta}</p>
                  )}

                  <div className="conn-setup-bar">
                    {modes.length > 1 ? (
                      <div className="conn-segmented" role="group" aria-label="How to add it">
                        {modes.map((m) => (
                          <button
                            key={m}
                            type="button"
                            className="conn-segment"
                            aria-pressed={m === mode}
                            onClick={() => {
                              setSetupMode(m);
                            }}
                          >
                            {m === 'auto' ? 'Automatic' : 'By hand'}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <span className="conn-setup-mode">
                        {mode === 'auto' ? 'Automatic' : 'By hand'}
                      </span>
                    )}
                    <ul className="conn-chips" aria-label="What this needs">
                      {requirementChips(shown, guide.via).map((chip) => (
                        <li key={chip} className="conn-chip">
                          {chip}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {shown.map((b) => (
                    <SetupBlockView key={b.key} block={b} secret={secret} main />
                  ))}

                  {alternative.length > 0 && (
                    <details className="conn-alt">
                      <summary>Other ways</summary>
                      {alternative.map((b) => (
                        <SetupBlockView key={b.key} block={b} secret={secret} />
                      ))}
                    </details>
                  )}

                  {carriesToken && secret === undefined && (
                    <p className="conn-note conn-info">
                      Blocks that carry your token show a placeholder until you mint one in step 2.
                    </p>
                  )}
                </div>
              )}

              {step === 4 && (
                <>
                  <div className="conn-start">
                    <h3 className="conn-sub-title">Start {guide.name}</h3>
                    <p className="conn-body">{start.body}</p>
                    {start.command !== undefined && (
                      <div className="conn-block">
                        <div className="conn-block-bar">
                          <span className="conn-block-label">Terminal</span>
                          <CopyButton
                            text={start.command}
                            what={start.commandWhat ?? 'the command'}
                            className="conn-copy-primary"
                          />
                        </div>
                        <pre className="conn-pre">{start.command}</pre>
                      </div>
                    )}
                  </div>

                  <StatusRow live={live} tokenName={minted?.name} />

                  <LiveCheck
                    live={live}
                    guide={guide}
                    byToken={minted !== undefined}
                    onWatch={() => {
                      ticks.current = 0;
                      setLive({ kind: 'watching', ticks: 0 });
                    }}
                  />

                  {!connected && live.kind !== 'spent' && (
                    <details className="conn-alt conn-help">
                      <summary>Nothing after a minute?</summary>
                      <ul className="conn-causes">
                        {likelyCauses(guide.id).map((cause) => (
                          <li key={cause}>{cause}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  {connected && (
                    <div className="conn-done-actions">
                      <a className="conn-primary-link" href="/board">
                        Open the board
                      </a>
                      <button type="button" className="conn-outline" onClick={again}>
                        Connect another agent
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <footer className="conn-card-foot">
              <button
                type="button"
                className="conn-outline conn-back"
                disabled={step === 1}
                onClick={() => {
                  go(step - 1);
                }}
              >
                Back
              </button>
              <p className="conn-foot-hint">
                {footerHint(step, {
                  ready,
                  mintedHere,
                  copied,
                  connected,
                  agentName: guide.name,
                })}
              </p>
              {step < 4 && (
                <button
                  type="button"
                  className="conn-continue"
                  disabled={!canContinue(step, ready)}
                  onClick={() => {
                    go(step + 1);
                  }}
                >
                  Continue <span aria-hidden="true">→</span>
                </button>
              )}
            </footer>
          </section>
        </div>

        {/* ----------------------------------------------- the lead's block */}
        <section className="conn-card conn-extra">
          <h2 className="conn-step-title">For the project lead</h2>
          {target.committable ? (
            <p className="conn-body">
              Commit this to <code>{target.path}</code> in the project, and every {guide.name}{' '}
              session that opens the repo works the board without being told how. It carries no
              token. The same rules reach every agent from the board itself when it connects; this
              adds the project they belong to.
            </p>
          ) : (
            <p className="conn-body">
              {guide.name} has no instructions file. Paste this into the Project instructions of the
              project you work in, and every chat there works the board without being told how. It
              carries no token.
            </p>
          )}
          {target.note !== undefined && <p className="conn-note">{target.note}</p>}

          {projects.status === 'loading' ? (
            <LoadingState shape="row" count={1} label="Loading your projects" />
          ) : projects.status === 'error' ? (
            <ApiErrorState error={projects.error} resource="your projects" scope="organisation" />
          ) : block === undefined || project === undefined ? (
            <EmptyState
              headline="No project to mirror work into"
              body="Setup still works without one — a session can connect and report in. Create a project and this block fills in with its slug."
            />
          ) : (
            <>
              <div className="conn-field">
                <label className="conn-label" htmlFor="conn-project">
                  Project
                </label>
                {/* The product's own picker, not a native <select> (LAI-726). */}
                <Dropdown
                  id="conn-project"
                  variant="bare"
                  className="conn-select"
                  noun="projects"
                  value={project.slug}
                  options={projects.projects
                    .filter((row): row is typeof row & { slug: string } => 'slug' in row)
                    .map((row) => ({ value: row.slug, label: row.name }))}
                  onChange={(next) => {
                    setSlug(next);
                  }}
                />
              </div>

              <div className="conn-block">
                <div className="conn-block-bar">
                  <span className="conn-block-label" id="conn-project-block-label">
                    {target.path} — carries no token
                  </span>
                  <CopyButton text={block} selects={blockRef} what={`the ${target.path} block`} />
                </div>
                <pre
                  className="conn-pre conn-project-block"
                  ref={blockRef}
                  tabIndex={0}
                  aria-labelledby="conn-project-block-label"
                >
                  {block}
                </pre>
              </div>
            </>
          )}
        </section>

        {/* ------------------------------------------------------ reference */}
        <section className="conn-card conn-extra conn-reference">
          <h2 className="conn-step-title">What an agent can do here</h2>
          <p className="conn-body">
            Eighteen tools, served by this board at <code>{origin}/mcp</code> over Streamable HTTP
            with a bearer token, under the same permissions you have in the browser.
          </p>
          <dl className="conn-tools">
            <div className="conn-tool-row">
              <dt>Find work</dt>
              <dd>
                <code>laika_whoami</code> <code>list_projects</code>{' '}
                <code>get_project_context</code> <code>list_ready_tasks</code>{' '}
                <code>get_task_context</code> <code>list_sprints</code> <code>list_members</code>
              </dd>
            </div>
            <div className="conn-tool-row">
              <dt>Do work</dt>
              <dd>
                <code>create_task</code> <code>start_working</code> <code>update_status</code>{' '}
                <code>update_task</code> <code>set_task_sprint</code> <code>add_comment</code>{' '}
                <code>finish_task</code>
              </dd>
            </div>
            <div className="conn-tool-row">
              <dt>Run the board</dt>
              <dd>
                <code>create_sprint</code> <code>update_sprint</code>{' '}
                <code>update_project_context</code> <code>log_unlisted_work</code>
              </dd>
            </div>
          </dl>
          <p className="conn-note">
            Three rules the board enforces rather than suggests: claiming a task is first-come, so a
            refusal means somebody already has it; <code>finish_task</code> moves work to{' '}
            <strong>review</strong>, never to done, because a human closes it; and a read-only token
            reads every one of these tools and writes none.
          </p>
        </section>

        {me !== undefined && canManageOrg(me.org_role) && (
          <section className="conn-card conn-extra">
            <h2 className="conn-step-title">Invite a teammate</h2>
            <p className="conn-body">
              You can add people. <a href="/organisation">Organisation</a> issues an invite link;
              they accept it, mint their own token on this page, and appear on Capacity beside you.
              Tokens are personal — the board attributes every action and every live session to
              whoever owns the token, so a shared one makes the board lie about who did what.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * The agent picker: one radio group, drawn as tiles under headings (LAI-737,
 * grouped and searchable since LAI-740).
 *
 * **Native radios**, visually hidden inside their labels, so arrow keys,
 * `Tab` into the group and a screen reader's "radio button, 3 of 21" all come
 * from the browser rather than a re-implementation. The search removes tiles
 * rather than hiding them, so the arrows only walk what is on show.
 */
function AgentPicker({
  value,
  onChange,
  query,
  onQuery,
}: {
  readonly value: AgentChoice;
  readonly onChange: (id: AgentChoice) => void;
  readonly query: string;
  readonly onQuery: (query: string) => void;
}) {
  const groups = groupedAgents(query);
  const any = guideFor('any');
  const rest = guideFor('rest');

  return (
    <div className="conn-picker-wrap">
      <div className="conn-search">
        <SearchIcon />
        <input
          type="search"
          className="conn-search-input"
          aria-label="Search agents"
          placeholder={`Search ${String(AGENT_GUIDES.length)} agents`}
          value={query}
          onChange={(event) => {
            onQuery(event.target.value);
          }}
        />
      </div>

      {/* `radiogroup` on the fieldset, named by its legend: a screen reader then
          says "Your coding agent, radio group" and counts the tiles. */}
      <fieldset className="conn-picker" role="radiogroup" aria-labelledby="conn-picker-legend">
        <legend className="visually-hidden" id="conn-picker-legend">
          Your coding agent
        </legend>
        {groups.map((group) => (
          <div key={group.id} className="conn-group">
            <h3 className="conn-group-title">
              {group.title}
              <span className="conn-group-count">{group.guides.length}</span>
            </h3>
            <div className="conn-agents">
              {group.guides.map((g) => (
                <AgentTile key={g.id} guide={g} checked={g.id === value} onChange={onChange} />
              ))}
            </div>
          </div>
        ))}
      </fieldset>

      {groups.length === 0 && (
        <div className="conn-agents-empty" role="status">
          <p className="conn-body">
            No agent matches “{query.trim()}”. If yours is not here, it can still connect: choose{' '}
            <button
              type="button"
              className="conn-link-button"
              onClick={() => {
                onChange(any.id);
                onQuery('');
              }}
            >
              {any.name}
            </button>{' '}
            if it speaks MCP, or{' '}
            <button
              type="button"
              className="conn-link-button"
              onClick={() => {
                onChange(rest.id);
                onQuery('');
              }}
            >
              {rest.name}
            </button>{' '}
            if it does not.
          </p>
        </div>
      )}
    </div>
  );
}

function AgentTile({
  guide,
  checked,
  onChange,
}: {
  readonly guide: AgentGuide;
  readonly checked: boolean;
  readonly onChange: (id: AgentChoice) => void;
}) {
  return (
    <label className="conn-agent" data-checked={checked}>
      <input
        type="radio"
        name="conn-agent"
        className="conn-agent-input"
        value={guide.id}
        checked={checked}
        onChange={() => {
          onChange(guide.id);
        }}
      />
      <AgentMark client={guide.client} size="xl" />
      <span className="conn-agent-name">{guide.name}</span>
      {guide.beta !== undefined && <span className="conn-agent-beta">beta</span>}
      {checked && (
        <span className="conn-agent-check" aria-hidden="true">
          <CheckIcon />
        </span>
      )}
    </label>
  );
}

/**
 * One copyable block, with its file, its warning and its note. The line that
 * holds the real token is highlighted; the text itself is untouched, so what
 * the reader sees, selects and copies are the same characters.
 */
function SetupBlockView({
  block,
  secret,
  main = false,
}: {
  readonly block: SetupBlock;
  readonly secret: string | undefined;
  readonly main?: boolean;
}) {
  const ref = useRef<HTMLPreElement | null>(null);
  const labelId = `conn-block-${block.key}-label`;
  const holdsToken = block.token !== 'none';
  return (
    <div className="conn-setup" data-token={block.token}>
      <div className={main ? 'conn-block conn-block-main' : 'conn-block'}>
        <div className="conn-block-bar">
          <span className="conn-block-label" id={labelId}>
            <PathLabel text={block.label} />
          </span>
          {holdsToken && <span className="conn-block-tag">carries your token</span>}
          <CopyButton
            text={block.text}
            selects={ref}
            what={block.what}
            className="conn-copy-primary"
            disabled={holdsToken && secret === undefined}
            disabledReason="Mint a token first — this carries it"
          />
        </div>
        <pre
          className={`conn-pre conn-block-${block.key}${block.key === 'claude-prompt' ? ' conn-prompt' : ''}`}
          ref={ref}
          tabIndex={0}
          aria-labelledby={labelId}
        >
          {commandRuns(block.text, secret).map((run, i) =>
            run.token ? (
              <mark key={i} className="conn-token-line">
                {run.text}
              </mark>
            ) : (
              run.text
            ),
          )}
        </pre>
      </div>
      {block.warn !== undefined && <p className="conn-note conn-note-warn">{block.warn}</p>}
      {block.note !== undefined && <p className="conn-note conn-info">{block.note}</p>}
    </div>
  );
}

/**
 * A block's label with its file paths set as code: as typed, never
 * upper-cased, and the only part allowed to break anywhere — a long path
 * wraps mid-name; the words around it do not.
 */
function PathLabel({ text }: { readonly text: string }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((part, i) =>
        /^[~.]?[\w.-]*\/[\w./<>-]*|^\.[\w-]+\/?/.test(part) ? (
          <code key={i} className="conn-path">
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

/**
 * The one-line answer above the live check: a dot, which token, and where the
 * watch has got to. Colour is never the only signal — the words say it too.
 */
function StatusRow({
  live,
  tokenName,
}: {
  readonly live: LiveState;
  readonly tokenName: string | undefined;
}) {
  const ok = live.kind === 'found' || live.kind === 'connected';
  const dot = ok ? 'ok' : live.kind === 'watching' ? 'waiting' : 'idle';
  const words = ok
    ? 'Connected'
    : live.kind === 'watching'
      ? 'Waiting for check-in'
      : live.kind === 'spent'
        ? 'Not seen yet'
        : live.kind === 'disabled'
          ? 'Presence is off'
          : live.kind === 'error'
            ? 'Could not check'
            : 'Not run yet';
  return (
    <div className="conn-status" data-dot={dot}>
      <span className="conn-dot" aria-hidden="true" />
      <span className="conn-status-name">{tokenName ?? 'Any agent session of yours'}</span>
      <span className="conn-status-words">{words}</span>
      {ok && <span className="conn-live-pill">Live</span>}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="conn-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path
        d="M3.5 8.5l3 3 6-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      className="conn-icon conn-search-icon"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function LiveCheck({
  live,
  guide,
  byToken,
  onWatch,
}: {
  readonly live: LiveState;
  readonly guide: AgentGuide;
  readonly byToken: boolean;
  readonly onWatch: () => void;
}) {
  const minutes = String((LIVE_TICKS * (LIVE_POLL_MS / 1000)) / 60);

  if (live.kind === 'idle') {
    return (
      <div className="conn-live conn-live-idle">
        <p className="conn-body">
          Mint a token in step 2 and this watches that exact token reach the board. Brought a token
          from elsewhere? Watch for any agent session of yours instead.
        </p>
        <button type="button" className="bar-control" onClick={onWatch}>
          Watch for my session
        </button>
      </div>
    );
  }

  if (live.kind === 'watching') {
    return (
      <div className="conn-live conn-live-watching">
        <p className="conn-body">
          <Spinner size="sm" />{' '}
          {byToken
            ? `Watching for the token you just minted to reach the board${guide.via === 'mcp' ? ' over MCP' : ''} — nothing yet.`
            : 'Watching for any agent session of yours — nothing yet.'}{' '}
          This checks every few seconds for {minutes} minutes.
        </p>
        {!byToken && (
          <p className="conn-note">
            This is the weaker check: an agent you already had running satisfies it. Mint a token in
            step 2 to check that exact one.
          </p>
        )}
      </div>
    );
  }

  if (live.kind === 'connected') {
    return (
      <div className="conn-live conn-live-ok">
        <p className="conn-body">
          <strong>{connectedLabel(live.token, guide.name)}</strong>
        </p>
        <p className="conn-note">
          {connectedNote(live.by, guide.via, live.presenceOff)}
          {live.by === 'mcp' && (
            <>
              {' '}
              <a href="/capacity">Capacity</a> shows the session beside everyone else’s while it
              works.
            </>
          )}
        </p>
      </div>
    );
  }

  if (live.kind === 'found') {
    const where = hasLocation(live.entry)
      ? `${String(live.entry.repo)} · ${String(live.entry.branch)}`
      : 'Working somewhere this board is not told about — normal, and deliberate.';
    return (
      <div className="conn-live conn-live-ok">
        <p className="conn-body">
          <strong>{live.entry.name}</strong> is connected. {where}
        </p>
        <p className="conn-note">
          That is a session holding one of your tokens, checking in — not necessarily a new one.{' '}
          <a href="/capacity">Capacity</a> shows it beside everyone else.
        </p>
      </div>
    );
  }

  if (live.kind === 'spent') {
    return (
      <div className="conn-live conn-live-spent">
        <p className="conn-body">
          {minutes} minutes, and {byToken ? 'the token has not reached the board' : 'no session'}.
          The usual causes for {guide.name}:
        </p>
        <ul className="conn-causes">
          {likelyCauses(guide.id).map((cause) => (
            <li key={cause}>{cause}</li>
          ))}
        </ul>
        <button type="button" className="bar-control" onClick={onWatch}>
          Check again
        </button>
      </div>
    );
  }

  if (live.kind === 'disabled') {
    return (
      <p className="conn-live conn-live-disabled conn-body">
        This organisation does not record who is working, so this check has nothing to read.
        Everything else on this page still works.
      </p>
    );
  }

  return <ApiErrorState error={live.error} resource="live sessions" scope="organisation" />;
}
