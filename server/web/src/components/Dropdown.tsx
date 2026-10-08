import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import {
  SEARCH_THRESHOLD,
  filterOptions,
  highlight,
  move,
  noMatches,
  outOfView,
  placeWithin,
  typeahead,
  type Area,
  type Move,
} from './dropdown-model.ts';
import './dropdown.css';

export interface DropdownOption<V extends string = string> {
  readonly value: V;
  /** Plain words: what is shown, searched, typed ahead to and announced. */
  readonly label: string;
  /** Drawn before the label — a dot, an icon, an avatar. Decorative. */
  readonly icon?: ReactNode;
  /** Matched by search beside the label but not shown in it. */
  readonly keywords?: string | undefined;
  /** Muted text after the label — a sprint's dates, a role's summary. */
  readonly detail?: string | undefined;
  /** A small marker after the label — "Active". */
  readonly badge?: string | undefined;
  /** A class for the label's own box, so a label can be drawn as a chip. */
  readonly labelClass?: string | undefined;
  /** Drawn first, set apart, and kept through a search: "Any", "Anyone". */
  readonly pinned?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** The tooltip, when the label alone does not say enough. Defaults to the label. */
  readonly title?: string | undefined;
}

export interface DropdownProps<V extends string = string> {
  readonly value: V;
  readonly options: readonly DropdownOption<V>[];
  readonly onChange: (value: V) => void;
  /** The trigger's id — so a `<label htmlFor>` names and opens it. */
  readonly id?: string | undefined;
  readonly 'aria-label'?: string | undefined;
  readonly 'aria-labelledby'?: string | undefined;
  readonly 'aria-describedby'?: string | undefined;
  readonly 'aria-invalid'?: boolean | undefined;
  /**
   * What the search box is for, as a noun: "labels" gives "Search labels".
   * Defaults to "options".
   */
  readonly noun?: string | undefined;
  /** Force the search box on or off; by default it appears past eight options. */
  readonly searchable?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Extra classes for the trigger, for a screen whose control is styled its own way. */
  readonly className?: string | undefined;
  /**
   * `field` (the default) draws the trigger as a form field. `bare` draws
   * nothing but the value and the chevron, for a screen whose own class gives
   * the control its look — a pill, a value in a rail, a picker laid over an
   * avatar — the way it styled the `<select>` this replaced.
   */
  readonly variant?: 'field' | 'bare' | undefined;
  /** False for a control that shows no chevron — one laid invisibly over something else. */
  readonly chevron?: boolean | undefined;
  /** What the trigger shows, when it is not the selected option's icon and label. */
  readonly display?: ReactNode;
  /** Shown when the value matches no option. */
  readonly placeholder?: string | undefined;
  readonly title?: string | undefined;
  /** Submitted with a form under this name, as a `<select name>` was. */
  readonly name?: string | undefined;
  readonly triggerRef?: Ref<HTMLButtonElement> | undefined;
}

/** About 18rem, the owner's brief. */
const CAP_REM = 18;
const GAP = 4;
const MARGIN = 8;
const FLOOR = 160;
const TYPEAHEAD_MS = 600;

const remPx = (): number => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

/** What is on screen: the visual viewport where there is one (LAI-726 round 1). */
const visibleArea = (): Area => {
  const vv = window.visualViewport;
  return vv === null
    ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
    : { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
};

/**
 * A touch screen: focusing a text box raises the on-screen keyboard over the
 * list the reader opened to look at, so the search box waits to be tapped.
 */
const coarsePointer = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;

const setRef = <T,>(ref: Ref<T> | undefined, value: T | null): void => {
  if (typeof ref === 'function') ref(value);
  else if (ref !== null && ref !== undefined) ref.current = value;
};

/**
 * A select drawn by the app, not the OS (LAI-726).
 *
 * ## Why not the native `<select>`
 *
 * The owner's screenshot: the Filter popover's Label select opened the OS's
 * grey menu, about 35 entries tall, past the popover and off the screen, and
 * jumped to the top of the window when the chosen label was further down. A
 * native option list cannot be sized, searched, themed or given an avatar,
 * so the field is drawn here — and once drawn here, every select in the app
 * uses it, so there is one look and one keyboard model.
 *
 * ## The pattern
 *
 * WAI-ARIA's **select-only combobox**: the trigger is `role="combobox"` and
 * keeps focus; the panel is a `role="listbox"` of `role="option"`s, and the
 * one being pointed at is named by `aria-activedescendant`, so a screen
 * reader follows it without focus moving. A list long enough to search moves
 * focus into its search box, which then carries `aria-activedescendant`
 * itself — the one element with focus is the one that names the active
 * option.
 *
 * The trigger is a `<button>` with the combobox role, not a `<div>`: a button
 * is labelable, so every `<label>` that wrapped or pointed at a `<select>`
 * still names this, and it can be disabled.
 *
 * ## Why the panel is portalled
 *
 * It is drawn into `<body>` with fixed positioning. The Filter popover scrolls
 * and is slid sideways with `translate`; either would clip a panel drawn
 * inside it or re-anchor its fixed position. The cost is that the panel is
 * outside every container's DOM, so an outside-click handler has to be told
 * about it: the panel carries `data-dropdown-panel`, and `isInDropdownPanel`
 * (`dropdown-model.ts`) is the test such a handler uses.
 *
 * ## Escape closes only this
 *
 * Escape closes the panel and is then **stopped**, so a popover or dialog
 * around it stays open; a second Escape, with the panel closed, is not
 * handled here and reaches them.
 */
export function Dropdown<V extends string = string>({
  value,
  options,
  onChange,
  id,
  'aria-label': ariaLabel,
  'aria-labelledby': labelledBy,
  'aria-describedby': describedBy,
  'aria-invalid': invalid,
  noun = 'options',
  searchable,
  disabled = false,
  className,
  variant = 'field',
  chevron = true,
  display,
  placeholder = 'Select…',
  title,
  name,
  triggerRef,
}: DropdownProps<V>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<V | undefined>(undefined);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const typed = useRef({ buffer: '', at: 0 });
  /** Set once the panel opens, so the selected option is scrolled to only then. */
  const reveal = useRef(false);
  /**
   * A press on the trigger is under way (LAI-726 round 1). Safari does not
   * focus a button on mousedown, so pressing the trigger of an open,
   * searchable dropdown blurs the search box with no `relatedTarget` before
   * the click — and a blur that closed the panel let that click reopen it.
   * The search box's blur ignores itself while this is set; the click closes.
   */
  const pressing = useRef(false);
  const listId = useId();
  const optionId = (index: number): string => `${listId}-o${String(index)}`;

  const withSearch = searchable ?? options.length > SEARCH_THRESHOLD;

  // Pinned first, the rest in their own order.
  const ordered = useMemo(
    () => [
      ...options.filter((o) => o.pinned === true),
      ...options.filter((o) => o.pinned !== true),
    ],
    [options],
  );
  const shown = useMemo(
    () => (withSearch ? filterOptions(ordered, query) : ordered),
    [ordered, query, withSearch],
  );
  // Each option's place in `options`, for its id — once, not a search per row.
  const indexOf = useMemo(() => new Map(options.map((o, i) => [o.value, i])), [options]);
  const empty = withSearch && noMatches(shown, query);
  const selected = options.find((o) => o.value === value);
  const activeIndex = shown.findIndex((o) => o.value === active);
  const activeId =
    open && activeIndex !== -1
      ? optionId(indexOf.get(shown[activeIndex]!.value) ?? activeIndex)
      : undefined;

  const show = useCallback(
    (start: 'selected' | 'first' | 'last' = 'selected') => {
      if (disabled) return;
      setQuery('');
      reveal.current = true;
      const pool = ordered.filter((o) => o.disabled !== true);
      const pick =
        start === 'first'
          ? pool[0]
          : start === 'last'
            ? pool[pool.length - 1]
            : (ordered.find((o) => o.value === value && o.disabled !== true) ?? pool[0]);
      setActive(pick?.value);
      setOpen(true);
    },
    [disabled, ordered, value],
  );

  /** Closed, and — unless the reader went somewhere else — focus back on the trigger. */
  const hide = useCallback((refocus: boolean) => {
    setOpen(false);
    setQuery('');
    // A new session types from scratch (LAI-726 round 1).
    typed.current = { buffer: '', at: 0 };
    if (refocus) trigger.current?.focus();
  }, []);

  const choose = (option: DropdownOption<V> | undefined): void => {
    if (option === undefined || option.disabled === true) return;
    hide(true);
    if (option.value !== value) onChange(option.value);
  };

  // Focus into the search box on open, where there is one — not on a touch
  // screen, where it would raise the keyboard over the list (round 1).
  useEffect(() => {
    if (open && withSearch && !coarsePointer()) search.current?.focus({ preventScroll: true });
  }, [open, withSearch]);

  /*
   * **Placed before it is painted**, against what is on screen, and again
   * when the window resizes or the list changes height as a search narrows
   * it. A trigger that has left the screen takes the panel with it.
   */
  useLayoutEffect(() => {
    if (!open) return;
    /** Where the trigger was when the panel was last placed against it. */
    let anchor: { top: number; left: number } | undefined;
    const placePanel = (): void => {
      const t = trigger.current;
      const p = panel.current;
      const l = list.current;
      if (t === null || p === null || l === null) return;
      const area = visibleArea();
      const box = t.getBoundingClientRect();
      if (outOfView(box, area)) {
        hide(false);
        return;
      }
      anchor = { top: box.top, left: box.left };
      const natural = p.offsetHeight - l.clientHeight + l.scrollHeight;
      const at = placeWithin(box, natural, area, window.innerHeight, {
        gap: GAP,
        margin: MARGIN,
        cap: CAP_REM * remPx(),
        floor: FLOOR,
      });
      p.dataset.side = at.side;
      p.style.top = at.top === undefined ? '' : `${String(at.top)}px`;
      p.style.bottom = at.bottom === undefined ? '' : `${String(at.bottom)}px`;
      p.style.left = `${String(at.left)}px`;
      p.style.minWidth = `${String(at.minWidth)}px`;
      p.style.maxWidth = `${String(at.maxWidth)}px`;
      p.style.maxHeight = `${String(at.maxHeight)}px`;
      /*
       * **Measured, then corrected.** Inside a modal the panel's fixed box is
       * placed by whatever contains it; if an ancestor ever becomes its
       * containing block (a transform, a filter) the values above land
       * offset by that ancestor's position. Reading back where it actually
       * went and moving it by the difference keeps it on its trigger anyway.
       */
      const drawn = p.getBoundingClientRect();
      const dx = drawn.left - at.left;
      if (Math.abs(dx) > 0.5) p.style.left = `${String(at.left - dx)}px`;
      if (at.top !== undefined) {
        const dy = drawn.top - at.top;
        if (Math.abs(dy) > 0.5) p.style.top = `${String(at.top - dy)}px`;
      } else if (at.bottom !== undefined) {
        const dy = drawn.bottom - (window.innerHeight - at.bottom);
        if (Math.abs(dy) > 0.5) p.style.bottom = `${String(at.bottom + dy)}px`;
      }
    };
    placePanel();
    /*
     * **A scroll under the panel closes it**, as it closes a native select
     * (LAI-726 round 1). Re-placing on every scroll followed the trigger off
     * the screen — the review measured top: −234px in the task drawer.
     *
     * Two scrolls are not "under it": the list's own, and one that did not
     * move the trigger. The second matters because a scroll *event* arrives a
     * frame after its scroll — focusing or clicking a control scrolls it into
     * view first, and that event would otherwise close the panel the same
     * click just opened.
     */
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      const box = trigger.current?.getBoundingClientRect();
      if (
        box !== undefined &&
        anchor !== undefined &&
        Math.abs(box.top - anchor.top) < 1 &&
        Math.abs(box.left - anchor.left) < 1
      ) {
        return;
      }
      const inPanel =
        document.activeElement !== null && panel.current?.contains(document.activeElement);
      hide(false);
      // Focus was in the search box, which is going: back to the trigger,
      // without scrolling the page that is already moving.
      if (inPanel === true) trigger.current?.focus({ preventScroll: true });
    };
    const vv = window.visualViewport;
    window.addEventListener('resize', placePanel);
    vv?.addEventListener('resize', placePanel);
    vv?.addEventListener('scroll', placePanel);
    window.addEventListener('scroll', onScroll, true);
    /*
     * An ancestor that finishes animating — the drawer's rise ends its
     * transform — stops being the panel's containing block, and the
     * correction made while it was one no longer holds: place again.
     */
    window.addEventListener('animationend', placePanel, true);
    return () => {
      window.removeEventListener('animationend', placePanel, true);
      window.removeEventListener('resize', placePanel);
      vv?.removeEventListener('resize', placePanel);
      vv?.removeEventListener('scroll', placePanel);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, shown.length, hide]);

  /*
   * **The active option is kept in view**, and on open the selected one is
   * brought to the middle — the native list's habit of opening at the top
   * with the chosen entry thirty rows down is the bug this replaces.
   */
  useLayoutEffect(() => {
    if (!open || activeIndex === -1) return;
    const l = list.current;
    const el = l?.querySelector<HTMLElement>(`[data-index="${String(activeIndex)}"]`);
    if (l === null || l === undefined || el === null || el === undefined) return;
    if (reveal.current) {
      reveal.current = false;
      l.scrollTop = el.offsetTop - (l.clientHeight - el.offsetHeight) / 2;
      return;
    }
    if (el.offsetTop < l.scrollTop) l.scrollTop = el.offsetTop;
    else if (el.offsetTop + el.offsetHeight > l.scrollTop + l.clientHeight)
      l.scrollTop = el.offsetTop + el.offsetHeight - l.clientHeight;
  }, [open, activeIndex]);

  /*
   * **A press is over when the pointer lifts, wherever it lifts** (round 2).
   * Pressed on the trigger and dragged off, it never becomes the click that
   * would clear `pressing`, and the search box's next blur — focus going
   * anywhere — would be ignored and leave the panel open.
   */
  useEffect(() => {
    if (!open) return;
    const release = (): void => {
      pressing.current = false;
    };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    return () => {
      document.removeEventListener('pointerup', release, true);
      document.removeEventListener('pointercancel', release, true);
    };
  }, [open]);

  // A click anywhere but the trigger and the panel closes it, focus untouched.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target === null) return;
      if (trigger.current?.contains(target) === true) return;
      if (panel.current?.contains(target) === true) return;
      hide(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, hide]);

  const step = (how: Move): void => {
    const next = move(shown, activeIndex, how);
    if (next !== -1) setActive(shown[next]!.value);
  };

  /** `from` is where the search starts: the active option, or on a closed trigger the selected one. */
  const ahead = (key: string, from = activeIndex): void => {
    const now = Date.now();
    const t = typed.current;
    t.buffer = now - t.at > TYPEAHEAD_MS ? key : t.buffer + key;
    t.at = now;
    const hit = typeahead(shown, from, t.buffer);
    if (hit !== -1) setActive(shown[hit]!.value);
  };

  /** Keys handled here are stopped, so nothing around the control also acts on them. */
  const handled = (event: KeyboardEvent): void => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onKey = (event: KeyboardEvent<HTMLElement>): void => {
    const inSearch = event.currentTarget === search.current;
    const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;

    if (!open) {
      if (event.currentTarget !== trigger.current) return;
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        handled(event);
        show();
      } else if (event.key === 'Home' || event.key === 'End') {
        handled(event);
        show(event.key === 'Home' ? 'first' : 'last');
      } else if (printable && !withSearch) {
        handled(event);
        show();
        // From the value, not from wherever a past session left the active
        // option — `activeIndex` here is still that session's (round 1).
        ahead(
          event.key,
          shown.findIndex((o) => o.value === value),
        );
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        handled(event);
        step(event.altKey ? 'last' : 'next');
        return;
      case 'ArrowUp':
        handled(event);
        if (event.altKey) {
          choose(shown[activeIndex]);
          return;
        }
        step('previous');
        return;
      case 'Home':
        if (inSearch) return; // Moves the caret, as in any text box.
        handled(event);
        step('first');
        return;
      case 'End':
        if (inSearch) return;
        handled(event);
        step('last');
        return;
      case 'PageDown':
        handled(event);
        step('page-down');
        return;
      case 'PageUp':
        handled(event);
        step('page-up');
        return;
      case 'Enter':
        handled(event);
        choose(shown[activeIndex]);
        return;
      case 'Escape':
        handled(event);
        hide(true);
        return;
      case 'Tab':
        /*
         * **Tab chooses nothing and closes.** Focus goes back to the trigger
         * first and the Tab is *not* prevented, so the browser carries on from
         * the trigger to whatever follows it — rather than from the search
         * box, which lives at the end of `<body>`.
         */
        setOpen(false);
        setQuery('');
        typed.current = { buffer: '', at: 0 };
        if (inSearch) trigger.current?.focus();
        return;
      case ' ':
        if (inSearch) return; // A space is part of a search.
        handled(event);
        choose(shown[activeIndex]);
        return;
      default:
        if (printable && !inSearch) {
          handled(event);
          ahead(event.key);
        }
    }
  };

  const panelNode = open && (
    <div
      ref={panel}
      className="dd-panel"
      data-dropdown-panel=""
      // Keeps focus where it is — the trigger or the search box — on any click
      // inside, so a click on an option is not first a blur.
      onMouseDown={(event) => {
        if (event.target !== search.current) event.preventDefault();
      }}
      // React bubbles a portal's events through the tree it was rendered in.
      // A card or a row around the trigger must not take an option's click.
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      {withSearch && (
        <div className="dd-search">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          {/*
            **A combobox of its own** (LAI-726 round 1): while it has focus it
            is the control driving the listbox — the APG's editable combobox
            with list autocomplete — so it says it is expanded and which list
            it controls, and names the active option.
          */}
          <input
            ref={search}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            className="dd-search-input"
            placeholder={`Search ${noun}`}
            aria-label={`Search ${noun}`}
            aria-controls={listId}
            aria-activedescendant={activeId}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              // The first real match, not "Any", is what Enter should take.
              const hits = filterOptions(ordered, next);
              const first =
                next.trim() === ''
                  ? hits.find((o) => o.value === value)
                  : hits.find((o) => o.pinned !== true && o.disabled !== true);
              setActive((first ?? hits[0])?.value);
            }}
            onKeyDown={onKey}
            onBlur={(event) => {
              const to = event.relatedTarget as Node | null;
              // The trigger is being pressed: its click decides (see `pressing`).
              if (pressing.current) {
                pressing.current = false;
                return;
              }
              if (to !== null && (panel.current?.contains(to) || trigger.current === to)) return;
              setOpen(false);
              setQuery('');
              typed.current = { buffer: '', at: 0 };
            }}
          />
        </div>
      )}
      <div ref={list} id={listId} className="dd-list" role="listbox" aria-label={noun}>
        {shown.map((option, index) => {
          const isSelected = option.value === value;
          const isActive = index === activeIndex;
          const lastPinned =
            option.pinned === true &&
            shown[index + 1] !== undefined &&
            shown[index + 1]!.pinned !== true;
          return (
            <div
              key={option.value}
              id={optionId(indexOf.get(option.value) ?? index)}
              data-index={index}
              data-value={option.value}
              role="option"
              aria-selected={isSelected}
              aria-disabled={option.disabled === true ? true : undefined}
              title={option.title ?? option.label}
              className={[
                'dd-option',
                isActive ? 'dd-option-active' : '',
                isSelected ? 'dd-option-selected' : '',
                option.pinned === true ? 'dd-option-pinned' : '',
                lastPinned ? 'dd-option-pinned-last' : '',
              ]
                .filter((c) => c !== '')
                .join(' ')}
              onMouseMove={() => {
                if (!isActive && option.disabled !== true) setActive(option.value);
              }}
              onClick={() => {
                choose(option);
              }}
            >
              <span className="dd-check" aria-hidden="true">
                {isSelected && (
                  <svg viewBox="0 0 24 24" fill="none" strokeWidth="2.6">
                    <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {option.icon !== undefined && (
                <span className="dd-icon" aria-hidden="true">
                  {option.icon}
                </span>
              )}
              <span className={option.labelClass ? `dd-label ${option.labelClass}` : 'dd-label'}>
                {highlight(option.label, withSearch ? query : '').map((run, i) =>
                  run.match ? (
                    <mark key={i} className="dd-match">
                      {run.text}
                    </mark>
                  ) : (
                    run.text
                  ),
                )}
              </span>
              {option.badge !== undefined && <span className="dd-badge">{option.badge}</span>}
              {option.detail !== undefined && <span className="dd-detail">{option.detail}</span>}
            </div>
          );
        })}
      </div>
      {empty && (
        <p className="dd-empty" role="status">
          No matches
        </p>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={(el) => {
          trigger.current = el;
          setRef(triggerRef, el);
        }}
        id={id}
        type="button"
        role="combobox"
        className={['dd-trigger', variant === 'field' ? 'dd-field' : '', className ?? '']
          .filter((c) => c !== '')
          .join(' ')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !withSearch ? activeId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-invalid={invalid === true ? true : undefined}
        title={title ?? selected?.label}
        disabled={disabled}
        data-value={value}
        onPointerDown={() => {
          pressing.current = open;
        }}
        onMouseDown={() => {
          pressing.current = open;
        }}
        onClick={() => {
          pressing.current = false;
          if (open) hide(true);
          else show();
        }}
        onKeyDown={onKey}
        // Space's click lands on key-up; it was handled on key-down.
        onKeyUp={(event) => {
          if (event.key === ' ') event.preventDefault();
        }}
        onBlur={(event) => {
          if (!open || withSearch) return;
          const to = event.relatedTarget as Node | null;
          if (to !== null && panel.current?.contains(to) === true) return;
          setOpen(false);
        }}
      >
        {display ?? (
          <>
            {selected?.icon !== undefined && (
              <span className="dd-icon" aria-hidden="true">
                {selected.icon}
              </span>
            )}
            <span className={selected === undefined ? 'dd-value dd-placeholder' : 'dd-value'}>
              {selected?.label ?? placeholder}
            </span>
          </>
        )}
        {chevron && (
          <svg
            className="dd-chevron"
            viewBox="0 0 24 24"
            fill="none"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      {/*
        **Into the modal it belongs to** (LAI-726 round 1). `aria-modal="true"`
        tells a screen reader to ignore everything outside the dialog, so a
        panel portalled to `<body>` from inside one is there for the eye and
        gone for the ear. Outside any modal, `<body>`.
      */}
      {panelNode !== false &&
        createPortal(
          panelNode,
          trigger.current?.closest<HTMLElement>('[aria-modal="true"]') ?? document.body,
        )}
    </>
  );
}
