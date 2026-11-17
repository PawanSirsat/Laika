import { useLive } from './SpaceLive.tsx';
import { Tooltip } from '../tooltip/Tooltip.tsx';
import { useShell } from '../shell/shell-context.ts';
import { SpaceSettingsLink } from './SpaceSettingsLink.tsx';
import { ProjectMark } from '../ProjectMark.tsx';

/**
 * Row one of a space: **who and what, and nothing else** (LAI-1198) — in the
 * page, under a *Spaces /* breadcrumb, since LAI-1227 (LAI-1188 had drawn it in
 * the app header; the owner asked for Jira's header, whose top bar names no
 * page and whose project page names itself).
 *
 * Until LAI-1198 this row also carried Search, Priority, Tag, Assignee and
 * Ready-only on every view that did not claim them, which pushed Agents and
 * Create onto a second line on the Calendar, Sprints, Activity and Meeting
 * review — the tabs dropped ~35px and Create moved from tab to tab (visual
 * audit, findings 3 and 4). Those controls now live in `SpaceToolbar`, the row
 * under the tabs, and Create with them, so this row is the same on every tab:
 * the space's name and key, the live indicator and Space settings.
 *
 * **No Agents chip** (LAI-1233, the owner): it repeated the board Filter's
 * *Agent-created only* and cost a `/presence` read on every tab of every
 * space. The filter stays in the board's Filter panel; presence is read only
 * where it is shown, on Activity.
 */
export function SpaceTopBar() {
  /*
   * From the shell, not a prop: the rail reads the same value and one project
   * name should be one request (LAI-299). `slug` is the fallback while the
   * by-slug response is in flight — a URL is a poor name but a true one.
   */
  const { spaceName, spaceKey, route } = useShell();
  const spacesHref = '/projects';
  const slug = route.params.get('project') ?? undefined;

  const { stream } = useLive();

  return (
    <>
      {/*
        **The way back to every space** (LAI-1227), Jira's *Projects /* above a
        project's name: one step, to the Spaces page. Not a heading — the
        space's name below is the page's one `h1`.
      */}
      <div className="space-crumbs" data-space-crumbs>
        <nav aria-label="Breadcrumb">
          <ol className="space-crumbs-list">
            <li className="space-crumb">
              <a
                href={spacesHref}
                className="space-crumb-link"
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  route.navigate(spacesHref);
                }}
              >
                Spaces
              </a>
            </li>
          </ol>
        </nav>
      </div>

      <div className="space-bar-row">
        <div className="space-identity">
          {/*
            **The project name is the bar's** (owner, 2026-09-21; LAI-299): the
            rail names the product, and below 900px it is off-canvas entirely,
            so this headline is the only place the space is named.
          */}
          {/*
            **The space's own mark, as the rail draws it** (LAI-1234; D-152):
            the same `ProjectMark` — its image, emoji or letter on its colour —
            so the space looks like itself in the rail and on its page. It was
            a fixed ink block with a bar-chart glyph, the same for every space.
            The shell's read of this space is remembered by slug, so the mark
            has its icon without the bar carrying it.
          */}
          {slug !== undefined && (
            <span className="space-icon" aria-hidden="true">
              <ProjectMark project={{ slug, name: spaceName ?? slug }} size="md" />
            </span>
          )}
          <h1 className="space-name">{spaceName ?? slug ?? 'No space'}</h1>
          {/* The key every task in it carries (`LC` for `LC-42`), from the same read. */}
          {spaceKey !== undefined && (
            <Tooltip content={`Tasks in this space are keyed ${spaceKey}-…`}>
              <span className="space-key">
                <span className="visually-hidden">Key </span>
                {spaceKey}
              </span>
            </Tooltip>
          )}
        </div>

        {/*
          The LIVE pill. Four states, because the stream has four and a pill
          that only ever says LIVE is decoration (§11.5).
        */}
        <span className={`space-live space-live-${stream}`}>
          <span className="space-live-dot" aria-hidden="true" />
          <span className="space-live-word">
            {stream === 'live'
              ? 'LIVE'
              : stream === 'catching-up'
                ? 'CATCHING UP'
                : stream === 'down'
                  ? 'OFFLINE'
                  : 'CONNECTING'}
          </span>
        </span>
      </div>

      <div className="space-bar-right">
        {slug !== undefined && <SpaceSettingsLink slug={slug} />}
      </div>
    </>
  );
}
