import { MyDayDialog } from './MyDayDialog.tsx';
import { SHORTCUT_GROUPS } from './shortcuts.ts';

/**
 * `?` — every key My day answers to, in one sheet (LAI-831, CHIEF's addition
 * H). None of them fires while typing in a field.
 */
export function ShortcutSheet({ onClose }: { readonly onClose: () => void }) {
  return (
    <MyDayDialog title="Keyboard shortcuts" label="Keyboard shortcuts" onClose={onClose}>
      {SHORTCUT_GROUPS.map((group) => (
        <section key={group.name} className="myday-keys-group" aria-label={group.name}>
          <h3 className="myday-summary-head">{group.name}</h3>
          <dl className="myday-keys-sheet">
            {group.rows.map(([key, what]) => (
              <div key={key} className="myday-keys-row">
                <dt>
                  <kbd className="myday-kbd">{key}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p className="myday-quiet">Keys never fire while you type in a field.</p>
      <div className="myday-dialog-actions">
        <button type="button" className="myday-chip" onClick={onClose}>
          Close
        </button>
      </div>
    </MyDayDialog>
  );
}
