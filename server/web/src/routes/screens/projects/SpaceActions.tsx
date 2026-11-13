import { NavIcon } from '../../../components/sidebar/NavIcon.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import type { Project } from '../../../api/projects.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import { spaceColor, spaceColorVar } from '../../../theme/space-color.ts';
import type { Theme } from '../../../theme/theme.ts';
import { progressLine, progressOf } from './spaces-model.ts';
import { Tooltip } from '../../../components/tooltip/Tooltip.tsx';

/**
 * The pieces a space is drawn from on the Spaces page (D-103 item 12,
 * LAI-978), shared by the grid card and the list row so the two views cannot
 * disagree about a number, a colour or who may press what.
 */

/** Which section a space is drawn in decides what it offers. */
export type SpaceKind = 'yours' | 'joinable' | 'archived';

export interface SpaceHandlers {
  readonly onOpen: (space: Project) => void;
  readonly onContext: (space: Project) => void;
  readonly onMembers: (space: Project) => void;
  readonly onSettings: (space: Project) => void;
  readonly onJoin: (space: Project) => void;
  readonly onRestore: (space: Project) => void;
  /** Ask first, then archive (LAI-1196). The screen owns the question. */
  readonly onArchive: (space: Project) => void;
}

export interface SpaceItemProps {
  readonly space: Project;
  readonly kind: SpaceKind;
  /** Holds `project.settings.edit` in this space: the ⚙ and Settings show. */
  readonly maySettings: boolean;
  /**
   * Holds the org's `project.archive` and this space's `project.settings.edit`,
   * as the server answers both: an archived space offers Restore, a live one
   * Archive (LAI-1196) — the same `PATCH`, so the same two grants.
   */
  readonly mayRestore: boolean;
  /** A join, archive or restore for this space is in flight. */
  readonly busy: boolean;
  readonly theme: Theme;
  readonly now: number;
  readonly handlers: SpaceHandlers;
}

/** The letter on the space's own colour (D-103 item 4). Decoration beside the name. */
export function SpaceAvatar({ space, size }: { space: Project; size: 'lg' | 'md' }) {
  const letter = (space.name.trim()[0] ?? space.slug[0] ?? '?').toUpperCase();
  return (
    <span
      className={`space-avatar space-avatar-${size}`}
      style={{ background: spaceColorVar(spaceColor(space)) }}
      data-color={spaceColor(space)}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}

export function AccessBadge({ space }: { space: Project }) {
  const open = space.visibility === 'public';
  return (
    <span className={open ? 'project-chip project-chip-public' : 'project-chip'}>
      {space.visibility.toUpperCase()}
    </span>
  );
}

/** The thin bar: done, in progress, review, and the rest as track. */
export function SpaceBar({ space }: { space: Project }) {
  const p = progressOf(space);
  const pct = (n: number): string => (p.total === 0 ? '0%' : `${String((n / p.total) * 100)}%`);
  return (
    <span className="spaces-progress" aria-hidden="true">
      <span className="spaces-progress-done" style={{ width: pct(p.done) }} />
      <span className="spaces-progress-active" style={{ width: pct(p.active) }} />
      <span className="spaces-progress-review" style={{ width: pct(p.review) }} />
    </span>
  );
}

/** `358/720 done · 10 active · 38 blocked`; blocked only when there is any. */
export function SpaceCounts({ space, blocked = true }: { space: Project; blocked?: boolean }) {
  const line = progressLine(progressOf(space));
  return (
    <p className="space-counts">
      <span>{line.main}</span>
      {line.active !== null && <span> · {line.active}</span>}
      {blocked && line.blocked !== null && <span className="space-blocked"> · {line.blocked}</span>}
    </p>
  );
}

/** How many faces fit before the row looks crowded. */
const FACES = 4;

/** Overlapping member faces, and a `+n` for the rest of `member_count`. */
export function SpaceFaces({ space, theme }: { space: Project; theme: Theme }) {
  const shown = space.members.slice(0, FACES);
  const overflow = space.member_count - shown.length;
  // One name for the whole stack (LAI-1196): the faces are initials, which a
  // screen reader would otherwise spell out letter by letter.
  const label = `${String(space.member_count)} ${space.member_count === 1 ? 'member' : 'members'}${
    shown.length > 0
      ? `: ${shown.map((m) => m.name).join(', ')}${overflow > 0 ? ' and others' : ''}`
      : ''
  }`;
  return (
    <span className="space-faces" role="img" aria-label={label}>
      {shown.map((member) => {
        const colour = avatarColor(member.user_id, theme);
        return (
          <Tooltip key={member.user_id} content={member.name}>
            <span
              className="space-face"
              style={{ background: colour.background, color: colour.foreground }}
            >
              {initials(member.name)}
            </span>
          </Tooltip>
        );
      })}
      {overflow > 0 && <span className="space-face space-face-more">+{overflow}</span>}
    </span>
  );
}

/**
 * Context · Members · Archive · ⚙ for a space of yours, Join for a public one
 * you are not in, Restore for an archived one — each only for whoever may use
 * it.
 */
export function SpaceActions({
  space,
  kind,
  maySettings,
  mayRestore,
  busy,
  handlers,
  settingsLabel,
}: SpaceItemProps & { readonly settingsLabel: 'icon' | 'text' }) {
  if (kind === 'joinable') {
    return (
      <button
        type="button"
        className="space-join"
        disabled={busy}
        onClick={() => {
          handlers.onJoin(space);
        }}
      >
        {busy && <Spinner size="sm" />}
        Join
      </button>
    );
  }
  if (kind === 'archived') {
    return mayRestore ? (
      <button
        type="button"
        className="space-link"
        data-action="restore"
        disabled={busy}
        onClick={() => {
          handlers.onRestore(space);
        }}
      >
        {busy && <Spinner size="sm" />}
        Restore
      </button>
    ) : null;
  }
  /*
   * **Named for their space, read as their word** (LAI-1023). Every row's
   * buttons said only "Context" and "Members", so a screen reader's list of
   * buttons held five of each and no way to tell them apart. The name starts
   * with the visible word, so a voice user saying "Context" still reaches it.
   */
  return (
    <>
      <button
        type="button"
        className="space-link"
        data-action="context"
        data-space={space.slug}
        aria-label={`Context for ${space.name}`}
        onClick={() => {
          handlers.onContext(space);
        }}
      >
        Context
      </button>
      <button
        type="button"
        className="space-link"
        aria-label={`Members of ${space.name}`}
        onClick={() => {
          handlers.onMembers(space);
        }}
      >
        Members
      </button>
      {mayRestore && (
        <button
          type="button"
          className="space-link space-archive"
          data-action="archive"
          data-space={space.slug}
          aria-label={`Archive ${space.name}`}
          disabled={busy}
          onClick={() => {
            handlers.onArchive(space);
          }}
        >
          {busy && <Spinner size="sm" />}
          Archive
        </button>
      )}
      {maySettings && (
        <Tooltip content={`${space.name} settings`}>
          <a
            className={settingsLabel === 'icon' ? 'space-link space-gear' : 'space-link'}
            href={`/spaces/${encodeURIComponent(space.slug)}/settings`}
            onClick={(event) => {
              event.preventDefault();
              handlers.onSettings(space);
            }}
          >
            {settingsLabel === 'icon' ? (
              <>
                <NavIcon name="gear" size={16} />
                <span className="visually-hidden">Settings</span>
              </>
            ) : (
              'Settings'
            )}
          </a>
        </Tooltip>
      )}
    </>
  );
}
