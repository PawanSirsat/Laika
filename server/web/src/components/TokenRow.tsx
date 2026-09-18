import { lastUsedLabel, tokenState, type TokenView } from '../api/tokens.ts';
import './token-row.css';

export interface TokenRowProps {
  readonly token: TokenView;
  readonly now: number;
  /**
   * Revoke this token. **Absent means the viewer may not**, and the button is
   * then not rendered at all — the same rule the Organisation screen's role
   * controls follow, for the same reason.
   */
  readonly onRevoke?: ((token: TokenView) => void) | undefined;
}

/**
 * One personal access token (§4.9), rendered the same way everywhere (LAI-238).
 *
 * Lifted out of `TokensScreen` when the Organisation screen gained an admin view
 * of somebody else's tokens. **Two copies of a row that says what a credential
 * can do is how one of them quietly stops matching the other** — and this is the
 * row where "quietly wrong" means somebody believes a token is revoked.
 *
 * ## What it will not render
 *
 * **There is no token value here and there cannot be one.** §4.9 stores a hash;
 * the plaintext exists only on `CreatedToken.secret`, once, and `TokenView` has
 * no field carrying it. The `prefix` is `lai_` plus four characters — enough to
 * tell a handful of tokens apart, and not a lookup key.
 *
 * That property is worth stating on the component rather than on each caller,
 * because the admin view is where the temptation would arrive: *"an admin should
 * be able to see it"* is a sentence that sounds reasonable and is unsatisfiable.
 */
export function TokenRow({ token, now, onRevoke }: TokenRowProps) {
  const state = tokenState(token, now);

  return (
    <li className={`tok-row tok-row-${state}`}>
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

      {/* A revoked token stays on the list — it is audit history, and removing
          it would hide that it ever existed. */}
      {state === 'revoked' ? (
        <span className="tok-revoked-at">
          Revoked {new Date(token.revoked_at ?? 0).toLocaleDateString()}
        </span>
      ) : (
        onRevoke !== undefined && (
          <button
            type="button"
            className="tok-revoke"
            onClick={() => {
              onRevoke(token);
            }}
          >
            Revoke
          </button>
        )
      )}
    </li>
  );
}
