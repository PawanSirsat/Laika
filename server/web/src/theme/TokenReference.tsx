import { AVATAR_COLOR_COUNT, avatarColor } from './avatar-color.ts';
import {
  COLOR_TOKENS,
  ELEVATION_TOKENS,
  FAMILY_TOKENS,
  RADIUS_TOKENS,
  SPACE_TOKENS,
  TYPE_TOKENS,
  WEIGHT_TOKENS,
} from './token-list.ts';
import './token-reference.css';
import type { Theme } from './theme.ts';

/**
 * Every token, both themes, side by side.
 *
 * Side by side is the point (LAI-018): a token that exists in one theme and not
 * the other, or that was tweaked in one and not the other, is invisible when you
 * can only see one at a time. The two panels below render from the same list, so
 * a gap shows up as a swatch that does not match its neighbour.
 *
 * The dark panel works because `tokens.css` hangs the dark palette on a `.dk`
 * class rather than a media query — the same mechanism that lets the app toggle
 * without a reload also lets both themes render on one page.
 */

function Swatch({ token }: { readonly token: string }) {
  return (
    <div className="tr-swatch">
      <div className="tr-swatch-chip" style={{ background: `var(${token})` }} />
      <code className="tr-swatch-name">{token}</code>
    </div>
  );
}

function AvatarRing({ theme }: { readonly theme: Theme }) {
  // Ids chosen only to land on distinct hues; the mapping is the function's,
  // not a per-person table (SPEC §4.1).
  const ids = Array.from({ length: AVATAR_COLOR_COUNT }, (_, i) => `user-${String(i)}`);

  return (
    <div className="tr-avatars">
      {ids.map((id) => {
        const c = avatarColor(id, theme);
        return (
          <div
            key={id}
            className="tr-avatar"
            style={{ background: c.background, color: c.foreground, borderColor: c.border }}
            title={id}
          >
            {id.slice(-1)}
          </div>
        );
      })}
    </div>
  );
}

function ThemePanel({ theme }: { readonly theme: Theme }) {
  return (
    <section className={theme === 'dark' ? 'dk tr-panel' : 'tr-panel'}>
      <header className="tr-panel-head">
        <h2 className="tr-panel-title">{theme === 'dark' ? 'Dark' : 'Light'}</h2>
        <p className="tr-panel-sub">
          {theme === 'dark' ? '.dk' : ':root'} — values verbatim from docs/design/
        </p>
      </header>

      {COLOR_TOKENS.map((group) => (
        <div key={group.title} className="tr-group">
          <h3 className="tr-group-title">{group.title}</h3>
          <p className="tr-group-note">{group.note}</p>
          <div className="tr-swatches">
            {group.tokens.map((token) => (
              <Swatch key={token} token={token} />
            ))}
          </div>
        </div>
      ))}

      <div className="tr-group">
        <h3 className="tr-group-title">Elevation</h3>
        <p className="tr-group-note">Card shadow — differs per theme.</p>
        <div className="tr-swatches">
          {ELEVATION_TOKENS.map((token) => (
            <div key={token} className="tr-swatch">
              <div className="tr-swatch-chip tr-elevated" style={{ boxShadow: `var(${token})` }} />
              <code className="tr-swatch-name">{token}</code>
            </div>
          ))}
        </div>
      </div>

      <div className="tr-group">
        <h3 className="tr-group-title">Text on surfaces</h3>
        <p className="tr-group-note">Each text tone on each surface, for eyeballing contrast.</p>
        {(['--page', '--tub', '--card'] as const).map((bg) => (
          <div key={bg} className="tr-textrow" style={{ background: `var(${bg})` }}>
            {(['--tx', '--tx2', '--tx3'] as const).map((fg) => (
              <span key={fg} style={{ color: `var(${fg})` }}>
                {fg} on {bg}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="tr-group">
        <h3 className="tr-group-title">Avatars</h3>
        <p className="tr-group-note">Derived from user id — no per-person map (SPEC §4.1).</p>
        <AvatarRing theme={theme} />
      </div>
    </section>
  );
}

export function TokenReference() {
  return (
    <div className="tr">
      <div className="tr-themes">
        <ThemePanel theme="light" />
        <ThemePanel theme="dark" />
      </div>

      <section className="tr-shared">
        <h2 className="tr-panel-title">Theme-independent</h2>

        <h3 className="tr-group-title">Type scale</h3>
        <div className="tr-type">
          {TYPE_TOKENS.map((token) => (
            <p key={token} style={{ fontSize: `var(${token})` }}>
              <code>{token}</code> — Ready tasks, sorted p1 to p3
            </p>
          ))}
        </div>

        <h3 className="tr-group-title">Weights — Plus Jakarta Sans 400–800</h3>
        <div className="tr-type">
          {WEIGHT_TOKENS.map((token) => (
            <p key={token} style={{ fontWeight: `var(${token})` }}>
              <code>{token}</code> — Ready tasks, sorted p1 to p3
            </p>
          ))}
        </div>

        <h3 className="tr-group-title">Families</h3>
        <div className="tr-type">
          {FAMILY_TOKENS.map((token) => (
            <p key={token} style={{ fontFamily: `var(${token})` }}>
              <code>{token}</code> — LAI-42 · laika.example.com · 13/34 · 2026-08-24
            </p>
          ))}
        </div>

        <h3 className="tr-group-title">Spacing</h3>
        <div className="tr-scale">
          {SPACE_TOKENS.map((token) => (
            <div key={token} className="tr-scale-row">
              <code>{token}</code>
              <span className="tr-scale-bar" style={{ width: `var(${token})` }} />
            </div>
          ))}
        </div>

        <h3 className="tr-group-title">Radii</h3>
        <div className="tr-radii">
          {RADIUS_TOKENS.map((token) => (
            <div key={token} className="tr-radius">
              <div className="tr-radius-box" style={{ borderRadius: `var(${token})` }} />
              <code>{token}</code>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
