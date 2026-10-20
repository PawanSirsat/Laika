import { useState } from 'react';
import { deleteDrafts, setDraftMyTime, type TimeSettings } from '../../../api/time.ts';
import { Spinner } from '../../../components/Spinner.tsx';
import { Switch } from '../../../components/Switch.tsx';
import { MODE_NOTES } from './my-day-derive.ts';

export interface DraftMyTimeProps {
  readonly settings: TimeSettings;
  readonly pending: string | undefined;
  /** The page's own runner: one write, its control spinning, the day re-read after. */
  readonly run: (key: string, write: () => Promise<unknown>) => Promise<boolean>;
}

/**
 * *Draft my time* — the person's own switch (D-088), **at the top of the
 * column beside the day since LAI-810**, as a compact card: the switch and
 * one line. How drafting works, and deleting every draft held, are a click
 * further, under *How it works*.
 */
export function DraftMyTime({ settings, pending, run }: DraftMyTimeProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (settings.org_mode !== 'drafts') {
    return (
      <section className="myday-card myday-settings" aria-label="Draft my time">
        <p className="myday-quiet" id="myday-draft-label">
          {MODE_NOTES[settings.org_mode]}
        </p>
      </section>
    );
  }

  return (
    <section className="myday-card myday-settings" aria-labelledby="myday-draft-label">
      <div className="myday-settings-row">
        <h2 className="myday-card-title" id="myday-draft-label">
          Draft my time
        </h2>
        <Switch
          checked={settings.draft_my_time}
          labelledBy="myday-draft-label"
          describedBy="myday-draft-note"
          disabled={pending !== undefined}
          onChange={(on) => {
            void run('switch', () => setDraftMyTime(on));
          }}
        >
          {settings.draft_my_time ? 'On' : 'Off'}
        </Switch>
      </div>
      <p className="myday-quiet myday-settings-note" id="myday-draft-note">
        Counts only, on your own machine; only you see drafts. Off deletes every draft held.
      </p>
      <details className="myday-settings-more">
        <summary>How it works</summary>
        <p className="myday-quiet">
          Drafted on your own machine by the Laika collector (<code>laika activity on</code>) from
          your agent sessions, prompts and commits — counts only, never what you typed. Only you see
          drafts. Off deletes every draft held; confirmed time stays.
        </p>
        {settings.draft_my_time &&
          (confirmingDelete ? (
            <div className="myday-block-actions">
              <span className="myday-quiet">Delete every unconfirmed draft?</span>
              <button
                type="button"
                className="myday-chip myday-chip-danger"
                disabled={pending !== undefined}
                onClick={() => {
                  void run('delete-drafts', () => deleteDrafts()).then(() => {
                    setConfirmingDelete(false);
                  });
                }}
              >
                {pending === 'delete-drafts' && <Spinner size="sm" label="Deleting your drafts" />}
                Delete drafts
              </button>
              <button
                type="button"
                className="myday-chip"
                onClick={() => {
                  setConfirmingDelete(false);
                }}
              >
                Keep them
              </button>
            </div>
          ) : (
            <div className="myday-block-actions">
              <button
                type="button"
                className="myday-chip"
                onClick={() => {
                  setConfirmingDelete(true);
                }}
              >
                Delete my drafts…
              </button>
            </div>
          ))}
      </details>
    </section>
  );
}
