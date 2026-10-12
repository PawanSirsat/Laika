import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  LIVE_POLL_MS,
  LIVE_TICKS,
  liveStateFrom,
  tokenLiveStateFrom,
  type LiveState,
} from './connect-live.ts';
import { suggestTokenName } from './connect-token-name.ts';
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
        setMinted({ id: created.token.id, created_at: created.token.created_at });
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
   * Step state, from what this page already knows and nothing else (LAI-733).
   * A token minted here — still shown, or hidden since — finishes step 1; a
   * connection the live check found finishes step 4. Steps 2 and 3 happen on
   * the reader's machine, where the page cannot see, so they are never ticked.
   */
  const mintedHere = revealed !== undefined || forgotten;
  const connected = live.kind === 'found' || live.kind === 'connected';
  const current = connected ? undefined : mintedHere ? 2 : 1;
  const stepState = (n: number, done: boolean): StepState =>
    done ? 'done' : n === current ? 'current' : 'todo';

  const recommended = blocks.filter((b) => b.group === 'recommended');
  const manual = blocks.filter((b) => b.group === 'manual');
  const alternative = blocks.filter((b) => b.group === 'alternative');
  const carriesToken = blocks.some((b) => b.token !== 'none');

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
        <p className="conn-lede">
          Pick your agent, then four steps, about five minutes. At the end, an agent on your machine
          reads this board, claims tasks, and appears on Capacity while it works. Everything below
          is filled in for <strong>this</strong> board — you should not need another document.
        </p>

        <AgentPicker value={guide.id} onChange={choose} />

        <ol className="conn-steps">
          {/* -------------------------------------------------------- step 1 */}
          <Step n={1} state={stepState(1, mintedHere)} title="Mint a token for this machine">
            <p className="conn-body">
              A token is how a tool acts as you. It carries your permissions, so treat it like a
              password — and give it a name you will recognise on the Tokens screen a year from now.
              The name starts with your agent, which is how the board recognises an agent that does
              not introduce itself.
            </p>

            {viewerOnly && (
              <p className="conn-note conn-note-warn">
                Your organisation role reads the board and writes nothing, so this token will too.
                An agent holding it can see tasks but cannot claim or finish them.
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
            </div>

            {mintError !== undefined && (
              <p className="conn-error" role="alert">
                {mintError}
              </p>
            )}

            {secret !== undefined && (
              <div className="conn-secret" role="alert">
                <h3 className="conn-secret-title">Secret — copy it now, it is not shown again</h3>
                <p className="conn-body">
                  Laika keeps a hash, not the secret, so nobody — including an administrator — can
                  show it to you again. It expires in 90 days. If you lose it, revoke it on Tokens
                  and mint another.
                </p>
                <div className="conn-secret-row">
                  <code className="conn-secret-value">{secret}</code>
                  <div className="conn-secret-actions">
                    <CopyButton text={secret} what="the token" className="conn-copy-primary" />
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
                  The blocks below marked <em>carries your token</em> now include it — paste them
                  only into your own terminal, shell profile or agent. Every config that can read it
                  from <code>LAIKA_TOKEN</code> does, and carries no token at all. Revoking it on
                  Tokens stops it working immediately.
                </p>
              </div>
            )}

            {forgotten && secret === undefined && (
              <p className="conn-note conn-forgotten">
                The token is gone from this page. Mint another, or revoke the old one on Tokens.
              </p>
            )}
          </Step>

          {/* -------------------------------------------------------- step 2 */}
          <Step n={2} state={stepState(2, false)} title={`Add Laika to ${guide.name}`}>
            {guide.beta !== undefined && (
              <p className="conn-note conn-note-warn conn-beta">{guide.beta}</p>
            )}

            {recommended.map((b) => (
              <SetupBlockView key={b.key} block={b} minted={secret !== undefined} main />
            ))}

            {manual.length > 0 && (
              <details className="conn-alt" open>
                <summary>{recommended.length > 0 ? 'Or by hand' : 'By hand'}</summary>
                {manual.map((b) => (
                  <SetupBlockView key={b.key} block={b} minted={secret !== undefined} />
                ))}
              </details>
            )}

            {alternative.length > 0 && (
              <details className="conn-alt">
                <summary>Other ways</summary>
                {alternative.map((b) => (
                  <SetupBlockView key={b.key} block={b} minted={secret !== undefined} />
                ))}
              </details>
            )}

            {carriesToken && secret === undefined && (
              <p className="conn-note">
                Blocks that carry your token show a placeholder until you mint one in step 1.
              </p>
            )}
          </Step>

          {/* -------------------------------------------------------- step 3 */}
          <Step n={3} state={stepState(3, false)} title={`Start ${guide.name}`}>
            <p className="conn-body">{start.body}</p>
            {start.command !== undefined && (
              <div className="conn-block">
                <div className="conn-block-bar">
                  <span className="conn-block-label">Terminal</span>
                  <CopyButton text={start.command} what={start.commandWhat ?? 'the command'} />
                </div>
                <pre className="conn-pre">{start.command}</pre>
              </div>
            )}
          </Step>

          {/* -------------------------------------------------------- step 4 */}
          <Step n={4} state={stepState(4, connected)} title="Did it work?">
            <LiveCheck
              live={live}
              guide={guide}
              byToken={minted !== undefined}
              onWatch={() => {
                ticks.current = 0;
                setLive({ kind: 'watching', ticks: 0 });
              }}
            />
          </Step>
        </ol>

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
 * The agent picker: one radio group, drawn as tiles (LAI-737).
 *
 * **Native radios**, visually hidden inside their labels, so arrow keys,
 * `Tab` into the group and a screen reader's "radio button, 3 of 10" all come
 * from the browser rather than a re-implementation. The *More* agents are the
 * same group; while collapsed they are `hidden`, so the arrows skip them.
 */
function AgentPicker({
  value,
  onChange,
}: {
  readonly value: AgentChoice;
  readonly onChange: (id: AgentChoice) => void;
}) {
  const primary = AGENT_GUIDES.filter((g) => g.primary);
  const more = AGENT_GUIDES.filter((g) => !g.primary);
  const [open, setOpen] = useState(() => more.some((g) => g.id === value));
  /*
   * Collapsing More never hides the choice (review round 1): with it closed,
   * the chosen agent — if it lives under More — stays as the one tile shown.
   */
  const shownMore = open ? more : more.filter((g) => g.id === value);

  const tile = (g: AgentGuide) => (
    <label key={g.id} className="conn-agent" data-checked={g.id === value}>
      <input
        type="radio"
        name="conn-agent"
        className="conn-agent-input"
        value={g.id}
        checked={g.id === value}
        onChange={() => {
          onChange(g.id);
        }}
      />
      <AgentMark client={g.client} size="lg" />
      <span className="conn-agent-name">{g.name}</span>
      {g.beta !== undefined && <span className="conn-agent-beta">beta</span>}
    </label>
  );

  return (
    /* `radiogroup` on the fieldset, named by its legend: a screen reader then
       says "Your coding agent, radio group" and counts the tiles. */
    <fieldset
      className="conn-card conn-picker"
      role="radiogroup"
      aria-labelledby="conn-picker-legend"
    >
      <legend className="conn-picker-legend" id="conn-picker-legend">
        Your coding agent
      </legend>
      <div className="conn-agents">{primary.map(tile)}</div>
      <button
        type="button"
        className="conn-more"
        aria-expanded={open}
        aria-controls="conn-agents-more"
        onClick={() => {
          setOpen(!open);
        }}
      >
        {open ? 'Fewer agents' : `More agents (${String(more.length)})`}
      </button>
      <div
        className="conn-agents conn-agents-more"
        id="conn-agents-more"
        hidden={shownMore.length === 0}
      >
        {shownMore.map(tile)}
      </div>
    </fieldset>
  );
}

/** One copyable block, with its file, its warning and its note. */
function SetupBlockView({
  block,
  minted,
  main = false,
}: {
  readonly block: SetupBlock;
  readonly minted: boolean;
  readonly main?: boolean;
}) {
  const ref = useRef<HTMLPreElement | null>(null);
  const labelId = `conn-block-${block.key}-label`;
  const holdsToken = block.token !== 'none';
  return (
    <div className="conn-setup" data-token={block.token}>
      {block.note !== undefined && main && <p className="conn-body">{block.note}</p>}
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
            className={main ? 'conn-copy-primary' : undefined}
            disabled={holdsToken && !minted}
            disabledReason="Mint a token first — this carries it"
          />
        </div>
        <pre
          className={`conn-pre conn-block-${block.key}${block.key === 'claude-prompt' ? ' conn-prompt' : ''}`}
          ref={ref}
          tabIndex={0}
          aria-labelledby={labelId}
        >
          {block.text}
        </pre>
      </div>
      {block.warn !== undefined && <p className="conn-note conn-note-warn">{block.warn}</p>}
      {block.note !== undefined && !main && <p className="conn-note">{block.note}</p>}
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

type StepState = 'done' | 'current' | 'todo';

const STEP_STATE_WORDS: Readonly<Record<StepState, string | undefined>> = {
  done: 'Done',
  current: 'Up next',
  todo: undefined,
};

/**
 * One rung of the stepper. The marker and the connector line are decoration;
 * the state is said in words beside the title, so it reads without colour and
 * to a screen reader, and the current step carries `aria-current="step"`.
 */
function Step({
  n,
  state,
  title,
  children,
}: {
  readonly n: number;
  readonly state: StepState;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const words = STEP_STATE_WORDS[state];
  return (
    <li
      className="conn-step"
      data-state={state}
      {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
    >
      <span className="conn-step-n" aria-hidden="true">
        {state === 'done' ? '✓' : n}
      </span>
      <section className="conn-card" aria-labelledby={`conn-step-${String(n)}`}>
        <h2 className="conn-step-title" id={`conn-step-${String(n)}`}>
          <span className="visually-hidden">Step {n}: </span>
          {title}
          {words !== undefined && <span className="conn-step-state">{words}</span>}
        </h2>
        {children}
      </section>
    </li>
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
          Mint a token in step 1 and this watches that exact token reach the board. Brought a token
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
            This is the weaker check: an agent you already had running satisfies it. Mint a token
            above to check that exact one.
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
        {live.by === 'mcp' ? (
          <p className="conn-note">
            That is the token you minted here, calling this board over MCP.{' '}
            <a href="/capacity">Capacity</a> shows the session beside everyone else’s while it
            works.
          </p>
        ) : (
          <p className="conn-note">
            {live.by === 'client'
              ? 'Proved by the client the token introduced itself as, a weaker signal than the board’s MCP stamp'
              : 'Proved by the token being used at all — the weaker signal, accepted because this organisation has presence off'}
            . With presence off the board does not record MCP calls, so Capacity will not show the
            session.
          </p>
        )}
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
