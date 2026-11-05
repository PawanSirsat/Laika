import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import {
  getDeveloperSetup,
  revokeMemberTool,
  unpairMemberDevice,
  type DeveloperSetup,
  type SetupDevice,
  type SetupToken,
  type SetupTool,
} from '../../../api/developer-setup.ts';
import { getCompatibility } from '../../../api/developer-updates.ts';
import { ApiError } from '../../../api/errors.ts';
import { OWNER_SETUP_NOTE } from '../../../api/owner-setup.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { revokeUserToken } from '../../../api/tokens.ts';
import { useProjects } from '../../../api/use-projects.ts';
import { ConfirmDialog } from '../../../components/ConfirmDialog.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { PermissionDenied } from '../../../components/PermissionDenied.tsx';
import { OverflowMenu } from '../../../components/wizard/OverflowMenu.tsx';
import { SETUP_CHIPS } from '../developer/v3/overview-state.ts';
import { updateManifestOf, type UpdateManifest } from '../developer/v3/update-status.ts';
import {
  accessWord,
  activityLine,
  ago,
  anchorFor,
  attentionItems,
  attentionWord,
  checkMarks,
  confirmCopy,
  deviceHelper,
  doneLine,
  firstName,
  isEmptySetup,
  launcherWord,
  liveCredential,
  looseTools,
  noTokensLine,
  pickupWord,
  reachableSpaces,
  refusalLine,
  hiddenGrants,
  hiddenSetupsLine,
  repoNeedsAttention,
  repoRows,
  SEARCH_OVER,
  SETUP_WORDS,
  shownTokens,
  TOKEN_FILTERS,
  TOKEN_STATE_WORDS,
  tokenCounts,
  tokenState,
  toolName,
  toolsOn,
  toolState,
  toolUpdate,
  type Pending,
  type TokenFilter,
} from './developer-setup-derive.ts';
import './developer-setup.css';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly view: DeveloperSetup };

export interface DeveloperSetupTabProps {
  readonly userId: string;
  readonly name: string;
  /** The reader also holds `token.revoke_any`; a tool or device revoke is the server's `can_revoke`. */
  readonly canRevokeTokens: boolean;
}

/**
 * A member's developer setup on their profile (LAI-1140, frames 2p–2ab; D-132,
 * D-133): read-only and logged, for owners and holders of *See and manage
 * anyone's developer setup*, never on your own profile. Each revoke goes
 * through a confirm that says what stops working, and the member is told in
 * Laika — never by email (D-133).
 */
export function DeveloperSetupTab({ userId, name, canRevokeTokens }: DeveloperSetupTabProps) {
  const first = firstName(name);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [manifest, setManifest] = useState<UpdateManifest | 'failed' | undefined>(undefined);
  const [pending, setPending] = useState<Pending | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const { projects } = useProjects();

  useEffect(() => {
    const controller = new AbortController();
    getDeveloperSetup(userId, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [userId, attempt]);

  useEffect(() => {
    const controller = new AbortController();
    getCompatibility(controller.signal)
      .then((body) => {
        if (!controller.signal.aborted) setManifest(updateManifestOf(body) ?? 'failed');
      })
      .catch(() => {
        if (!controller.signal.aborted) setManifest('failed');
      });
    return () => {
      controller.abort();
    };
  }, []);

  const spaceName = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p.name]));
    return (id: string): string => byId.get(id) ?? 'A space';
  }, [projects]);

  const notice_ = (
    <p className="ds-notice" data-ds-notice>
      <LockGlyph />
      <span>Owners and admins only · read-only · {first} can see that you looked</span>
    </p>
  );

  if (load.kind === 'loading') {
    return (
      <div className="ds" data-ds-loading>
        {notice_}
        <p role="status" className="visually-hidden">
          Reading {first}’s setup…
        </p>
        <div className="ds-skeleton" aria-hidden="true">
          {['summary', 'devices', 'tools', 'repos', 'tokens', 'activity'].map((s) => (
            <div key={s} className="ds-card">
              <span className="ds-skel ds-skel-title" />
              <span className="ds-skel" />
              <span className="ds-skel" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (load.kind === 'error') {
    if (load.error instanceof ApiError && load.error.code === 'forbidden') {
      return (
        <PermissionDenied
          resource={`${first}’s developer setup`}
          requiredRole="admin"
          scope="organisation"
        />
      );
    }
    const why =
      load.error instanceof Error && load.error.message !== ''
        ? load.error.message
        : 'The server did not answer.';
    return (
      <div className="ds" data-ds-error>
        {notice_}
        <div role="alert" className="ds-error">
          <span>
            <b>{first}’s setup could not be read.</b> {why} Nothing was changed.
          </span>
          <button
            type="button"
            className="ds-retry"
            onClick={() => {
              setLoad({ kind: 'loading' });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { view } = load;
  const deactivated = !view.user.is_active;
  const canAct = view.can_revoke;
  const canToken = canAct && canRevokeTokens;

  const ask = (next: Pending): void => {
    setRefusal(undefined);
    setNotice(undefined);
    setPending(next);
  };

  const run = (target: Pending): void => {
    setBusy(true);
    setRefusal(undefined);
    const done = doneLine(target, view, first);
    const call: Promise<unknown> =
      target.kind === 'unpair'
        ? unpairMemberDevice(userId, target.id)
        : target.kind === 'tool'
          ? revokeMemberTool(userId, target.id)
          : revokeUserToken(userId, target.id);
    call
      .then(() => {
        // The write is done: say so, and read the setup again behind it. A
        // failed re-read is the tab's own error, never the revoke's.
        setPending(undefined);
        setNotice(done);
        setAttempt((n) => n + 1);
      })
      .catch((error: unknown) => {
        setRefusal(refusalLine(error, 'The revoke did not go through. Nothing was changed.'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const copy = pending === undefined ? undefined : confirmCopy(pending, view, first);

  return (
    <div className="ds" data-ds-ready data-deactivated={deactivated ? '' : undefined}>
      {notice_}
      {deactivated && (
        <p role="note" className="ds-deactivated" data-ds-deactivated>
          <b>This account is deactivated.</b> Everything below is read-only history.{' '}
          {canAct ? 'Only revoke actions are left.' : 'Nothing here can be changed.'}
        </p>
      )}
      {/*
       * Actions follow the server's `can_revoke`, not `mayActOnSetupOf`: the
       * read already asked `can()` about this reader and this person, so the
       * tab draws what the server will allow rather than a second guess at it.
       * The owner note is said only when the owner is why.
       */}
      {!canAct && (
        <p role="note" className="ds-owner-note" data-ds-owner-note>
          {view.user.org_role === 'owner'
            ? `${OWNER_SETUP_NOTE} Those actions are not offered here.`
            : 'Revoke actions are not offered to you here.'}
        </p>
      )}
      {notice !== undefined && (
        <p role="status" className="ds-done" data-ds-done>
          {notice}
        </p>
      )}

      {isEmptySetup(view) ? (
        <section className="ds-card" aria-labelledby="ds-empty-title" data-ds-empty>
          <h3 className="ds-title" id="ds-empty-title">
            {first} hasn’t set up any tools yet
          </h3>
          <p className="ds-muted">
            No device is paired and no tool holds a credential, so no agent can pick up or work on
            cards for {first}. Their own time and cards are not affected.
          </p>
          <ul className="ds-muted ds-list">
            <li>
              {first} starts from Developer access on their own account. Admins can’t set it up for
              them.
            </li>
            <li>Personal tokens, if any are made later, show up under Tokens here.</li>
          </ul>
        </section>
      ) : (
        <div className="ds-body">
          <Summary view={view} manifest={manifest} />
          <Devices view={view} canAct={canAct} onAsk={ask} first={first} manifest={manifest} />
          <Tools view={view} canAct={canAct} onAsk={ask} spaceName={spaceName} />
          <Repositories view={view} />
          <Tokens view={view} canAct={canToken} onAsk={ask} spaceName={spaceName} />
          <Activity view={view} />
        </div>
      )}

      {pending !== undefined && copy !== undefined && (
        <ConfirmDialog
          title={copy.title}
          confirmLabel={copy.cta}
          danger
          icon="warning"
          busy={busy}
          error={refusal}
          onConfirm={() => {
            run(pending);
          }}
          onClose={() => {
            if (!busy) setPending(undefined);
          }}
        >
          <span className="ds-confirm" data-ds-confirm={pending.kind}>
            <span className="ds-confirm-lead">{copy.lead}</span>
            <span className="ds-confirm-head">What stops working</span>
            <span className="ds-confirm-stops" role="list">
              {copy.stops.map((line) => (
                <span role="listitem" key={line}>
                  {line}
                </span>
              ))}
            </span>
            <span className="ds-confirm-notify" data-ds-notify>
              {copy.notify}
            </span>
          </span>
        </ConfirmDialog>
      )}
    </div>
  );
}

function LockGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="ds-lock">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </svg>
  );
}

function Section({
  id,
  title,
  count,
  caption,
  children,
  extra,
}: {
  readonly id: string;
  readonly title: string;
  readonly count?: number | undefined;
  readonly caption?: string | undefined;
  readonly children: ReactNode;
  readonly extra?: ReactNode;
}) {
  return (
    <section className="ds-card" aria-labelledby={`ds-${id}-title`} data-ds-section={id}>
      <header className="ds-head">
        <h3 className="ds-title" id={`ds-${id}-title`}>
          {title}
        </h3>
        {count !== undefined && <span className="ds-count">{count}</span>}
        {caption !== undefined && <span className="ds-caption">{caption}</span>}
        {extra}
      </header>
      {children}
    </section>
  );
}

/** Moves focus to the item a health-line link names (§1's *Health line jump targets*). */
function jump(target: string) {
  return (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    const el = document.getElementById(target);
    if (el === null) return;
    el.setAttribute('tabindex', '-1');
    el.scrollIntoView({ block: 'center' });
    el.focus({ preventScroll: true });
  };
}

function Summary({
  view,
  manifest,
}: {
  readonly view: DeveloperSetup;
  readonly manifest: UpdateManifest | 'failed' | undefined;
}) {
  const s = view.summary;
  const reach = reachableSpaces(view.tools);
  const reachHidden = hiddenGrants(view.tools);
  const setups = repoRows(view.repositories, view.tools, view.devices).length;
  const items = attentionItems(view, manifest);
  const seenOn = view.devices.find((d) => d.last_seen_at === s.last_seen_at)?.display_name;
  const tiles: readonly (readonly [string, string, string])[] = [
    ['Devices', `${String(s.devices_active)} / ${String(s.devices_revoked)}`, 'active / revoked'],
    ['Tools set up', String(s.tools_active), `${String(s.tools_revoked)} revoked`],
    [
      'Repositories set up',
      String(setups),
      s.repositories_hidden === 0 ? 'all visible to you' : hiddenSetupsLine(s.repositories_hidden),
    ],
    [
      'Spaces reachable',
      String(reach.size),
      reachHidden === 0 ? 'by their live tools' : `+${String(reachHidden)} you can’t see`,
    ],
    ['Active tokens', String(s.tokens_active), `${String(s.tokens_inactive)} expired or revoked`],
    [
      'Last activity',
      ago(s.last_seen_at, view.now),
      seenOn === undefined
        ? s.pending_pairing > 0
          ? `${String(s.pending_pairing)} pairing waiting`
          : ''
        : `on ${seenOn}`,
    ],
  ];
  return (
    <Section id="summary" title="Developer setup">
      <dl className="ds-tiles">
        {tiles.map(([label, value, sub]) => (
          <div className="ds-tile" key={label} data-ds-tile={label}>
            <dt>{label}</dt>
            <dd className="ds-tile-value">{value}</dd>
            <dd className="ds-tile-sub">{sub}</dd>
          </div>
        ))}
      </dl>
      {/* Only the headline is a live region: the links are for moving, not for announcing. */}
      <div
        className={items.length === 0 ? 'ds-health ds-health-ok' : 'ds-health ds-health-warn'}
        data-ds-health={items.length}
      >
        <b>
          <span aria-hidden="true" className="ds-health-glyph">
            {items.length === 0 ? '✓' : '!'}
          </span>
          <span role="status" data-ds-health-word>
            {attentionWord(items.length)}
          </span>
        </b>
        {items.map((item) => (
          <a
            key={item.label}
            href={`#${item.target}`}
            onClick={jump(item.target)}
            data-ds-jump={item.target}
          >
            {item.label}
          </a>
        ))}
      </div>
    </Section>
  );
}

function Devices({
  view,
  canAct,
  onAsk,
  first,
  manifest,
}: {
  readonly view: DeveloperSetup;
  readonly canAct: boolean;
  readonly onAsk: (p: Pending) => void;
  readonly first: string;
  readonly manifest: UpdateManifest | 'failed' | undefined;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [revokedOpen, setRevokedOpen] = useState(false);
  const live = view.devices.filter((d) => d.status === 'active');
  const revoked = view.devices.filter((d) => d.status === 'revoked');
  return (
    <Section id="devices" title="Devices" count={live.length}>
      {live.length === 0 ? (
        <p className="ds-muted">No device is paired now.</p>
      ) : (
        <div role="table" aria-label="Devices" className="ds-table ds-dev-table">
          <div role="row" className="ds-row ds-row-head">
            <span role="columnheader">Device</span>
            <span role="columnheader">Last seen</span>
            <span role="columnheader">Key fingerprint</span>
            <span role="columnheader">Helper</span>
            <span role="columnheader">Launcher</span>
            <span role="columnheader">Auto-pickup</span>
            <span role="columnheader">Tools</span>
            <span role="columnheader">
              <span className="visually-hidden">Actions</span>
            </span>
          </div>
          {live.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              view={view}
              open={open.has(d.id)}
              onToggle={() => {
                setOpen((s) => {
                  const next = new Set(s);
                  if (next.has(d.id)) next.delete(d.id);
                  else next.add(d.id);
                  return next;
                });
              }}
              canAct={canAct}
              onAsk={onAsk}
              manifest={manifest}
            />
          ))}
        </div>
      )}
      {revoked.length > 0 && (
        <div className="ds-revoked">
          <button
            type="button"
            className="ds-fold"
            aria-expanded={revokedOpen}
            onClick={() => {
              setRevokedOpen((o) => !o);
            }}
            data-ds-revoked-toggle
          >
            <Chevron open={revokedOpen} />
            Revoked ({revoked.length})
          </button>
          {revokedOpen && (
            <ul className="ds-revoked-list" data-ds-revoked-list>
              {revoked.map((d) => (
                <li key={d.id}>
                  <code className="ds-struck">{d.display_name}</code> ·{' '}
                  {d.kind === 'cloud' ? 'Cloud' : 'Local'} · revoked{' '}
                  {ago(d.revoked_at, view.now, 'at an unknown time')}
                  {d.revoked_by !== null && ` by ${d.revoked_by.name}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {view.pending_pairing.length > 0 && (
        <div className="ds-pending" data-ds-pending>
          <span className="ds-subhead">
            Pending pairing requests ({view.pending_pairing.length})
          </span>
          {view.pending_pairing.map((p) => (
            <span className="ds-pending-row" key={p.id} data-ds-pairing={p.id}>
              <code>{p.display_name}</code>
              <span className="ds-muted">
                {p.kind === 'cloud' ? 'Cloud' : 'Local'} · requested {ago(p.created_at, view.now)}
              </span>
              <span className="ds-caption">waiting for {first} to approve it</span>
            </span>
          ))}
        </div>
      )}
    </Section>
  );
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={open ? 'ds-chev ds-chev-open' : 'ds-chev'}
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function DeviceRow({
  device,
  view,
  open,
  onToggle,
  canAct,
  onAsk,
  manifest,
}: {
  readonly device: SetupDevice;
  readonly view: DeveloperSetup;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly canAct: boolean;
  readonly onAsk: (p: Pending) => void;
  readonly manifest: UpdateManifest | 'failed' | undefined;
}) {
  const tools = toolsOn(device, view.tools);
  const helper = deviceHelper(tools);
  const update = tools
    .map((t) => toolUpdate(t, manifest))
    .some((u) => u?.key === 'available' || u?.key === 'required');
  return (
    <>
      <div
        role="row"
        className="ds-row"
        id={anchorFor.device(device.id)}
        data-ds-device={device.id}
      >
        <span role="rowheader" className="ds-cell-main">
          <button type="button" className="ds-expand" aria-expanded={open} onClick={onToggle}>
            <Chevron open={open} />
            <span className="ds-stack">
              <span className="ds-mono ds-strong">{device.display_name}</span>
              <span className="ds-caption">
                {device.kind === 'cloud' ? 'Cloud' : 'Local'} ·{' '}
                {device.origin === 'paired' ? 'Paired' : 'Imported'}
              </span>
            </span>
          </button>
        </span>
        <span role="cell">
          <span className="ds-lbl">Last seen </span>
          {ago(device.last_seen_at, view.now)}
        </span>
        <span role="cell" className="ds-fp">
          <span className="ds-lbl">Key </span>
          {device.key_fingerprint === null ? (
            <span className="ds-muted">Not paired</span>
          ) : (
            <>
              <code className="ds-mono ds-ellipsis">{device.key_fingerprint}</code>
              <CopyButton
                text={device.key_fingerprint}
                what={`the key fingerprint of ${device.display_name}`}
                className="ds-copy"
              />
            </>
          )}
        </span>
        <span role="cell">
          <span className="ds-lbl">Helper </span>
          <code className="ds-mono">{helper ?? 'Version unknown'}</code>
          {update && <span className="ds-chip ds-chip-blue">Update available</span>}
        </span>
        <span role="cell">
          <span className="ds-lbl">Launcher </span>
          {launcherWord(device.launcher)}
        </span>
        <span role="cell">
          <span className="ds-lbl">Auto-pickup </span>
          {pickupWord(device.launcher)}
        </span>
        <span role="cell">
          <span className="ds-lbl">Tools </span>
          {tools.filter((t) => t.status === 'active').length}
        </span>
        <span role="cell" className="ds-cell-menu">
          {canAct && (
            <OverflowMenu
              label={`Actions for ${device.display_name}`}
              items={[
                {
                  id: 'unpair',
                  label: 'Unpair device…',
                  danger: true,
                  onSelect: () => {
                    onAsk({ kind: 'unpair', id: device.id });
                  },
                },
              ]}
            />
          )}
        </span>
      </div>
      {open && (
        <div role="row" className="ds-row-open" data-ds-device-tools={device.id}>
          <div role="cell" className="ds-stack">
            <span className="ds-subhead">Tools on {device.display_name}</span>
            {tools.length === 0 ? (
              <span className="ds-muted">No tool on this device.</span>
            ) : (
              tools.map((t) => {
                const st = toolState(t, view.now);
                return (
                  <span className="ds-inline" key={t.id}>
                    <b>{toolName(t)}</b>
                    <StatusChip tone={st.tone} word={st.word} />
                    <a href={`#${anchorFor.tool(t.id)}`} onClick={jump(anchorFor.tool(t.id))}>
                      Details below
                    </a>
                  </span>
                );
              })
            )}
          </div>
        </div>
      )}
    </>
  );
}

function StatusChip({ tone, word }: { readonly tone: string; readonly word: string }) {
  return (
    <span className={`ds-chip ds-chip-${tone}`} data-ds-status={word}>
      {word}
    </span>
  );
}

function Tools({
  view,
  canAct,
  onAsk,
  spaceName,
}: {
  readonly view: DeveloperSetup;
  readonly canAct: boolean;
  readonly onAsk: (p: Pending) => void;
  readonly spaceName: (id: string) => string;
}) {
  const groups: { readonly key: string; readonly title: string; readonly tools: SetupTool[] }[] = [
    ...view.devices
      .filter((d) => d.status === 'active')
      .map((d) => ({ key: d.id, title: d.display_name, tools: toolsOn(d, view.tools) })),
    ...view.devices
      .filter((d) => d.status === 'revoked')
      .map((d) => ({
        key: d.id,
        title: `${d.display_name} (unpaired)`,
        tools: toolsOn(d, view.tools),
      })),
    { key: 'loose', title: 'Not on a paired device', tools: looseTools(view) },
  ].filter((g) => g.tools.length > 0);
  return (
    <Section id="tools" title="Tools" caption="by device">
      {groups.length === 0 && <p className="ds-muted">No tool is set up.</p>}
      {groups.map((g) => (
        <div className="ds-group" key={g.key}>
          <h4 className="ds-subhead">
            <code className="ds-mono">{g.title}</code> · {g.tools.length}{' '}
            {g.tools.length === 1 ? 'tool' : 'tools'}
          </h4>
          <div className="ds-tool-grid">
            {g.tools.map((t) => (
              <ToolCard
                key={t.id}
                tool={t}
                view={view}
                canAct={canAct}
                onAsk={onAsk}
                spaceName={spaceName}
                device={g.title}
              />
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

function ToolCard({
  tool,
  view,
  canAct,
  onAsk,
  spaceName,
  device,
}: {
  readonly tool: SetupTool;
  readonly view: DeveloperSetup;
  readonly canAct: boolean;
  readonly onAsk: (p: Pending) => void;
  readonly spaceName: (id: string) => string;
  readonly device: string;
}) {
  const st = toolState(tool, view.now);
  const cred = liveCredential(tool, view.now);
  const version =
    tool.checks.tool_request.detail.client_version ?? tool.client_report?.harness_version ?? null;
  const facts: readonly (readonly [string, string, boolean])[] = [
    ['Automatic checkpoints', tool.checkpoint_consent ? 'Given' : 'Not given', false],
    [
      'Launcher',
      tool.launcher.state === 'on' ? 'On' : tool.launcher.state === 'unknown' ? 'Unknown' : 'Off',
      false,
    ],
    ['Credential', cred === undefined ? 'None live' : `${cred.prefix}…`, cred !== undefined],
    ['Last used', ago(tool.last_seen_at, view.now), false],
    ['Last MCP call', ago(cred?.last_mcp_at ?? null, view.now, 'Never connected'), false],
    ['Client version', version ?? '—', true],
  ];
  return (
    <article
      className={st.tone === 'warn' ? 'ds-tool ds-tool-warn' : 'ds-tool'}
      id={anchorFor.tool(tool.id)}
      aria-label={`${toolName(tool)} on ${device}`}
      data-ds-tool={tool.id}
    >
      <div className="ds-inline">
        <b className="ds-strong">{toolName(tool)}</b>
        <StatusChip tone={st.tone} word={st.word} />
        {tool.revoked_by !== null && (
          <span className="ds-caption">revoked by {tool.revoked_by.name}</span>
        )}
        <span className="ds-push">
          {canAct && tool.status === 'active' && (
            <OverflowMenu
              label={`Actions for ${toolName(tool)} on ${device}`}
              items={[
                {
                  id: 'revoke',
                  label: 'Revoke tool…',
                  danger: true,
                  onSelect: () => {
                    onAsk({ kind: 'tool', id: tool.id });
                  },
                },
              ]}
            />
          )}
        </span>
      </div>
      <ul aria-label="Checks" className="ds-checks">
        {checkMarks(tool).map((c) => (
          <li
            key={c.label}
            className={c.ok ? 'ds-check-ok' : 'ds-check-no'}
            aria-label={`${c.label}: ${c.ok ? 'yes' : 'no'}`}
          >
            <span aria-hidden="true">{c.ok ? '✓' : '✗'}</span> {c.label}
          </li>
        ))}
      </ul>
      <div className="ds-inline ds-small">
        <span className="ds-muted">Can reach</span>
        {tool.grants.length === 0 && tool.grants_hidden === 0 && (
          <span className="ds-muted">nothing</span>
        )}
        {tool.grants.map((g) => (
          <span className="ds-space" key={g.project_id}>
            {spaceName(g.project_id)} · <b>{accessWord(g.scope)}</b>
          </span>
        ))}
        {tool.grants_hidden > 0 && (
          <span className="ds-muted" data-ds-grants-hidden>
            {tool.grants_hidden} {tool.grants_hidden === 1 ? 'space' : 'spaces'} you can’t see
          </span>
        )}
      </div>
      <dl className="ds-facts">
        {facts.map(([k, v, mono]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={mono ? 'ds-mono' : undefined}>{v}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function Check({
  ok,
  yes,
  no,
  label,
}: {
  readonly ok: boolean | null;
  readonly yes: string;
  readonly no: string;
  readonly label: string;
}) {
  if (ok === null) {
    return (
      <span role="cell" className="ds-muted" aria-label={`${label}: not checked`}>
        <span className="ds-lbl">{label} </span>—
      </span>
    );
  }
  return (
    <span
      role="cell"
      className={ok ? 'ds-check-ok' : 'ds-check-no'}
      aria-label={`${label}: ${ok ? 'yes' : 'no'}`}
    >
      <span className="ds-lbl">{label} </span>
      <span aria-hidden="true">{ok ? '✓' : '✗'}</span> {ok ? yes : no}
    </span>
  );
}

function Repositories({ view }: { readonly view: DeveloperSetup }) {
  const rows = repoRows(view.repositories, view.tools, view.devices);
  const hidden = view.summary.repositories_hidden;
  return (
    <Section id="repos" title="Repositories & projects" count={rows.length}>
      {rows.length === 0 && hidden === 0 ? (
        <p className="ds-muted">No repository has been set up for Laika.</p>
      ) : (
        <div role="table" aria-label="Repositories" className="ds-table ds-repo-table">
          <div role="row" className="ds-row ds-row-head">
            <span role="columnheader">Repository</span>
            <span role="columnheader">Space</span>
            <span role="columnheader">Used by</span>
            <span role="columnheader">Instructions</span>
            <span role="columnheader">Project</span>
            <span role="columnheader">Key prefix</span>
            <span role="columnheader">Template</span>
            <span role="columnheader">Last checked</span>
          </div>
          {rows.map((r) => (
            <div
              role="row"
              key={r.key}
              id={anchorFor.repo(r.key)}
              className={repoNeedsAttention(r) ? 'ds-row ds-row-bad' : 'ds-row'}
              data-ds-repo={r.repo}
              data-ds-repo-chip={r.chip}
            >
              <span role="rowheader" className="ds-stack ds-cell-main">
                <span className="ds-mono ds-strong">{r.repo}</span>
                <StatusChip tone={SETUP_CHIPS[r.chip].tone} word={SETUP_WORDS[r.chip]} />
              </span>
              <span role="cell">
                <code className="ds-mono">{r.projectSlug}</code>
              </span>
              <span role="cell" className="ds-muted">
                {r.usedBy.length === 0 ? '—' : r.usedBy.join(', ')}
              </span>
              <Check ok={r.instructions} yes="Found" no="Missing" label="Instructions file" />
              <Check ok={r.project} yes="Matches" no="No match" label="Project" />
              <Check ok={r.prefix} yes="Matches" no="No match" label="Key prefix" />
              <span role="cell">
                <span className="ds-lbl">Template </span>
                <code className="ds-mono">
                  {r.revision === null ? '—' : `rev ${String(r.revision)}`}
                </code>
              </span>
              <span role="cell" className="ds-muted">
                <span className="ds-lbl">Last checked </span>
                {ago(r.checkedAt, view.now)}
              </span>
            </div>
          ))}
          {hidden > 0 && (
            <div role="row" className="ds-hidden-row" data-ds-repos-hidden>
              <span role="cell">{hiddenSetupsLine(hidden)}</span>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function Tokens({
  view,
  canAct,
  onAsk,
  spaceName,
}: {
  readonly view: DeveloperSetup;
  readonly canAct: boolean;
  readonly onAsk: (p: Pending) => void;
  readonly spaceName: (id: string) => string;
}) {
  const [filter, setFilter] = useState<TokenFilter>('active');
  const [query, setQuery] = useState('');
  const all = [...view.tokens.personal, ...view.tokens.tool_credentials];
  const counts = tokenCounts(all, view.now);
  const search = all.length > SEARCH_OVER;
  const groups = (
    [
      ['personal', 'Personal tokens', view.tokens.personal],
      ['tool', 'Tool credentials (Tool · Device)', view.tokens.tool_credentials],
    ] as const
  )
    .map(([key, title, list]) => ({
      key,
      title,
      rows: shownTokens(list, filter, search ? query : '', view.now),
    }))
    .filter((g) => g.rows.length > 0);
  return (
    <Section
      id="tokens"
      title="Tokens"
      extra={
        <>
          <div role="radiogroup" aria-label="Show tokens" className="ds-seg">
            {TOKEN_FILTERS.map(([f, label]) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                className={filter === f ? 'ds-seg-on' : undefined}
                onClick={() => {
                  setFilter(f);
                }}
                data-ds-filter={f}
              >
                {label} <span className="ds-mono">{counts[f]}</span>
              </button>
            ))}
          </div>
          {search && (
            <label className="ds-search">
              <span className="visually-hidden">Search tokens</span>
              <input
                type="search"
                value={query}
                placeholder="Name or prefix"
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                data-ds-search
              />
            </label>
          )}
        </>
      }
    >
      {groups.length === 0 && (
        <p className="ds-muted" data-ds-no-tokens>
          {noTokensLine(filter, search ? query : '')}
        </p>
      )}
      {groups.map((g) => (
        <div
          role="table"
          aria-label={g.title}
          className="ds-table ds-tok-table"
          key={g.key}
          data-ds-token-group={g.key}
        >
          <span className="ds-subhead">
            {g.title} <span className="ds-mono">{g.rows.length}</span>
          </span>
          <div role="row" className="ds-row ds-row-head">
            <span role="columnheader">Name</span>
            <span role="columnheader">Scope</span>
            <span role="columnheader">Pinned to</span>
            <span role="columnheader">Created</span>
            <span role="columnheader">Expires</span>
            <span role="columnheader">Last used</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">
              <span className="visually-hidden">Actions</span>
            </span>
          </div>
          {g.rows.map((t) => (
            <TokenLine
              key={t.id}
              token={t}
              now={view.now}
              canAct={canAct}
              onAsk={onAsk}
              spaceName={spaceName}
            />
          ))}
        </div>
      ))}
    </Section>
  );
}

const day = (at: number): string =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function TokenLine({
  token,
  now,
  canAct,
  onAsk,
  spaceName,
}: {
  readonly token: SetupToken;
  readonly now: number;
  readonly canAct: boolean;
  readonly onAsk: (p: Pending) => void;
  readonly spaceName: (id: string) => string;
}) {
  const state = tokenState(token, now);
  const live = state === 'active' || state === 'idle' || state === 'never';
  const client = token.last_client_name ?? token.last_client;
  return (
    <div role="row" className="ds-row" data-ds-token={token.id} data-ds-token-state={state}>
      <span role="rowheader" className="ds-stack ds-cell-main">
        <span className="ds-strong">{token.name}</span>
        <code className="ds-mono ds-muted">{token.prefix}…</code>
      </span>
      <span role="cell">
        <span className="ds-lbl">Scope </span>
        {accessWord(token.scope)}
      </span>
      <span role="cell">
        <span className="ds-lbl">Pinned to </span>
        {token.project_ids === null ? (
          <span className="ds-muted">Every space they can open</span>
        ) : (
          <>
            {token.project_ids.map((id) => spaceName(id)).join(', ')}
            {token.project_ids_hidden > 0 && (
              <span className="ds-muted" data-ds-pins-hidden>
                {token.project_ids.length > 0 ? ' + ' : ''}
                {token.project_ids_hidden} you can’t see
              </span>
            )}
          </>
        )}
      </span>
      <span role="cell" className="ds-muted">
        <span className="ds-lbl">Created </span>
        {day(token.created_at)}
      </span>
      <span role="cell" className="ds-muted">
        <span className="ds-lbl">Expires </span>
        {state === 'revoked' && token.revoked_at !== null
          ? `Revoked ${day(token.revoked_at)}`
          : token.expires_at === null
            ? 'Never'
            : day(token.expires_at)}
      </span>
      <span role="cell" className="ds-stack ds-muted">
        <span>
          <span className="ds-lbl">Last used </span>
          {token.last_used_at === null ? 'Never' : timeLabel(token.last_used_at, now).text}
        </span>
        {client !== null && <code className="ds-mono ds-tiny">{client}</code>}
      </span>
      <span role="cell">
        <StatusChip
          tone={state === 'active' ? 'ok' : state === 'expired' ? 'warn' : 'neutral'}
          word={TOKEN_STATE_WORDS[state]}
        />
      </span>
      <span role="cell" className="ds-cell-menu">
        {canAct && live && (
          <OverflowMenu
            label={`Actions for ${token.name}`}
            items={[
              {
                id: 'revoke',
                label: 'Revoke token…',
                danger: true,
                onSelect: () => {
                  onAsk({ kind: 'token', id: token.id });
                },
              },
            ]}
          />
        )}
      </span>
    </div>
  );
}

function Activity({ view }: { readonly view: DeveloperSetup }) {
  return (
    <Section id="activity" title="Recent setup activity" caption="last 30 days">
      {view.activity.length === 0 ? (
        <p className="ds-muted">Nothing changed in the last 30 days.</p>
      ) : (
        <ol className="ds-activity">
          {view.activity.map((a, i) => {
            const label = timeLabel(a.at, view.now);
            return (
              <li key={`${String(a.at)}-${a.kind}-${String(i)}`} data-ds-activity={a.kind}>
                <span aria-hidden="true" className={`ds-dot ds-dot-${a.kind}`} />
                <time dateTime={label.iso} title={label.full}>
                  {label.text}
                </time>
                <span>{activityLine(a)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
