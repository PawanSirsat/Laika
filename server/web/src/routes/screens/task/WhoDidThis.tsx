import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import './feed.css';

export interface WhoDidThisProps {
  /**
   * The chip's own words (LAI-1122): the agent as this reader may name it —
   * `<harness> · <device>`, or *an agent* when withheld. The chip is the
   * trigger, so the run's header reads *Ada Lovelace [Claude Code · laptop-1]*.
   */
  readonly label: string;
  /** The person the row is attributed to: the agent's owner on an agent's row. */
  readonly person: string;
  /** The agent as the reader may name it — `<harness> · <device>`, or *an agent* when withheld. */
  readonly agent: string;
  /** Withheld from this reader (§4.8 `agent_redacted`): no device, tool or model is shown. */
  readonly redacted: boolean;
  readonly device?: string | undefined;
  /** The session's own words for what ran (D-118): self-reported, a snapshot. */
  readonly tool?: string | undefined;
  readonly model?: string | undefined;
}

const EDGE = 8;

/**
 * **Who did this** (§11.4.2.1, D-129): the chain behind an agent's row —
 * person, agent and who owns it, device, tool with its version, model. A
 * disclosure like `InfoTip`: a button with `aria-expanded`, opened by a click,
 * Enter, Space or a pointer resting on it; Escape closes it, gives focus back
 * and is spent here, so the drawer under it stays open.
 *
 * Since LAI-1122 the trigger is the agent chip itself, as the design draws
 * it, rather than an ⓘ beside the name. Its accessible name starts with the
 * words it shows and says what it opens.
 */
export function WhoDidThis({
  label,
  person,
  agent,
  redacted,
  device,
  tool,
  model,
}: WhoDidThisProps) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const id = useId();
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  /** Opened by a resting pointer: the click that follows pins it rather than closing it. */
  const byHover = useRef(false);

  useLayoutEffect(() => {
    if (!open || panel.current === null) {
      setShift(0);
      return;
    }
    const box = panel.current.getBoundingClientRect();
    const over = box.right - (window.innerWidth - EDGE);
    const room = box.left - EDGE;
    setShift(over > 0 ? -Math.min(over, Math.max(room, 0)) : 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || wrap.current?.contains(event.target) !== true) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimer.current);
    },
    [],
  );

  const rows: [string, string][] = redacted
    ? [
        ['Person', person],
        ['Agent', agent],
      ]
    : [
        ['Person', person],
        ['Agent', `${agent} · owned by ${person}`],
        ...(device === undefined ? [] : ([['Device', device]] as [string, string][])),
        ['Tool', tool ?? 'Not reported'],
        ['Model', model ?? 'Not reported'],
      ];

  return (
    <span
      className="who"
      ref={wrap}
      onMouseEnter={() => {
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => {
          byHover.current = true;
          setOpen(true);
        }, 150);
      }}
      onMouseLeave={() => {
        window.clearTimeout(hoverTimer.current);
        hoverTimer.current = window.setTimeout(() => {
          if (wrap.current?.contains(document.activeElement) !== true) setOpen(false);
        }, 250);
      }}
    >
      <button
        ref={button}
        type="button"
        className="who-chip"
        aria-label={`${label} — who did this`}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        data-redacted={redacted ? 'true' : undefined}
        onClick={() => {
          /*
           * A pointer that rested ~150 ms before the click has already opened
           * it; the click then means "keep it", not "close it" — otherwise a
           * slow click on the chip opens and shuts the panel in one go.
           */
          window.clearTimeout(hoverTimer.current);
          const pin = byHover.current;
          byHover.current = false;
          setOpen((was) => (was && pin ? true : !was));
        }}
      >
        <span className="who-chip-mark" aria-hidden="true">
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none">
            <rect x="4" y="8" width="16" height="12" rx="3" stroke="currentColor" strokeWidth="3" />
            <path d="M12 4v4" stroke="currentColor" strokeWidth="3" />
          </svg>
        </span>
        {label}
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          className="who-panel"
          role="dialog"
          aria-label="Who did this"
          style={shift === 0 ? undefined : { transform: `translateX(${String(shift)}px)` }}
        >
          <span className="who-title">Who did this</span>
          <dl className="who-rows">
            {rows.map(([row, value]) => (
              <div key={row} className="who-row">
                <dt>{row}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {!redacted && (
            <p className="who-note">
              Tool, version and model are what the session said ran; they decide nothing.
            </p>
          )}
        </div>
      )}
    </span>
  );
}
