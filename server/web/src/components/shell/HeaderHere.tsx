import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { PresencePerson } from '../../api/presence.ts';
import { usePresencePeople } from '../../api/use-presence-people.ts';
import { atOrBelow } from '../../theme/breakpoints.ts';
import { prefersReducedMotion } from '../../theme/motion.ts';
import { useTheme } from '../../theme/use-theme.ts';
import { Avatar } from '../avatar/Avatar.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useDismiss } from '../use-dismiss.ts';
import { LiveRegion } from '../wizard/LiveRegion.tsx';
import { useLiveRegion } from '../wizard/live-region.ts';
import {
  diffHere,
  hereAnnouncement,
  hereFaces,
  hereLabel,
  HERE_MAX,
  HERE_MAX_NARROW,
} from './here-derive.ts';
import { useShell } from './shell-context.ts';

/** The list, and what it reads, load on first open (the bundle budget, LAI-1219). */
const HerePopover = lazy(async () => {
  const module = await import('./HerePopover.tsx');
  return { default: module.HerePopover };
});

/** A leaving face is gone by now whatever its animation did (it may never end). */
const LEAVE_BACKSTOP_MS = 1_000;

const NARROW_QUERY = atOrBelow('desktop');

/** Whether a media query matches, kept live (as `AppShell`'s and My day's). */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = (): void => {
      setMatches(list.matches);
    };
    onChange();
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  }, [query]);
  return matches;
}

/**
 * **Who's here** (LAI-1348): the people online or away now, as overlapping
 * faces ringed by their status — green online, amber away — with a `+N` for
 * the rest, between + Create and the bell on every page. It opens a list of
 * who is online and who is away.
 *
 * Read from `GET /presence/people`, every 30 s while the tab is visible:
 * Capacity's status, cheap and written nowhere (SPEC §9.3). **Nothing is
 * drawn before the first answer, nor while presence is off** — an empty
 * stack would claim nobody is here when the truth is *not told*.
 *
 * Only what changes while it is on screen moves: a face arriving pops in with
 * a ring ripple in its status colour, one leaving shrinks away, and a change
 * of status fades the ring's colour. All on the motion tokens, so reduced
 * motion stills every one; the change is also said politely, for a screen
 * reader.
 */
export function HeaderHere() {
  const {
    me,
    route: { navigate },
  } = useShell();
  const { theme } = useTheme();
  // The page's one read of who is here (LAI-1349): the board's faces and the
  // person pickers ring theirs from the same answer.
  const polled = usePresencePeople();
  const narrow = useMedia(NARROW_QUERY);
  const max = narrow ? HERE_MAX_NARROW : HERE_MAX;

  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };
  const box = useDismiss<HTMLDivElement>(open, (reason) => {
    close(reason === 'escape');
  });

  const [message, announce] = useLiveRegion();
  const before = useRef<readonly PresencePerson[] | undefined>(undefined);
  const [arriving, setArriving] = useState<ReadonlySet<string>>(new Set());
  const [leaving, setLeaving] = useState<readonly PresencePerson[]>([]);

  const people = polled.data?.enabled === true ? polled.data.people : undefined;

  useEffect(() => {
    if (people === undefined) return;
    const shownBefore = new Set(
      before.current === undefined
        ? []
        : hereFaces(before.current, max).shown.map((p) => p.user_id),
    );
    const diff = diffHere(before.current, people);
    before.current = people;
    setArriving(new Set(diff.arrived.map((p) => p.user_id)));
    const said = hereAnnouncement(diff);
    if (said !== '') announce(said);
    // Only a face that was drawn can leave; one inside the +N just goes.
    const gone = diff.left.filter((p) => shownBefore.has(p.user_id));
    if (gone.length === 0 || prefersReducedMotion()) return;
    setLeaving(gone);
    const timer = window.setTimeout(() => {
      setLeaving([]);
    }, LEAVE_BACKSTOP_MS);
    return () => {
      window.clearTimeout(timer);
    };
    // Only a new read is a change: `max` and `announce` are not.
  }, [people]);

  if (me === undefined) return null;
  // Not asked yet, presence switched off, or nobody here: nothing to draw —
  // but the live region stays, so a later arrival is still heard.
  if (people === undefined || (people.length === 0 && leaving.length === 0)) {
    return <LiveRegion message={message} />;
  }

  const { shown, extra } = hereFaces(people, max);
  const label = hereLabel(people, max);
  const faces = [
    ...shown.map((person) => ({ person, state: arriving.has(person.user_id) ? 'arriving' : '' })),
    ...leaving.map((person) => ({ person, state: 'leaving' })),
  ];

  return (
    <>
      <div className="hdr-anchor hdr-anchor-here" ref={box}>
        <Tooltip content={label}>
          <button
            ref={button}
            type="button"
            className={open ? 'hdr-here hdr-here-open' : 'hdr-here'}
            aria-label={label}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-header-here
            onClick={() => {
              setOpen((v) => !v);
            }}
          >
            {faces.map(({ person, state }) => (
              <span
                key={`${person.user_id}-${state === 'leaving' ? 'leaving' : 'here'}`}
                className="hdr-here-face"
                data-status={person.status}
                data-here-face={person.user_id}
                {...(state === 'arriving' ? { 'data-arriving': '' } : {})}
                {...(state === 'leaving' ? { 'data-leaving': '' } : {})}
                onAnimationEnd={(event) => {
                  if (state !== 'leaving' || event.target !== event.currentTarget) return;
                  setLeaving((all) => all.filter((p) => p.user_id !== person.user_id));
                }}
              >
                <Avatar
                  name={person.name}
                  userId={person.user_id}
                  theme={theme}
                  size={28}
                  label={null}
                />
              </span>
            ))}
            {extra > 0 && (
              <span className="hdr-here-more" data-here-more aria-hidden="true">
                +{String(extra)}
              </span>
            )}
          </button>
        </Tooltip>
        {open && (
          <Suspense
            fallback={
              <div className="hdr-popover hdr-here-pop" role="status">
                <p className="hdr-popover-note">Opening who’s here…</p>
              </div>
            }
          >
            <HerePopover
              people={people}
              now={polled.readAt ?? Date.now()}
              theme={theme}
              navigate={navigate}
              onClose={close}
            />
          </Suspense>
        )}
      </div>
      {/* Outside the anchor: a phone hides the stack, never what it says. */}
      <LiveRegion message={message} />
    </>
  );
}
