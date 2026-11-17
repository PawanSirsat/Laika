import { useRef, useState } from 'react';
import { setDraftMyTime, type MyDay } from '../../../api/time.ts';
import { Switch } from '../../../components/Switch.tsx';
import { useAction } from '../../../components/toast/use-action.ts';
import { duration } from './format.ts';
import { MyDayDialog } from './MyDayDialog.tsx';

export interface DraftMyTimeProps {
  readonly settings: MyDay['settings'];
  /** Every pending draft held, on every day — what *off* deletes. */
  readonly held: MyDay['drafts_held'];
  readonly pending: string | undefined;
  /**
   * The page's runner: keys the write so only this control waits, and
   * re-reads the day after. The words are this control's own, said through
   * `useAction` inside the write (LAI-1310).
   */
  readonly run: (key: string, write: () => Promise<unknown>) => Promise<boolean>;
  /** Inside *Day settings* (LAI-502): the switch alone, its words drawn by the row. */
  readonly compact?: boolean | undefined;
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
export function DraftMyTime({ settings, held, pending, run, compact = false }: DraftMyTimeProps) {
  const [asking, setAsking] = useState(false);
  const { run: act } = useAction();
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
    void run('switch', () =>
      act({
        do: () => setDraftMyTime(false),
        success: 'Draft my time is off. Every draft held was deleted; confirmed time stays.',
        failure: 'Couldn’t turn off Draft my time',
      }),
    );
  };

  return (
    <div className={compact ? 'myday-switch-bare' : 'myday-switch'} ref={toggle}>
      <span
        className={compact ? 'myday-visually-hidden' : 'myday-switch-label'}
        id="myday-draft-label"
      >
        Draft my time
      </span>
      <Switch
        checked={settings.draft_my_time}
        labelledBy="myday-draft-label"
        disabled={pending !== undefined}
        onChange={(on) => {
          if (on) {
            void run('switch', () =>
              act({
                do: () => setDraftMyTime(true),
                success: 'Draft my time is on. Your collector drafts from its next sync.',
                failure: 'Couldn’t turn on Draft my time',
              }),
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
