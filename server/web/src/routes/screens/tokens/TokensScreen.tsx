import { useEffect, useState } from 'react';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { ScreenHeader } from '../../../components/ScreenHeader.tsx';
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
} from '../../../api/tokens.ts';
import type { MeProfile } from '../../../api/me.ts';
import './tokens.css';

export interface TokensScreenProps {
  readonly me: MeProfile | undefined;
}

/**
 * Personal access tokens (SPEC §4.9, LAI-410).
 *
 * The screen that makes M3 usable by a person rather than by `curl` — without a
 * token there is no way to point Claude Code at your own board.
 *
 * **Your own tokens only.** An admin reading someone else's is a different
 * endpoint and belongs on an administration screen; putting it here would make
 * a personal settings page into an admin surface.
 */
export function TokensScreen({ me }: TokensScreenProps) {
  const [tokens, setTokens] = useState<readonly TokenView[] | undefined>(undefined);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [now, setNow] = useState(() => Date.now());

  const [minting, setMinting] = useState(false);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<TokenScope>('full');
  const [mintError, setMintError] = useState<string | undefined>(undefined);
  const [pending, setPending] = useState(false);

  /**
   * The one and only copy of a freshly minted secret.
   *
   * Held in component state and nowhere else — not in `localStorage`, not on the
   * token row, not in a ref that outlives the panel. §4.9's guarantee is that it
   * cannot be recovered, and a client that stashes it durably has broken that
   * rather than worked around it. Dismissing sets this to `undefined`, which
   * unmounts the element and takes the string out of the DOM with it.
   */
  const [revealed, setRevealed] = useState<CreatedToken | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  /**
   * Put the secret beyond reach, in two steps rather than one.
   *
   * **Measured, not assumed.** Setting `revealed` straight to `undefined` takes
   * the string out of the DOM but leaves it in React's *previous* hook state:
   * walking the fibre tree after dismissal found hook 9 still holding
   * `{ token, secret }`. React double-buffers, so the value a hook held before
   * the last render stays reachable until another render replaces it.
   *
   * So the secret is overwritten **through** state first — same shape, empty
   * string — and only then cleared. After the second render neither the current
   * nor the retained tree holds it. §4.9 says the plaintext is unrecoverable;
   * leaving it addressable in memory is a weaker promise than that.
   */
  const forget = (): void => {
    setRevealed((current) =>
      current === undefined ? undefined : { token: current.token, secret: '' },
    );
    // Next tick, so the blanking render commits before the unmount render.
    setTimeout(() => {
      setRevealed(undefined);
    }, 0);
    setCopied(false);
  };

  const reload = (signal?: AbortSignal): void => {
    listTokens(signal)
      .then((page) => {
        setTokens(page.data);
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

  const canChoose = me !== undefined && mayChooseScope(me.org_role);
  // What the server will actually mint, whatever the form says.
  const effectiveScope = me === undefined ? scope : forcedTokenScope(me.org_role, scope);

  const mint = (): void => {
    setPending(true);
    setMintError(undefined);
    createToken({ name: name.trim(), scope: effectiveScope })
      .then((created) => {
        // Replacing one reveal with another overwrites the hook, so the earlier
        // secret is displaced by the same mechanism `forget` relies on.
        setRevealed(created);
        setCopied(false);
        setName('');
        setMinting(false);
        reload();
      })
      .catch((cause: unknown) => {
        setMintError(cause instanceof Error ? cause.message : 'Could not create that token.');
      })
      .finally(() => {
        setPending(false);
      });
  };

  const revoke = (token: TokenView): void => {
    if (!window.confirm(`Revoke “${token.name}”? Anything using it stops working immediately.`)) {
      return;
    }
    revokeToken(token.id)
      .then(() => {
        reload();
      })
      .catch((cause: unknown) => {
        setMintError(cause instanceof Error ? cause.message : 'Could not revoke that token.');
      });
  };

  return (
    <div className="tokens">
      <ScreenHeader
        title="Tokens"
        context={
          tokens === undefined
            ? undefined
            : `${String(tokens.length)} ${tokens.length === 1 ? 'token' : 'tokens'}`
        }
      >
        {!minting && (
          <button
            type="button"
            className="bar-control bar-control-primary"
            onClick={() => {
              setMinting(true);
            }}
          >
            + New token
          </button>
        )}
      </ScreenHeader>

      <p className="tokens-sub">
        A token lets a tool act as you — point Claude Code at this board, or call the API. It
        carries your permissions, so treat it like your password.
      </p>

      {/*
        Shown once, and only once. There is no way back to this string: it is not
        on the token row, not stored, and not re-fetchable (§4.9).
      */}
      {revealed !== undefined && (
        <section className="tok-reveal" role="alert">
          <h2 className="tok-reveal-title">Copy this now — it is not shown again</h2>
          <p className="tok-reveal-body">
            <strong>{revealed.token.name}</strong> is the only copy of this token. Laika stores a
            hash, not the secret, so nobody — including an administrator — can show it to you again.
            If you lose it, revoke the token and make another.
          </p>
          <div className="tok-reveal-row">
            <code className="tok-secret">{revealed.secret}</code>
            <button
              type="button"
              className="tok-copy"
              onClick={() => {
                void navigator.clipboard?.writeText(revealed.secret);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="tok-dismiss"
              onClick={() => {
                forget();
              }}
            >
              Done
            </button>
          </div>
        </section>
      )}

      {minting && (
        <section className="tok-form">
          <h2 className="tok-form-title">New token</h2>

          <label className="tok-field">
            <span className="tok-label">Name</span>
            <input
              className="tok-input"
              value={name}
              placeholder="mira-cli"
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <span className="tok-hint">What is it for? Only you see this.</span>
          </label>

          <div className="tok-field">
            <span className="tok-label">Scope</span>
            {canChoose ? (
              <div className="tok-scopes">
                {(['full', 'read_only'] as const).map((option) => (
                  <label key={option} className="tok-scope">
                    <input
                      type="radio"
                      name="scope"
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
              /*
                AC5. The server **forces** a viewer's token to `read_only` rather
                than refusing it, so offering the choice would not fail — it
                would mint something other than what was asked for, silently.
                A fixed value with a reason is the honest control.
              */
              <p className="tok-forced">
                <strong>Read only.</strong> Your organisation role is viewer, so your tokens can
                read but not write. This is set by your role, not by this form.
              </p>
            )}
          </div>

          {mintError !== undefined && (
            <p className="tok-error" role="alert">
              {mintError}
            </p>
          )}

          <div className="tok-form-actions">
            <button
              type="button"
              className="bar-control"
              onClick={() => {
                setMinting(false);
                setMintError(undefined);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="bar-control bar-control-primary"
              disabled={pending || name.trim() === ''}
              onClick={mint}
            >
              {pending ? 'Creating…' : 'Create token'}
            </button>
          </div>
        </section>
      )}

      {loadError !== null ? (
        <ApiErrorState error={loadError} resource="your tokens" scope="organisation" />
      ) : tokens === undefined ? (
        <LoadingState shape="row" count={3} label="Loading your tokens" />
      ) : tokens.length === 0 ? (
        <EmptyState
          headline="No tokens yet"
          body="Create one to point Claude Code or another tool at this board as you."
        />
      ) : (
        <ul className="tok-list">
          {tokens.map((token) => {
            const state = tokenState(token, now);
            return (
              <li key={token.id} className={`tok-row tok-row-${state}`}>
                <div className="tok-row-main">
                  <span className="tok-name">{token.name}</span>
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

                {/* A revoked token stays on the list — it is audit history, and
                    removing it would hide that it ever existed. */}
                {state === 'revoked' ? (
                  <span className="tok-revoked-at">
                    Revoked {new Date(token.revoked_at ?? 0).toLocaleDateString()}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="tok-revoke"
                    onClick={() => {
                      revoke(token);
                    }}
                  >
                    Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
