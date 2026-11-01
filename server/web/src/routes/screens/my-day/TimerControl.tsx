import { useEffect, useState } from 'react';
import type { EntryKind, TaskRef, Timer, TimerStart } from '../../../api/time.ts';
import { kindChartLabel, TIMER_KINDS } from './entry-kinds.ts';
import { HeaderPopover } from './HeaderPopover.tsx';

export interface TimerControlProps {
  readonly timer: Timer | null;
  readonly tz: string;
  /** Cards offered in one tap: the person's in-progress work, then the day's. */
  readonly chips: readonly TaskRef[];
  readonly busy: boolean;
  readonly onStart: (input: TimerStart) => void;
  readonly onPause: () => void;
  readonly onResume: () => void;
  readonly onStop: () => void;
  readonly onDiscard: () => void;
  /** The start popover, opened by the page's `T` too. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** The time run, as of `now`, in whole seconds. */
export function timerSeconds(timer: Timer, now: number): number {
  const running = timer.paused_at === null ? Math.max(0, now - timer.resumed_at) : 0;
  return Math.floor((timer.accumulated_ms + running) / 1000);
}

/** `0:42`, `1:05:09` — a running clock, never padded past what it needs. */
export function timerClock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${String(h)}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

/** What the pill calls the timer: the card's key, else the title, else the kind. */
export function timerLabel(timer: Timer): string {
  if (timer.task !== null) return timer.task.key;
  if (timer.title !== null) return timer.title;
  return timer.kind === null ? 'Timer' : kindChartLabel(timer.kind);
}

const Play = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <path d="M2.5 1.2v7.6L8.8 5z" fill="currentColor" />
  </svg>
);
const Pause = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="1.8" y="1.4" width="2.3" height="7.2" rx=".6" fill="currentColor" />
    <rect x="5.9" y="1.4" width="2.3" height="7.2" rx=".6" fill="currentColor" />
  </svg>
);
const Stop = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
    <rect x="1.6" y="1.6" width="6.8" height="6.8" rx="1.2" fill="currentColor" />
  </svg>
);

/**
 * The header's timer (D-110 item 1, LAI-502, on LAI-500's API). Idle: *Start
 * timer* opens a popover — a card, a kind and a title, all optional — and
 * Start. Running: a pill with a pulsing dot, what it is for, a live clock,
 * Pause or Resume, Stop. Paused is amber. `T` starts or stops it.
 */
export function TimerControl({
  timer,
  tz,
  chips,
  busy,
  onStart,
  onPause,
  onResume,
  onStop,
  onDiscard,
  open,
  onOpenChange,
}: TimerControlProps) {
  const [card, setCard] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<EntryKind | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // The clock ticks each second while the timer runs; paused, it stands.
  // A day read before LAI-500 shipped carries no timer at all; that is none.
  const running = timer?.paused_at === null;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(tick);
    };
  }, [running, timer?.resumed_at]);

  if (timer != null) {
    const seconds = timerSeconds(timer, now);
    const paused = timer.paused_at !== null;
    return (
      <div
        className={paused ? 'myday-timer myday-timer-paused' : 'myday-timer'}
        role="timer"
        aria-label={`Timer ${paused ? 'paused' : 'running'}, ${timerClock(seconds)}`}
        data-timer={paused ? 'paused' : 'running'}
      >
        <span className="myday-timer-dot" aria-hidden="true" />
        <span className="myday-timer-label" title={timerLabel(timer)}>
          {timerLabel(timer)}
        </span>
        <span className="myday-timer-clock" data-timer-clock>
          {timerClock(seconds)}
        </span>
        <button
          type="button"
          className="myday-timer-button"
          aria-label={paused ? 'Resume timer' : 'Pause timer'}
          title={paused ? 'Resume timer' : 'Pause timer'}
          disabled={busy}
          onClick={paused ? onResume : onPause}
        >
          {paused ? <Play /> : <Pause />}
        </button>
        <button
          type="button"
          className="myday-timer-button"
          aria-label="Stop timer and save"
          title="Stop and save (T)"
          disabled={busy}
          onClick={onStop}
        >
          <Stop />
        </button>
        <button
          type="button"
          className="myday-timer-button myday-timer-discard"
          aria-label="Discard timer"
          title="Discard — nothing is saved"
          disabled={busy}
          onClick={onDiscard}
        >
          ×
        </button>
      </div>
    );
  }

  const start = (): void => {
    const trimmed = title.trim();
    onStart({
      tz,
      ...(card === undefined ? {} : { task: card }),
      ...(kind === undefined ? {} : { kind }),
      ...(trimmed === '' ? {} : { title: trimmed }),
    });
    onOpenChange(false);
    setTitle('');
  };

  return (
    <HeaderPopover
      label="Start timer"
      title="Start a timer (T)"
      triggerClassName="myday-chip myday-head-button"
      dataAttr="data-timer-start"
      width="wide"
      disabled={busy}
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <>
          <Play />
          <span className="myday-head-text">Start timer</span>
        </>
      }
    >
      <div className="myday-pop-head">
        <span className="myday-pop-title">Start a timer</span>
        <span className="myday-quiet">Both optional</span>
      </div>
      {chips.length > 0 && (
        <div className="myday-pop-group">
          <span className="myday-pop-label">Task</span>
          <div className="myday-pop-chips">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className="myday-cardchip"
                aria-pressed={card === chip.key}
                title={chip.title}
                data-timer-card={chip.key}
                onClick={() => {
                  setCard((c) => (c === chip.key ? undefined : chip.key));
                }}
              >
                {chip.key}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="myday-pop-group">
        <span className="myday-pop-label">Kind</span>
        <div className="myday-pop-chips">
          {TIMER_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              className="myday-segment"
              aria-pressed={kind === k.kind}
              data-timer-kind={k.kind}
              onClick={() => {
                setKind((current) => (current === k.kind ? undefined : k.kind));
              }}
            >
              <span aria-hidden="true">{k.glyph}</span> {k.label}
            </button>
          ))}
        </div>
      </div>
      <input
        className="myday-pop-input"
        type="text"
        maxLength={120}
        placeholder="What are you working on?"
        aria-label="What are you working on?"
        value={title}
        data-timer-title
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            start();
          }
        }}
      />
      <div className="myday-pop-foot">
        <span className="myday-quiet">
          One timer at a time. Stopping saves it as confirmed time.
        </span>
        <button
          type="button"
          className="myday-chip myday-chip-primary"
          data-timer-go
          onClick={start}
        >
          <Play /> Start
        </button>
      </div>
    </HeaderPopover>
  );
}
