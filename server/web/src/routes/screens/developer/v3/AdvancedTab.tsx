import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { everyPage } from '../../../../api/every-page.ts';
import type { MeProfile } from '../../../../api/me.ts';
import {
  createToken,
  forcedTokenScope,
  lastUsedLabel,
  listTokens,
  mayChooseScope,
  revokeToken,
  tokenState,
  type CreatedToken,
  type TokenScope,
  type TokenView,
} from '../../../../api/tokens.ts';
import { asAgentClient, AGENT_CLIENT_NAMES } from '../../../../api/agent-clients.ts';
import { ApiErrorState } from '../../../../components/ApiErrorState.tsx';
import { useConfirm } from '../../../../components/ConfirmProvider.tsx';
import { CopyButton } from '../../../../components/CopyButton.tsx';
import { Dropdown } from '../../../../components/Dropdown.tsx';
import { EmptyState } from '../../../../components/EmptyState.tsx';
import { LoadingState } from '../../../../components/LoadingState.tsx';
import { Spinner } from '../../../../components/Spinner.tsx';
import { LiveRegion } from '../../../../components/wizard/LiveRegion.tsx';
import { OverflowMenu } from '../../../../components/wizard/OverflowMenu.tsx';
import { useLiveRegion } from '../../../../components/wizard/live-region.ts';
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  expiresAtFor,
  isLegacyToolToken,
  upgradeHref,
} from './advanced.ts';
import '../../tokens/tokens.css';
import '../../../../components/token-row.css';

export interface AdvancedTabProps {
  readonly me: MeProfile | undefined;
  readonly onNavigate: (to: string) => void;
}

const TOOLS_HREF = '/developer?tab=tools';

/**
 * Developer access V3 → Advanced (LAI-1058, plan §B.6): the reader's own
 * **personal** credentials, for scripts, the REST API and automation.
 *
 * - **Personal only** (`?kind=personal`, LAI-1046). A coding tool's credential
 *   belongs to the tool on Tools; listing it here made it look like an
 *   anonymous token.
 * - **An expiry is chosen when creating**, 90 days by default; *Never* is still
 *   allowed (plan §L7) but is not the default.
 * - **A personal token a coding tool uses** is the pre-V3 way of connecting it.
 *   It is labelled *Personal (legacy)*, says how to move, and offers *Upgrade
 *   connection* — a link to Tools → Add a tool. Nothing is revoked by it: the
 *   old token keeps working until its owner revokes it here.
 * - **Revoke is under the row's `⋯`**, behind a confirmation, and a failure
 *   is shown whether or not the form is open.
 *
 * The one-time secret is the classic Tokens screen's rule, kept as is: in
 * component state only, blanked through state before it unmounts.
 */
export function AdvancedTab({ me, onNavigate }: AdvancedTabProps) {
  const confirm = useConfirm();
  const [message, announce] = useLiveRegion();
  const formId = useId();
  const [tokens, setTokens] = useState<readonly TokenView[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());

  const [minting, setMinting] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('full');
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
  const [mintError, setMintError] = useState<string | undefined>(undefined);
  const [actionError, setActionError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [revealed, setRevealed] = useState<CreatedToken | undefined>(undefined);

  const newButtonRef = useRef<HTMLButtonElement | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const listTitleRef = useRef<HTMLHeadingElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);
  /** Where focus goes once the form or the secret panel has gone. */
  const returnFocus = useRef(false);

  /** As `TokensScreen`'s `forget`: blank the secret through state, then unmount it. */
  const forget = (): void => {
    setRevealed((current) =>
      current === undefined ? undefined : { token: current.token, secret: '' },
    );
    setTimeout(() => {
      setRevealed(undefined);
    }, 0);
  };

  const reload = (signal?: AbortSignal): void => {
    everyPage((cursor) =>
      listTokens(
        signal,
        cursor === undefined ? { limit: 200 } : { limit: 200, cursor },
        'personal',
      ),
    )
      .then(({ items }) => {
        // Belt and braces: an older server ignores `?kind=` and sends all.
        setTokens(items.filter((token) => token.kind !== 'agent'));
        setLoadError(null);
        setNow(Date.now());
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return;
        setLoadError(cause);
      });
  };

  useEffect(() => {
    const controller = new AbortController();
    reload(controller.signal);
    return () => {
      controller.abort();
    };
  }, []);

  useEffect(() => {
    if (minting) nameRef.current?.focus();
  }, [minting]);

  useEffect(() => {
    if (revealed !== undefined && revealed.secret !== '') doneRef.current?.focus();
  }, [revealed]);

  useEffect(() => {
    if (!minting && revealed === undefined && returnFocus.current) {
      returnFocus.current = false;
      newButtonRef.current?.focus();
    }
  }, [minting, revealed]);

  const canChoose = me !== undefined && mayChooseScope(me.org_role);
  const effectiveScope = me === undefined ? scope : forcedTokenScope(me.org_role, scope);

  const closeForm = (): void => {
    returnFocus.current = true;
    setMinting(false);
    setMintError(undefined);
  };

  const mint = (): void => {
    setPending(true);
    setMintError(undefined);
    const expiresAt = expiresAtFor(expiry, Date.now());
    createToken({
      name: name.trim(),
      scope: effectiveScope,
      ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
    })
      .then((created) => {
        setRevealed(created);
        setName('');
        setExpiry(DEFAULT_EXPIRY);
        setMinting(false);
        announce(`Created ${created.token.name}. Copy its secret now; it is not shown again.`);
        reload();
      })
      .catch((cause: unknown) => {
        setMintError(cause instanceof Error ? cause.message : 'Could not create that credential.');
      })
      .finally(() => {
        setPending(false);
      });
  };

  const revoke = (token: TokenView): void => {
    const legacy = isLegacyToolToken(token);
    void confirm({
      title: `Revoke “${token.name}”?`,
      body: legacy
        ? 'A coding tool is using this token. It stops working immediately and cannot be restored. Connect the tool on Tools first if you still use it.'
        : 'Anything using it — a script, an automation, a call to the API — stops working immediately, and it cannot be restored. You can create a new one.',
      confirmLabel: 'Revoke credential',
      danger: true,
      icon: 'warning',
    }).then((yes) => {
      if (!yes) return;
      setActionError(undefined);
      revokeToken(token.id)
        .then(() => {
          announce(`Revoked ${token.name}.`);
          listTitleRef.current?.focus();
          reload();
        })
        .catch((cause: unknown) => {
          setActionError(cause instanceof Error ? cause.message : 'Could not revoke that token.');
        });
    });
  };

  const go = (to: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(to);
  };

  const legacyCount = tokens?.filter(
    (token) => isLegacyToolToken(token) && tokenState(token, now) === 'active',
  ).length;

  return (
    <div className="tokens dev-adv">
      <LiveRegion message={message} />
      <div className="dev-advanced-head">
        <div className="dev-adv-intro">
          <h2 className="dev-adv-title">Personal credentials</h2>
          <p className="dev-advanced-intro">
            For scripts, the REST API and automation. A personal credential acts as you, with your
            permissions, so treat it like your password. Coding tools get their own credential on{' '}
            <a href={TOOLS_HREF} onClick={go(TOOLS_HREF)}>
              Tools
            </a>{' '}
            instead — never a personal one.
          </p>
        </div>
        {!minting && (
          <button
            type="button"
            ref={newButtonRef}
            className="bar-control bar-control-primary"
            aria-controls={formId}
            onClick={() => {
              setActionError(undefined);
              setMinting(true);
            }}
          >
            + New personal credential
          </button>
        )}
      </div>

      {actionError !== undefined && (
        <p className="tok-error dev-adv-error" role="alert">
          {actionError}
        </p>
      )}

      {/* Shown once, and only once (§4.9): not on the row, not stored, not re-fetchable. */}
      {revealed !== undefined && (
        <section className="tok-reveal" role="alert">
          <h2 className="tok-reveal-title">Copy this now — it is not shown again</h2>
          <p className="tok-reveal-body">
            <strong>{revealed.token.name}</strong> is the only copy of this credential. Laika stores
            a hash, not the secret, so nobody — including an administrator — can show it to you
            again. If you lose it, revoke it and make another.
          </p>
          <div className="tok-reveal-row">
            <code className="tok-secret">{revealed.secret}</code>
            <CopyButton text={revealed.secret} className="tok-copy" />
            <button
              type="button"
              ref={doneRef}
              className="tok-dismiss"
              onClick={() => {
                returnFocus.current = true;
                forget();
              }}
            >
              Done
            </button>
          </div>
        </section>
      )}

      {minting && (
        <section
          className="tok-form"
          id={formId}
          aria-labelledby={`${formId}-title`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              closeForm();
            }
          }}
        >
          <h2 className="tok-form-title" id={`${formId}-title`}>
            New personal credential
          </h2>

          <label className="tok-field">
            <span className="tok-label">Name</span>
            <input
              ref={nameRef}
              className="tok-input"
              value={name}
              placeholder="nightly-export"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <span className="tok-hint">
              What is it for? Shown to you, your organisation’s owners and admins, and anyone who
              can read a task this credential creates.
            </span>
          </label>

          <div className="tok-field">
            <span className="tok-label">Scope</span>
            {canChoose ? (
              <div className="tok-scopes" role="radiogroup" aria-label="Scope">
                {(['full', 'read_only'] as const).map((option) => (
                  <label key={option} className="tok-scope">
                    <input
                      type="radio"
                      name={`${formId}-scope`}
                      checked={scope === option}
                      onChange={() => {
                        setScope(option);
                      }}
                    />
                    <span>{option === 'full' ? 'Full access' : 'Read only'}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="tok-forced">
                <strong>Read only.</strong> Your organisation role is viewer, so your credentials
                can read but not write. This is set by your role, not by this form.
              </p>
            )}
          </div>

          <div className="tok-field">
            <span className="tok-label" id={`${formId}-expiry-label`}>
              Expires
            </span>
            {/* The shared select-only combobox: no native <select> (LAI-726). */}
            <div className="dev-adv-expiry">
              <Dropdown
                value={expiry}
                options={EXPIRY_CHOICES.map((choice) => ({
                  value: choice.id,
                  label: choice.label,
                }))}
                onChange={setExpiry}
                aria-labelledby={`${formId}-expiry-label`}
                aria-describedby={`${formId}-expiry-hint`}
                noun="Expiry"
              />
            </div>
            <span className="tok-hint" id={`${formId}-expiry-hint`}>
              {expiry === 'never'
                ? 'It works until you revoke it. A credential that never expires is the one most often forgotten.'
                : 'After that it stops working by itself. You can revoke it sooner.'}
            </span>
          </div>

          {mintError !== undefined && (
            <p className="tok-error" role="alert">
              {mintError}
            </p>
          )}

          <div className="tok-form-actions">
            <button type="button" className="bar-control" onClick={closeForm}>
              Cancel
            </button>
            <button
              type="button"
              className="bar-control bar-control-primary"
              disabled={pending || name.trim() === ''}
              onClick={mint}
            >
              {pending && <Spinner size="sm" />}
              Create credential
            </button>
          </div>
        </section>
      )}

      <h2 className="dev-adv-list-title" ref={listTitleRef} tabIndex={-1}>
        Your personal credentials
        {tokens !== undefined && (
          <span className="dev-adv-count">
            {' '}
            · {tokens.length} {tokens.length === 1 ? 'credential' : 'credentials'}
          </span>
        )}
      </h2>

      {legacyCount !== undefined && legacyCount > 0 && (
        <p className="dev-adv-legacy-note" data-legacy-count={legacyCount}>
          <strong>
            {legacyCount === 1
              ? 'One of these is used by a coding tool.'
              : `${String(legacyCount)} of these are used by coding tools.`}
          </strong>{' '}
          That is the old way to connect one, and it keeps working. Connecting the tool on Tools
          gives it its own credential, limited to the projects you grant; then revoke the personal
          one here. Nothing is revoked for you.
        </p>
      )}

      {loadError !== null ? (
        <ApiErrorState
          error={loadError}
          resource="your credentials"
          scope="organisation"
          onRetry={() => {
            // Back to the loading rows while asking, so the press shows (LAI-1128).
            setLoadError(null);
            setTokens(undefined);
            reload();
          }}
        />
      ) : tokens === undefined ? (
        <LoadingState shape="row" count={3} label="Loading your credentials" />
      ) : tokens.length === 0 ? (
        <EmptyState
          headline="No personal credentials yet"
          body="Create one for a script or a call to the API. To connect a coding tool, use Tools."
        />
      ) : (
        <ul className="tok-list">
          {tokens.map((token) => (
            <AdvancedRow
              key={token.id}
              token={token}
              now={now}
              onRevoke={revoke}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}

      <section className="tok-ref">
        <h2 className="tok-ref-title">Scope reference</h2>
        <dl className="tok-ref-list">
          <div className="tok-ref-row">
            <dt>
              <code>full</code>
            </dt>
            <dd>
              Everything you can do. A script holding it can create, edit and move tasks and
              comment, as you.
            </dd>
          </div>
          <div className="tok-ref-row">
            <dt>
              <code>read_only</code>
            </dt>
            <dd>
              Reads anything you can see and writes nothing. A Viewer's credential is forced to this
              by the server, whatever is asked for here.
            </dd>
          </div>
        </dl>
      </section>

      <section className="tok-cli">
        <h2 className="tok-ref-title">For scripts and the API</h2>
        <pre className="tok-cli-block">
          <code>
            {`export LAIKA_URL=${window.location.origin}\nexport LAIKA_TOKEN=lai_…   # the secret shown once, above\ncurl -s -H "Authorization: Bearer $LAIKA_TOKEN" "$LAIKA_URL/api/v1/me"`}
          </code>
        </pre>
        <p className="tok-cli-note">
          The credential carries your permissions, so keep it in a secret store, not in a
          repository. Revoking it here stops it working immediately.
        </p>
      </section>
    </div>
  );
}

function AdvancedRow({
  token,
  now,
  onRevoke,
  onNavigate,
}: {
  readonly token: TokenView;
  readonly now: number;
  readonly onRevoke: (token: TokenView) => void;
  readonly onNavigate: (to: string) => void;
}) {
  const state = tokenState(token, now);
  const legacy = isLegacyToolToken(token);
  const client = asAgentClient(token.last_client);
  const tool =
    client === null ? (token.last_client_name ?? 'a coding tool') : AGENT_CLIENT_NAMES[client];
  const href = upgradeHref(token);
  return (
    <li
      className={`tok-row tok-row-${state} dev-adv-row`}
      data-token={token.id}
      data-legacy={legacy}
    >
      <div className="tok-row-main">
        <span className="tok-name">{token.name}</span>
        <span className="tok-kind">{legacy ? 'Personal (legacy)' : 'Personal'}</span>
        <code className="tok-prefix">{token.prefix}</code>
        <span className={`marker marker-${token.scope === 'full' ? 'agent' : 'ready'}`}>
          {token.scope === 'full' ? 'full' : 'read only'}
        </span>
        {state !== 'active' && <span className="tok-state">{state}</span>}
      </div>

      <div className="tok-row-meta">
        <span>{lastUsedLabel(token.last_used_at, now)}</span>
        <span>
          {token.project_ids === null
            ? 'All projects'
            : `${String(token.project_ids.length)} project${
                token.project_ids.length === 1 ? '' : 's'
              }`}
        </span>
        <span>
          {token.expires_at === null
            ? 'No expiry'
            : `Expires ${new Date(token.expires_at).toLocaleDateString()}`}
        </span>
      </div>

      {state === 'revoked' ? (
        <span className="tok-revoked-at">
          Revoked {new Date(token.revoked_at ?? 0).toLocaleDateString()}
        </span>
      ) : (
        <OverflowMenu
          label={`More actions for ${token.name}`}
          items={[
            {
              id: 'revoke',
              label: 'Revoke credential…',
              danger: true,
              onSelect: () => {
                onRevoke(token);
              },
            },
          ]}
        />
      )}

      {legacy && state === 'active' && (
        <p className="dev-adv-legacy">
          Used by {tool}. It keeps working; to give {tool} its own credential, connect it on Tools,
          then revoke this one.{' '}
          <a
            href={href}
            aria-label={`Upgrade connection for ${token.name}`}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate(href);
            }}
          >
            Upgrade connection
          </a>
        </p>
      )}
    </li>
  );
}
