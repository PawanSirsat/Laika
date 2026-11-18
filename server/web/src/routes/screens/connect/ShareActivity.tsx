import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { ApiError } from '../../../api/errors.ts';
import {
  deleteOwnLocalActivity,
  getActivitySharing,
  getOwnLocalActivity,
  LOCAL_ACTIVITY_SCOPES,
  otelEnvBlock,
  setActivitySharing,
  type ActivitySharing,
  type LocalActivityScope,
  type OwnLocalActivity,
} from '../../../api/local-activity.ts';
import { getOrgPermissions, type OrgPermissions } from '../../../api/permissions.ts';
import { dayLabel, HeldDays } from './HeldDays.tsx';

/** The collector's command (LAI-752): it checks collection is on first, then installs. */
export const ACTIVITY_COMMAND = 'laika activity on';

/**
 * What the organisation collects, in the notice (D-102 amended, LAI-964) —
 * word for word what `laika activity on` / `status` / `sync` print, which
 * `cli/test/activity-command.test.ts` holds.
 */
export const COLLECTED =
  'per-day counts of your prompts, agent sessions and commits, and your agents’ token counts';

/**
 * The compact panel's one line for its *What is sent and never sent* fold
 * (LAI-1100 #11): what the lists inside it say, in a line the reader sees
 * without opening it.
 */
export const SENT_SUMMARY =
  'Daily counts only — never prompt text, file names, paths or commit messages';

/** The grant that lets a role see a person's analytics (D-102 rule 6, LAI-958). */
const SEE_ANALYTICS = 'see_people_analytics';
const CHANGE_ORG_SETTINGS = 'change_org_settings';

/**
 * Who can see what is collected, as the notice says it (LAI-971): the owner,
 * always, and every role the owner has granted *See everyone's analytics* —
 * read from `GET /api/v1/org/permissions`, in the order its `roles` name them,
 * so a changed grant changes the sentence. Without an answer it falls back to
 * the CLI's words, which stay true whatever the owner granted.
 */
export function collectionAudience(permissions: OrgPermissions | undefined): string {
  if (permissions === undefined) return 'The owner and anyone they grant access';
  const granted = permissions.roles
    .filter((role) => permissions.grants[role]?.[SEE_ANALYTICS] === true)
    .map((role) => `${role}s`);
  const names = ['The owner', ...granted];
  const last = names.pop() ?? '';
  return names.length === 0 ? last : `${names.join(', ')} and ${last}`;
}

export function collectionManager(permissions: OrgPermissions | undefined): string {
  if (permissions === undefined) return 'the owner and anyone they grant it';
  const granted = permissions.roles
    .filter((role) => permissions.grants[role]?.[CHANGE_ORG_SETTINGS] === true)
    .map((role) => `${role}s`);
  if (granted.length === 0) return 'the owner';
  if (granted.length === 1) return `the owner and ${granted[0]}`;
  return `the owner, ${granted.slice(0, -1).join(', ')} and ${granted.at(-1) ?? ''}`;
}

/**
 * The scope choices. `setupTabName` is where the project block comes from:
 * the Projects tab in classic, Project setup in V3 (LAI-1058, plan §B.5).
 */
function scopes(
  setupTabName: string,
): Readonly<Record<LocalActivityScope, { label: string; hint: string }>> {
  return {
    'agent-repos': {
      label: 'Every repo where I use an agent',
      hint: 'Any repository on this machine where you run a connected agent. Nothing scans your disk.',
    },
    'laika-repos': {
      label: 'Only repos set up for Laika',
      hint: `Only repositories carrying the project block from Developer access’s ${setupTabName}.`,
    },
  };
}

type State =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly sharing: ActivitySharing;
      readonly held: OwnLocalActivity;
      /** `undefined` when the grants could not be read: the notice then says it in general. */
      readonly permissions: OrgPermissions | undefined;
    };

function said(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

/**
 * How a read ended: a fresh answer shown, a failure, or replaced by a newer
 * read (or a change) before it landed — which is neither.
 */
export type LoadResult = 'fresh' | 'failed' | 'superseded';

/** What {@link useShareActivity} gives a panel: the reads, and the two things the person may change. */
export interface ShareActivityModel {
  readonly state: State;
  /** A scope change or a delete is in flight. */
  readonly busy: boolean;
  /** Why the last change failed, when it did. */
  readonly error: string | undefined;
  /** The history was just deleted, so *nothing held* says so. */
  readonly deleted: boolean;
  readonly change: (next: { scope: LocalActivityScope }) => void;
  /** Asks first, then deletes the person's local-activity history. */
  readonly erase: () => void;
  /** Reads all three again — after the organisation's switch moved, say. */
  readonly reload: () => Promise<LoadResult>;
  /**
   * Reads the setting and what is held again, the grants kept — the Activity
   * tab's poll while it waits for a first report (LAI-1327 review 1).
   */
  readonly poll: () => Promise<LoadResult>;
  /**
   * Why the last re-read failed **after** an answer was shown, or `undefined`:
   * what is shown stays (LAI-1197), and the panel says it may be stale.
   */
  readonly stale: { readonly cause: unknown } | undefined;
  /** When the answer shown was read. */
  readonly loadedAt: number | undefined;
}

/**
 * *Share local activity*'s reads and changes (D-079, LAI-751), shared by the
 * classic panel and V3's Activity tab (LAI-1327): `GET /me/activity-sharing`,
 * `GET /me/local-activity` and the grants the notice is worded from, read
 * together; the scope, and the delete behind its confirmation.
 */
export function useShareActivity(): ShareActivityModel {
  const confirm = useConfirm();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [deleted, setDeleted] = useState(false);
  const [stale, setStale] = useState<{ readonly cause: unknown } | undefined>(undefined);
  const [loadedAt, setLoadedAt] = useState<number | undefined>(undefined);
  /** The read in flight: a newer one replaces it, so an older answer never lands last. */
  const inFlight = useRef<AbortController | null>(null);
  /** The grants last read, kept by a poll; `null` until the first answer. */
  const shownPermissions = useRef<OrgPermissions | undefined | null>(null);

  const load = useCallback((withPermissions: boolean): Promise<LoadResult> => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const { signal } = controller;
    const kept = shownPermissions.current;
    return Promise.all([
      getActivitySharing(signal),
      getOwnLocalActivity(signal),
      !withPermissions && kept !== null
        ? Promise.resolve(kept)
        : // Only the audience's wording rides on it, so a refusal never hides the panel.
          getOrgPermissions(signal).catch((cause: unknown) => {
            if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
            return undefined;
          }),
    ])
      .then(([sharing, held, permissions]): LoadResult => {
        if (signal.aborted) return 'superseded';
        shownPermissions.current = permissions;
        setState({ kind: 'ready', sharing, held, permissions });
        setStale(undefined);
        setLoadedAt(Date.now());
        return 'fresh';
      })
      .catch((cause: unknown): LoadResult => {
        if (signal.aborted) return 'superseded';
        // Once something is shown, a failed re-read keeps it and says so.
        if (shownPermissions.current !== null) {
          setStale({ cause });
          return 'failed';
        }
        setState({
          kind: 'error',
          message: said(cause, 'Your sharing setting could not be read.'),
        });
        return 'failed';
      });
  }, []);

  useEffect(() => {
    void load(true);
    return () => {
      inFlight.current?.abort();
    };
  }, [load]);

  /**
   * A read sent before a change answered would land after it and show the old
   * state again for a moment (LAI-1327 follow-up), so a change drops any read
   * in flight — as it starts, and again as its answer lands.
   */
  const dropReads = (): void => {
    inFlight.current?.abort();
  };

  const change = (next: { scope: LocalActivityScope }): void => {
    if (state.kind !== 'ready') return;
    const { held, permissions } = state;
    dropReads();
    setBusy(true);
    setError(undefined);
    setActivitySharing(next)
      .then((answer) => {
        dropReads();
        setState({ kind: 'ready', sharing: answer, held, permissions });
      })
      .catch((cause: unknown) => {
        setError(said(cause, 'That change did not go through.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const eraseNow = (): void => {
    if (state.kind !== 'ready') return;
    const { sharing, permissions } = state;
    dropReads();
    setBusy(true);
    setError(undefined);
    deleteOwnLocalActivity()
      .then(() => getOwnLocalActivity())
      .then((answer) => {
        dropReads();
        setDeleted(true);
        setState({ kind: 'ready', sharing, held: answer, permissions });
      })
      .catch((cause: unknown) => {
        setError(said(cause, 'The history was not deleted.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const erase = (): void => {
    void confirm({
      title: 'Delete your activity history?',
      body: 'Every daily count and commit key the board holds for you goes, and your profile’s activity loses its GitHub and Local history. This cannot be undone. Collection carries on while your organisation has Developer insights on.',
      confirmLabel: 'Delete history',
      danger: true,
    }).then((yes) => {
      if (yes) eraseNow();
    });
  };

  const reload = useCallback(() => load(true), [load]);
  const poll = useCallback(() => load(false), [load]);

  return { state, busy, error, deleted, change, erase, reload, poll, stale, loadedAt };
}

/** What the board shows it for, said once (D-079): on the profile, never a score. */
function Intro() {
  return (
    <p className="conn-body">
      Your own machine can send daily counts to your profile’s <strong>Activity</strong> — so the
      board shows the work that happens before a task moves — and your agents’ token counts to{' '}
      <strong>Usage</strong>. They show on your profile and never feed a rating or a score.
    </p>
  );
}

/** What is sent, per day, and what never is. */
function SentLists() {
  return (
    <div className="share-lists">
      <div>
        <h3 className="share-h">What is sent, per day</h3>
        <ul className="share-list" data-list="sent">
          <li>How many prompts you sent, per agent</li>
          <li>How many agent sessions you started</li>
          <li>How many of your commits are not on any remote yet</li>
          <li>A one-way key for each commit already pushed, so it counts once</li>
          <li>
            Your agents’ token counts per agent and model — input, output and cache — from their own
            session files (Claude Code, Codex, Gemini CLI), and the Laika task they were spent on,
            by its key alone: the task your agent marked, or the one your branch is named for
          </li>
        </ul>
        <p className="conn-note">
          Commits count from the day collection starts on your machine, and merge commits never
          count.
        </p>
      </div>
      <div>
        <h3 className="share-h">Never sent</h3>
        <ul className="share-list" data-list="never">
          <li>Prompt text, or anything an agent wrote</li>
          <li>File names, repository names or paths</li>
          <li>Remote URLs, branch names or session ids</li>
          <li>Commit messages, author emails or commit ids</li>
        </ul>
      </div>
    </div>
  );
}

/** *Count work in*: which repositories the collector counts (D-079), the person's own choice. */
export function ScopeChoice({
  scope,
  busy,
  setupTabName,
  onChange,
}: {
  readonly scope: LocalActivityScope;
  readonly busy: boolean;
  readonly setupTabName: string;
  readonly onChange: (next: { scope: LocalActivityScope }) => void;
}) {
  const SCOPES = scopes(setupTabName);
  return (
    <fieldset className="share-scope" disabled={busy}>
      <legend className="share-h">Count work in {busy && <Spinner size="sm" />}</legend>
      {LOCAL_ACTIVITY_SCOPES.map((choice) => (
        <label key={choice} className="share-scope-option">
          <input
            type="radio"
            name="share-scope"
            value={choice}
            checked={scope === choice}
            onChange={() => {
              onChange({ scope: choice });
            }}
          />
          <span>
            <span className="share-scope-label">{SCOPES[choice].label}</span>
            <span className="conn-note">{SCOPES[choice].hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Claude Code's own token metrics (LAI-773, LAI-867). The helper reads the
 * token each time — the person's own in `~/.laika/env`, or this machine's
 * Claude Code connection (LAI-1325) — so none is ever written.
 */
function OtelNote() {
  return (
    <p className="conn-note">
      <code>laika activity on</code>, above, also has Claude Code send its own token metrics here,
      from every Claude Code on the laptop — started from the Dock or by Omnigent included — with no
      shell line. They fill in what its session files miss — titles, classifiers, compaction —
      matched session by session, so nothing counts twice. <strong>Metrics only</strong>: Laika
      refuses logs and traces, which can carry prompt text. The token is never written: a helper
      reads it each time — your personal token in <code>~/.laika/env</code>, or this machine’s
      Claude Code connection. <code>laika activity status</code> says whether they reach this board.
    </p>
  );
}

function OtelBlock({ origin }: { readonly origin: string }) {
  const otelRef = useRef<HTMLPreElement | null>(null);
  return (
    <div className="conn-block">
      <div className="conn-block-bar">
        <span className="conn-block-label" id="share-otel-label">
          What it writes to ~/.claude/settings.json — no token
        </span>
        <CopyButton
          text={otelEnvBlock(origin)}
          selects={otelRef}
          what="the OpenTelemetry settings"
        />
      </div>
      <pre
        className="conn-pre"
        ref={otelRef}
        tabIndex={0}
        aria-labelledby="share-otel-label"
        data-otel
      >
        {otelEnvBlock(origin)}
      </pre>
    </div>
  );
}

function NothingHeld({
  held,
  deleted,
}: {
  readonly held: OwnLocalActivity;
  readonly deleted: boolean;
}) {
  return (
    <p className="conn-note" data-state="nothing-held">
      {deleted ? 'Deleted. ' : ''}Nothing held for you in these 14 days
      {held.oldest_day === null ? ', and nothing older.' : '.'}
    </p>
  );
}

function HeldFoot({
  held,
  busy,
  onErase,
}: {
  readonly held: OwnLocalActivity;
  readonly busy: boolean;
  readonly onErase: () => void;
}) {
  return (
    <>
      {held.oldest_day !== null && (
        <p className="conn-note">
          Held since {dayLabel(held.oldest_day)} · from{' '}
          {held.collectors === 1 ? 'one machine' : `${String(held.collectors)} machines`} in these
          days · kept 400 days, then deleted.
        </p>
      )}
      {held.oldest_day !== null && (
        <button
          type="button"
          className="conn-outline share-delete"
          disabled={busy}
          onClick={onErase}
        >
          Delete my local-activity history
        </button>
      )}
    </>
  );
}

/**
 * The explanations, folded (LAI-1100 #11, kept for V3's Activity tab by
 * LAI-1327): *What is sent and never sent*, *OpenTelemetry (optional)* while
 * the organisation collects, and *What the board holds for you* — each a
 * closed `<details>` with a line in view. `children` are further folds of the
 * page's own, drawn after them.
 */
export function ActivityFolds({
  model,
  origin,
  heldRef,
  children,
}: {
  readonly model: ShareActivityModel;
  readonly origin: string;
  /** The held fold, so a link elsewhere can open it and go to it. */
  readonly heldRef?: RefObject<HTMLDetailsElement | null>;
  readonly children?: ReactNode;
}) {
  if (model.state.kind !== 'ready') return null;
  const { sharing, held } = model.state;
  const heldDays = held.days.length;
  return (
    <div className="dev-folds">
      <details className="dev-fold" data-fold="sent">
        <summary>
          <span className="dev-fold-title">What is sent and never sent</span>
          <span className="dev-fold-sub">{SENT_SUMMARY}</span>
        </summary>
        <div className="dev-fold-body">
          <Intro />
          <SentLists />
        </div>
      </details>

      {sharing.org_enabled && (
        <details className="dev-fold" data-fold="otel" data-block="otel">
          <summary>
            <span className="dev-fold-title">OpenTelemetry (optional)</span>
            <span className="dev-fold-sub">
              Claude Code’s own token metrics — <code>laika activity on</code> sets it up
            </span>
          </summary>
          <div className="dev-fold-body">
            <OtelNote />
            <OtelBlock origin={origin} />
          </div>
        </details>
      )}

      <details className="dev-fold" data-fold="held" id="share-held" ref={heldRef}>
        <summary>
          <span className="dev-fold-title">What the board holds for you</span>
          <span className="dev-fold-sub">
            Last 14 days ·{' '}
            {heldDays === 0
              ? 'nothing held'
              : `${String(heldDays)} ${heldDays === 1 ? 'day' : 'days'} held`}
            {held.oldest_day !== null && ' · you can delete it'}
          </span>
        </summary>
        <div className="dev-fold-body share-held">
          {heldDays === 0 ? (
            <NothingHeld held={held} deleted={model.deleted} />
          ) : (
            // Six columns are wider than a phone: the table scrolls, not the card.
            <div className="dev-fold-scroll">
              <HeldDays held={held} />
            </div>
          )}
          <HeldFoot held={held} busy={model.busy} onErase={model.erase} />
        </div>
      </details>

      {children}
    </div>
  );
}

/**
 * Connect's *Share local activity* (D-079, LAI-751): what the developer's
 * machine sends, and a look at what the server holds for them — the classic
 * and preview Activity tab, drawn as it always was. V3 has its own Activity
 * tab, a checklist (LAI-1327), built from the same pieces.
 *
 * **Collection is the organisation's** since D-102 (amended, LAI-964): with
 * *Developer insights* on, every connected machine is collected, so there is
 * no switch of the person's here — a plain notice instead, saying what is
 * collected and who can see it, never silence. The scope and the delete stay
 * the developer's, web-session-only on the server, so no agent can do either
 * for its person. With the organisation's switch off nothing is collected, and
 * this says so.
 */
export function ShareActivity({
  canSetInsights,
  origin = window.location.origin,
  setupTabName = 'Projects tab',
}: {
  /** `org.developer_insights.set`, as the server reports it — offered the Organisation link. */
  readonly canSetInsights: boolean;
  /** This board's address, for the OpenTelemetry block (LAI-773). */
  readonly origin?: string;
  /** What the project block's tab is called here. */
  readonly setupTabName?: string;
}) {
  const model = useShareActivity();
  const { state, busy, error, deleted } = model;
  const commandRef = useRef<HTMLPreElement | null>(null);

  if (state.kind === 'loading') {
    return (
      <div className="conn-extra share-activity" data-extra="activity" aria-busy="true">
        <Spinner size="sm" />
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="conn-extra share-activity" data-extra="activity">
        <p className="conn-note conn-note-warn" role="alert">
          {state.message}
        </p>
      </div>
    );
  }

  const { sharing, held, permissions } = state;

  const orgOff = (
    <p className="conn-note conn-note-warn" data-state="org-off">
      <strong>Developer insights are off for this organisation</strong>, so nothing is collected
      from your machine.{' '}
      {canSetInsights ? (
        <>
          You can turn them on in <a href="/organisation?tab=overview">Organisation</a>.
        </>
      ) : (
        `Only ${collectionManager(permissions)} can turn them on.`
      )}
    </p>
  );

  const command = (
    <div className="conn-block">
      <div className="conn-block-bar">
        <span className="conn-block-label" id="share-command-label">
          Then, on each machine — carries no token
        </span>
        <CopyButton text={ACTIVITY_COMMAND} selects={commandRef} what="the command" />
      </div>
      <pre className="conn-pre" ref={commandRef} tabIndex={0} aria-labelledby="share-command-label">
        {ACTIVITY_COMMAND}
      </pre>
    </div>
  );

  return (
    <div className="conn-extra share-activity" data-extra="activity">
      <Intro />

      <SentLists />

      {!sharing.org_enabled ? (
        orgOff
      ) : (
        <>
          <p className="conn-note share-collects" data-state="org-collects">
            <strong>Your organisation collects your local activity:</strong> {COLLECTED}.{' '}
            {collectionAudience(permissions)} can see it, and you can see who looked.{' '}
            <a href="#share-held">See what the board holds for you</a>, and your own time on{' '}
            <a href="/my-day">My day</a>.{' '}
            {canSetInsights ? (
              <>
                You can turn Developer insights off in{' '}
                <a href="/organisation?tab=overview">Organisation</a>.
              </>
            ) : (
              `Only ${collectionManager(permissions)} can turn it off.`
            )}
          </p>

          <ScopeChoice
            scope={sharing.scope}
            busy={busy}
            setupTabName={setupTabName}
            onChange={model.change}
          />

          {command}

          {/* LAI-773: the OpenTelemetry fallback. Metrics only, with this
              board's address and no token; `laika activity on` writes it (LAI-867). */}
          <section className="share-otel" aria-labelledby="share-otel-title" data-block="otel">
            <h3 className="share-h" id="share-otel-title">
              OpenTelemetry (optional)
            </h3>
            <OtelNote />
            <OtelBlock origin={origin} />
          </section>
        </>
      )}

      <section className="share-held" id="share-held" aria-labelledby="share-held-title">
        <h3 className="share-h" id="share-held-title">
          What the board holds for you · last 14 days
        </h3>
        {held.days.length === 0 ? (
          <NothingHeld held={held} deleted={deleted} />
        ) : (
          <HeldDays held={held} />
        )}
        <HeldFoot held={held} busy={busy} onErase={model.erase} />
      </section>

      {error !== undefined && (
        <p className="conn-note conn-note-warn" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
