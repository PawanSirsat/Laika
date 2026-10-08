import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Dropdown } from '../../../components/Dropdown.tsx';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { canManageOrg } from '../../../api/invites.ts';
import { getPresence, hasLocation } from '../../../api/presence.ts';
import { pickProject } from '../../../api/pick-project.ts';
import {
  createToken,
  forcedTokenScope,
  mayChooseScope,
  type CreatedToken,
} from '../../../api/tokens.ts';
import { useProjects } from '../../../api/use-projects.ts';
import type { MeProfile } from '../../../api/me.ts';
import { claudeMdBlock, manualCommands, setupPrompt, type ProjectRef } from './connect-copy.ts';
import { LIVE_POLL_MS, LIVE_TICKS, liveStateFrom, type LiveState } from './connect-live.ts';
import { suggestTokenName } from './connect-token-name.ts';
import './connect.css';

/**
 * Connect — the front door for a developer with nothing set up (LAI-622).
 *
 * ## Why the secret is never stored twice
 *
 * The one-time plaintext lives in exactly one hook, and every string built from
 * it — the prompt, the curl line, the heredoc — is computed **during render**
 * and stored nowhere. A `useMemo` or a second `useState` holding "the prompt
 * text" would survive the blanking pass that {@link forget} performs and defeat
 * it entirely, one level of indirection out from where `TokensScreen` measured
 * the same failure.
 */

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

export interface ConnectScreenProps {
  readonly me: MeProfile | undefined;
  readonly origin: string;
}

export function ConnectScreen({ me, origin }: ConnectScreenProps) {
  const projects = useProjects();

  const [name, setName] = useState(() => suggestTokenName(navigator.userAgent));
  const [revealed, setRevealed] = useState<CreatedToken | undefined>(undefined);
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

  const promptRef = useRef<HTMLPreElement | null>(null);
  const blockRef = useRef<HTMLPreElement | null>(null);

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

  const prompt = setupPrompt({ origin, secret, project });
  const block = project === undefined ? undefined : claudeMdBlock(origin, project);

  const mint = (): void => {
    if (me === undefined) return;
    setPending(true);
    setMintError(undefined);
    createToken({
      name: name.trim() === '' ? suggestTokenName(navigator.userAgent) : name.trim(),
      scope: forcedTokenScope(me.org_role, 'full'),
      // A credential that is about to be pasted into a transcript should have
      // an end date. Nothing else in the UI sets one; the field has always
      // existed.
      expires_at: Date.now() + NINETY_DAYS_MS,
    })
      .then((created) => {
        setRevealed(created);
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

  /**
   * The watch. Bounded, and it stops on every terminal answer rather than
   * polling a server forever because somebody left a tab open.
   */
  useEffect(() => {
    if (live.kind !== 'watching' || me === undefined) return;

    const controller = new AbortController();

    const ask = (): void => {
      getPresence(controller.signal)
        .then((presence) => {
          ticks.current += 1;
          setLive(liveStateFrom(presence, me.id, ticks.current));
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
  }, [live.kind, me]);

  const viewerOnly = me !== undefined && !mayChooseScope(me.org_role);

  /*
   * Step state, from what this page already knows and nothing else (LAI-733).
   * A token minted here — still shown, or hidden since — finishes step 1; a
   * session the live check found finishes step 4. Steps 2 and 3 happen on the
   * reader's machine, where the page cannot see, so they are never ticked.
   */
  const minted = revealed !== undefined || forgotten;
  const connected = live.kind === 'found';
  const current = connected ? undefined : minted ? 2 : 1;
  const stepState = (n: number, done: boolean): StepState =>
    done ? 'done' : n === current ? 'current' : 'todo';

  return (
    <div className="connect">
      <ScreenHeader title="Connect" context="Link Claude Code on your machine to this board">
        <span className="conn-url">
          <span className="conn-url-label">Board</span>
          <code className="conn-url-value">{origin}</code>
          <CopyButton text={origin} what="the board URL" />
        </span>
      </ScreenHeader>

      <div className="conn-page">
        <p className="conn-lede">
          Four steps, about five minutes. At the end, a Claude Code session on your machine reads
          this board, claims tasks, and appears on Capacity while it works. Everything below is
          filled in for <strong>this</strong> board — you should not need another document.
        </p>

        <ol className="conn-steps">
          {/* -------------------------------------------------------- step 1 */}
          <Step n={1} state={stepState(1, minted)} title="Mint a token for this machine">
            <p className="conn-body">
              A token is how a tool acts as you. It carries your permissions, so treat it like a
              password — and give it a name you will recognise on the Tokens screen a year from now.
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
                  Everything below now carries this token, including the prompt in step 2 — so it
                  will be in your Claude Code transcript. That is the trade for one paste. If you
                  would rather it was not, use <em>run it yourself</em> below and type the token at
                  the installer’s prompt. Either way, revoking it on Tokens stops it working
                  immediately.
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
          <Step n={2} state={stepState(2, false)} title="Hand the setup to Claude">
            <p className="conn-body">
              Open Claude Code in your project folder — plain <code>claude</code> is fine, nothing
              is installed yet — and paste this. It installs the plugin, checks the board answers,
              and writes the Laika block into this project’s <code>CLAUDE.md</code> so later
              sessions mirror their work onto the board without being asked.
            </p>

            <div className="conn-block conn-block-main">
              <div className="conn-block-bar">
                <span className="conn-block-label">Paste into Claude Code</span>
                <CopyButton
                  text={prompt}
                  selects={promptRef}
                  what="the setup prompt"
                  className="conn-copy-primary"
                  disabled={secret === undefined}
                  disabledReason="Mint a token first — the prompt carries it"
                />
              </div>
              <pre className="conn-pre conn-prompt" ref={promptRef} tabIndex={0}>
                {prompt}
              </pre>
            </div>

            <details className="conn-alt" open>
              <summary>Or run it yourself</summary>
              <p className="conn-body">
                The same thing by hand. The installer asks for the board URL and your token — the
                URL is <code>{origin}</code>, and the token is the one above.
              </p>
              <div className="conn-block">
                <div className="conn-block-bar">
                  <span className="conn-block-label">Terminal</span>
                  <CopyButton text={manualCommands()} what="the install commands" />
                </div>
                <pre className="conn-pre" tabIndex={0}>
                  {manualCommands()}
                </pre>
              </div>
            </details>
          </Step>

          {/* -------------------------------------------------------- step 3 */}
          <Step n={3} state={stepState(3, false)} title="Start a connected session">
            <p className="conn-body">
              Open a <strong>new</strong> terminal — the installer changed your PATH and the one you
              have does not know yet. Then, from any project folder:
            </p>
            <div className="conn-block">
              <div className="conn-block-bar">
                <span className="conn-block-label">Terminal</span>
                <CopyButton text="laika-claude" what="the laika-claude command" />
              </div>
              <pre className="conn-pre">laika-claude</pre>
            </div>
            <p className="conn-body">
              Use it exactly like <code>claude</code>; every flag passes through. Inside the
              session, <code>/laika:status</code> names this board and confirms a token is present.
              It never prints the token.
            </p>
          </Step>

          {/* -------------------------------------------------------- step 4 */}
          <Step n={4} state={stepState(4, connected)} title="Did it work?">
            <LiveCheck
              live={live}
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
          <p className="conn-body">
            Commit this to the project’s own <code>CLAUDE.md</code> and every session that opens the
            repo works the board without being told how. Step 2’s prompt does it for you; this is
            the copy to hand someone who set up another way.
          </p>

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
                  onChange={(slug) => {
                    setSlug(slug);
                  }}
                />
              </div>

              <div className="conn-block">
                <div className="conn-block-bar">
                  <span className="conn-block-label">CLAUDE.md — carries no token</span>
                  <CopyButton text={block} selects={blockRef} what="the CLAUDE.md block" />
                </div>
                <pre className="conn-pre conn-claude-md" ref={blockRef} tabIndex={0}>
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
            Eighteen tools, served by this board at <code>{origin}/mcp</code>, under the same
            permissions you have in the browser.
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

function LiveCheck({ live, onWatch }: { readonly live: LiveState; readonly onWatch: () => void }) {
  if (live.kind === 'idle') {
    return (
      <div className="conn-live conn-live-idle">
        <p className="conn-body">Run step 3, then watch here.</p>
        <button type="button" className="bar-control" onClick={onWatch}>
          Watch for my session
        </button>
      </div>
    );
  }

  if (live.kind === 'watching') {
    return (
      <p className="conn-live conn-live-watching conn-body">
        <Spinner size="sm" /> Watching for a session — nothing yet. This checks every few seconds
        for {String((LIVE_TICKS * (LIVE_POLL_MS / 1000)) / 60)} minutes.
      </p>
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
          That is a session holding your token, checking in. <a href="/capacity">Capacity</a> shows
          it beside everyone else.
        </p>
      </div>
    );
  }

  if (live.kind === 'spent') {
    return (
      <div className="conn-live conn-live-spent">
        <p className="conn-body">
          Three minutes, no session. The usual causes: the terminal is older than the installer
          (open a new one), or the session was started with <code>claude</code> rather than{' '}
          <code>laika-claude</code>.
        </p>
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
