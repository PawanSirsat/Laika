import { usePermissions } from '../../api/permissions.ts';
import { permissionHolder } from '../../routes/nav-permissions.ts';
import { Dialog } from '../overlay/Dialog.tsx';
import { formatShortcut, onMac } from '../tooltip/shortcut.ts';
import { shortcutGroups } from './shortcut-sheet.ts';
import { closeShortcuts, shortcutsOpener } from './shortcuts-store.ts';

const MAC = onMac();

/** A key as its cap: `+` alone is the key, not `shortcut.ts`'s separator. */
function keycap(key: string): string {
  return key === '+' ? '+' : formatShortcut(key, MAC);
}

/**
 * The app's keyboard shortcuts (LAI-1221), opened by the header's ? button,
 * the `?` key where no screen claims it, and the palette. Loaded on first
 * open: the shell carries only the store and the button.
 *
 * The *Go to* group lists only the sidebar destinations the reader can see —
 * the same predicate the rail draws from — so it never offers a key that
 * would do nothing. The shared Dialog does the rest: focus in and back,
 * Escape, a sheet on a phone, no entrance under reduced motion.
 */
export function ShortcutsSheet() {
  const { permissions } = usePermissions(true);
  const holds = permissionHolder(permissions?.me.actions);
  const groups = shortcutGroups(holds);
  return (
    <Dialog
      title="Keyboard shortcuts"
      description="None of these fire while you are typing in a field."
      size="lg"
      onClose={closeShortcuts}
      restore={() => shortcutsOpener() ?? document.getElementById('main')}
      className="shortcuts-sheet"
      data={{ 'data-shortcuts-sheet': true }}
    >
      <div className="shortcuts-grid">
        {groups.map((group) => (
          <section key={group.name} className="shortcuts-group" aria-label={group.name}>
            <h3 className="shortcuts-group-title">{group.name}</h3>
            <dl className="shortcuts-list">
              {group.rows.map((row) => (
                <div key={`${group.name}:${row.label}`} className="shortcuts-row">
                  <dt className="shortcuts-keys">
                    {row.keys.map((key, index) => (
                      <span key={key} className="shortcuts-key-wrap">
                        {index > 0 && (
                          <span className="shortcuts-or" aria-hidden="true">
                            {row.keys.length > 2 ? '' : '/'}
                          </span>
                        )}
                        <kbd className="cmdk-kbd shortcuts-kbd">{keycap(key)}</kbd>
                      </span>
                    ))}
                  </dt>
                  <dd className="shortcuts-label">{row.label}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
