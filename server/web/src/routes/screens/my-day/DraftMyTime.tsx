import { useRef, useState } from 'react';
import { setDraftMyTime, type MyDay } from '../../../api/time.ts';
import { Switch } from '../../../components/Switch.tsx';
import { duration } from './format.ts';
import { MyDayDialog } from './MyDayDialog.tsx';

export interface DraftMyTimeProps {
  readonly settings: MyDay['settings'];
  /** Every pending draft held, on every day — what *off* deletes. */
  readonly held: MyDay['drafts_held'];
  readonly pending: string | undefined;
  /** The page's runner: one write, the day re-read after, its word in a toast. */
  readonly run: (key: string, write: () => Promise<unknown>, said: string) => Promise<boolean>;
}

const drafts = (n: number): string => `${String(n)} ${n === 1 ? 'draft' : 'drafts'}`;

/**
 * *Draft my time* — the person's own switch (D-088), **in the header since
 * LAI-831** as the owner's design has it. Turning it on starts drafting from
 * the collector's next sync.
 *
 * **Turning it off asks first** (CHIEF's addition F): it deletes every draft
 * held, on every day, and the question says how many and how long — from the
 * server's own count, not this day's. With none held there is nothing to lose
 * and nothing is asked.
 */
export function DraftMyTime({ settings, held, pending, run }: DraftMyTimeProps) {
  const [asking, setAsking] = useState(false);
  const toggle = useRef<HTMLDivElement | null>(null);

  if (settings.org_mode !== 'drafts') {
    return (
      <span className="myday-mode-note">
        {settings.org_mode === 'off'
          ? 'Time is off for this organisation'
          : 'Drafting is off for this organisation'}
      </span>
    );
  }

  const turnOff = (): void => {
    setAsking(false);
    void run(
      'switch',
      () => setDraftMyTime(false),
      'Draft my time is off. Every draft held was deleted; confirmed time stays.',
    );
  };

  return (
    <div className="myday-switch" ref={toggle}>
      <span className="myday-switch-label" id="myday-draft-label">
        Draft my time
      </span>
      <Switch
        checked={settings.draft_my_time}
        labelledBy="myday-draft-label"
        disabled={pending !== undefined}
        onChange={(on) => {
          if (on) {
            void run(
              'switch',
              () => setDraftMyTime(true),
              'Draft my time is on. Your collector drafts from its next sync.',
            );
          } else if (held.count > 0) {
            setAsking(true);
          } else {
            turnOff();
          }
        }}
      />
      {asking && (
        <MyDayDialog
          title="Turn off Draft my time"
          onClose={() => {
            setAsking(false);
          }}
          restore={() => toggle.current?.querySelector<HTMLElement>('[role="switch"]')}
        >
          <p className="myday-dialog-text">
            Turn off? This deletes {drafts(held.count)} you hold ({duration(held.minutes)}).
            Confirmed time stays.
          </p>
          <div className="myday-dialog-actions">
            <button type="button" className="myday-chip myday-chip-danger" onClick={turnOff}>
              Turn off
            </button>
            <button
              type="button"
              className="myday-chip"
              onClick={() => {
                setAsking(false);
              }}
            >
              Keep drafting
            </button>
          </div>
        </MyDayDialog>
      )}
    </div>
  );
}
