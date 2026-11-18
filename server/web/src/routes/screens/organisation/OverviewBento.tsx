import { useEffect, useState, type ReactNode } from 'react';
import { describeEvent, pushSummary } from '../../../api/activity.ts';
import { getCalendarSource } from '../../../api/calendar.ts';
import { getHrSource } from '../../../api/hr.ts';
import type { Org } from '../../../api/org.ts';
import { getTeamsSettings } from '../../../api/teams.ts';
import { timeLabel } from '../../../api/time-label.ts';
import type { OrgUser } from '../../../api/users.ts';
import type { OrgRole } from '../../../api/invites.ts';
import { avatarColor } from '../../../theme/avatar-color.ts';
import { initials } from '../../../theme/initials.ts';
import type { Theme } from '../../../theme/theme.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { statusWord } from './calendar-derive.ts';
import { emailBadge } from './email-derive.ts';
import { HR_STATUS_WORDS } from './HrSourceSection.tsx';
import { useOrgHistory } from './use-org-history.ts';

/** A plain anchor that navigates in the app, and still opens a new tab on a modified click. */
function Go({
  to,
  onNavigate,
  className,
  children,
}: {
  readonly to: string;
  readonly onNavigate: (to: string) => void;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      className={className ?? 'bento-link'}
      href={to}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onNavigate(to);
      }}
    >
      {children}
    </a>
  );
}

/** One tile of the bento: a titled glass card with an optional link out. */
function Tile({
  id,
  title,
  sub,
  action,
  span,
  tone,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly sub?: ReactNode;
  readonly action?: ReactNode;
  /** Columns of twelve on a wide screen. */
  readonly span: 4 | 6 | 8 | 12;
  /** The tile's accent, from the theme's chip colours. */
  readonly tone: 'violet' | 'blue' | 'green' | 'orange' | 'pink';
  readonly children: ReactNode;
}) {
  return (
    <section
      className="org-card bento-tile"
      data-span={span}
      data-tone={tone}
      data-tile={id}
      aria-labelledby={`bento-${id}`}
    >
      <header className="bento-head">
        <span className="bento-head-text">
          <h2 id={`bento-${id}`} className="bento-title">
            {title}
          </h2>
          {sub !== undefined && <span className="bento-sub">{sub}</span>}
        </span>
        {action}
      </header>
      {children}
    </section>
  );
}

export type ConnState = 'on' | 'off' | 'reading' | 'unread';

export interface Connection {
  readonly key: string;
  readonly name: string;
  readonly state: ConnState;
  readonly word: string;
}

/**
 * Every connection the reader may manage, and its state, from the reads the
 * Integrations tab already makes: GitHub, Email and the AI provider from
 * `GET /org`, and the HR system, Teams and Outlook from their own reads —
 * each only for a reader its gate lets in, as on that tab.
 */
export function useConnections(
  org: Org | undefined,
  can: { readonly hr: boolean; readonly teams: boolean; readonly calendar: boolean },
): readonly Connection[] {
  const [hr, setHr] = useState<Connection | undefined>(undefined);
  const [teams, setTeams] = useState<Connection | undefined>(undefined);
  const [calendar, setCalendar] = useState<Connection | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    const unread = (key: string, name: string): Connection => ({
      key,
      name,
      state: 'unread',
      word: 'could not be read',
    });
    if (can.hr) {
      setHr({ key: 'hr', name: 'HR system', state: 'reading', word: 'reading…' });
      getHrSource(controller.signal).then(
        (view) => {
          setHr({
            key: 'hr',
            name: 'HR system',
            state: view.status === 'connected' ? 'on' : 'off',
            word: HR_STATUS_WORDS[view.status],
          });
        },
        () => {
          if (!controller.signal.aborted) setHr(unread('hr', 'HR system'));
        },
      );
    }
    if (can.teams) {
      setTeams({ key: 'teams', name: 'Microsoft Teams', state: 'reading', word: 'reading…' });
      getTeamsSettings(controller.signal).then(
        (view) => {
          setTeams({
            key: 'teams',
            name: 'Microsoft Teams',
            state: view.posting_enabled ? 'on' : 'off',
            word: view.posting_enabled ? 'posting on' : 'off',
          });
        },
        () => {
          if (!controller.signal.aborted) setTeams(unread('teams', 'Microsoft Teams'));
        },
      );
    }
    if (can.calendar) {
      setCalendar({ key: 'calendar', name: 'Outlook calendar', state: 'reading', word: '…' });
      getCalendarSource(controller.signal).then(
        (view) => {
          const word = statusWord(view);
          setCalendar({
            key: 'calendar',
            name: 'Outlook calendar',
            state: word === 'on' ? 'on' : 'off',
            word,
          });
        },
        () => {
          if (!controller.signal.aborted) setCalendar(unread('calendar', 'Outlook calendar'));
        },
      );
    }
    return () => {
      controller.abort();
    };
  }, [can.hr, can.teams, can.calendar]);

  const list: Connection[] = [];
  if (org?.github_webhook !== undefined) {
    list.push({
      key: 'github',
      name: 'GitHub webhook',
      state: org.github_webhook.configured ? 'on' : 'off',
      word: org.github_webhook.configured ? 'secret set' : 'not set up',
    });
  }
  if (hr !== undefined) list.push(hr);
  if (org?.email !== undefined) {
    const badge = emailBadge(org.email);
    list.push({
      key: 'email',
      name: 'Email',
      state: org.email.enabled && org.email.configured ? 'on' : 'off',
      word: badge.label,
    });
  }
  if (teams !== undefined) list.push(teams);
  if (calendar !== undefined) list.push(calendar);
  if (org?.ai !== undefined) {
    list.push({
      key: 'ai',
      name: 'AI provider',
      state: org.ai.configured ? 'on' : 'off',
      word: org.ai.configured ? 'configured' : 'not set up',
    });
  }
  return list;
}

/** The last few things that happened in the organisation, for an owner or admin. */
function RecentActivity({
  people,
  span,
  onNavigate,
}: {
  readonly people: readonly OrgUser[];
  readonly span: 6 | 8 | 12;
  readonly onNavigate: (to: string) => void;
}) {
  const { state } = useOrgHistory({});
  const names = new Map(people.map((p) => [p.id, p.name]));
  const now = Date.now();
  return (
    <Tile
      id="activity"
      title="Recent activity"
      sub="Across every space, newest first"
      span={span}
      tone="pink"
      action={
        <Go to="/organisation?tab=activity" onNavigate={onNavigate}>
          All activity →
        </Go>
      }
    >
      {state.status === 'loading' && <p className="bento-quiet">Reading…</p>}
      {state.status === 'error' && <p className="bento-quiet">The activity could not be read.</p>}
      {state.status === 'ready' &&
        (state.rows.length === 0 ? (
          <p className="bento-quiet">Nothing has happened yet.</p>
        ) : (
          <ol className="bento-feed">
            {state.rows.slice(0, 6).map((event) => {
              const who =
                event.actor_id === null ? 'Laika' : (names.get(event.actor_id) ?? 'Someone');
              const when = timeLabel(event.created_at, now);
              return (
                <li key={event.id} className="bento-feed-row">
                  <span className="bento-feed-dot" aria-hidden="true" />
                  <span className="bento-feed-text">
                    <strong>{who}</strong> {pushSummary(event) ?? describeEvent(event)}
                  </span>
                  <time className="bento-feed-when" dateTime={when.iso} title={when.full}>
                    {when.text}
                  </time>
                </li>
              );
            })}
          </ol>
        ))}
    </Tile>
  );
}

export interface OverviewBentoProps {
  readonly org: Org | undefined;
  readonly people: readonly OrgUser[];
  readonly truncated: boolean;
  readonly invites: number;
  readonly theme: Theme;
  readonly myRole: string;
  readonly can: {
    readonly invite: boolean;
    readonly hr: boolean;
    readonly teams: boolean;
    readonly calendar: boolean;
    readonly activity: boolean;
    readonly tokens: boolean;
    readonly roles: boolean;
  };
  /** This week's figures and the organisation's counts, as tiles already drawn. */
  readonly figures: ReactNode;
  /** The spaces table, drawn by `OrgSpaces`. */
  readonly spaces: ReactNode;
  readonly onInvite: () => void;
  readonly onNavigate: (to: string) => void;
}

/**
 * Organisation → Overview as a dashboard (LAI-1318): one glance at the week,
 * the connections, the people, the spaces and what just happened — each tile
 * leading to the tab where its next step is. Every figure is a read the page
 * or its tabs already make; nothing here is new data.
 */
export function OverviewBento({
  org,
  people,
  truncated,
  invites,
  theme,
  myRole,
  can,
  figures,
  spaces,
  onInvite,
  onNavigate,
}: OverviewBentoProps) {
  const connections = useConnections(org, can);
  const active = people.filter((p) => p.is_active);
  const byRole = (['owner', 'admin', 'member', 'viewer'] as const).map((role) => ({
    role,
    count: active.filter((p) => p.org_role === role).length,
  }));
  const deactivated = people.length - active.length;
  const now = Date.now();
  /** Who joined last — a new face is the likeliest thing to check on. */
  const newest = [...active].sort((x, y) => y.created_at - x.created_at).slice(0, 3);
  const shown = active.slice(0, 8);
  const live = connections.filter((c) => c.state === 'on').length;
  const hasConnections = connections.length > 0;

  return (
    <div className="org-bento">
      <Tile
        id="glance"
        title="At a glance"
        sub="This week, and the organisation today"
        span={hasConnections ? 8 : 12}
        tone="violet"
      >
        {figures}
      </Tile>

      {hasConnections && (
        <Tile
          id="connections"
          title="Connections"
          sub={`${String(live)} of ${String(connections.length)} on`}
          span={4}
          tone="blue"
          action={
            <Go to="/organisation?tab=integrations" onNavigate={onNavigate}>
              Manage →
            </Go>
          }
        >
          <ul className="bento-conns">
            {connections.map((c) => (
              <li key={c.key}>
                <Go
                  to={`/organisation?tab=${c.key}`}
                  onNavigate={onNavigate}
                  className="bento-conn"
                >
                  <span className="bento-conn-dot" data-state={c.state} aria-hidden="true" />
                  <span className="bento-conn-name">{c.name}</span>
                  <span className="bento-conn-word" data-state={c.state}>
                    {c.word}
                  </span>
                  <span className="bento-chevron" aria-hidden="true" />
                </Go>
              </li>
            ))}
          </ul>
        </Tile>
      )}

      <Tile
        id="people"
        title="People"
        sub={`${String(active.length)}${truncated ? '+' : ''} active${
          deactivated > 0 ? ` · ${String(deactivated)} deactivated` : ''
        }`}
        span={4}
        tone="green"
        action={
          <Go to="/organisation?tab=people" onNavigate={onNavigate}>
            Open →
          </Go>
        }
      >
        <div className="bento-avatars" aria-label={`${String(active.length)} active people`}>
          {shown.map((person) => {
            const ink = avatarColor(person.id, theme);
            return (
              <span
                key={person.id}
                className="bento-avatar"
                style={{ background: ink.background, color: ink.foreground }}
                title={person.name}
              >
                {initials(person.name)}
              </span>
            );
          })}
          {active.length > shown.length && (
            <span className="bento-avatar bento-avatar-more">
              +{String(active.length - shown.length)}
            </span>
          )}
        </div>
        <dl className="bento-roles">
          {byRole.map(({ role, count }) => (
            <div key={role} className="bento-role" data-role={role}>
              <dt>{orgRoleLabel(role)}</dt>
              <dd>{String(count)}</dd>
            </div>
          ))}
        </dl>
        {newest.length > 0 && (
          <div className="bento-newest">
            <p className="bento-label">Newest</p>
            <ul className="bento-access">
              {newest.map((person) => (
                <li key={person.id} className="bento-row bento-row-static">
                  <span className="bento-row-name">{person.name}</span>
                  <span className="bento-row-note">
                    {orgRoleLabel(person.org_role as OrgRole)} · joined{' '}
                    {timeLabel(person.created_at, now).text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="bento-actions">
          {can.invite && (
            <button type="button" className="bento-button" onClick={onInvite}>
              + Invite people
            </button>
          )}
          {can.invite && invites > 0 && (
            <Go
              to="/organisation?tab=people&show=pending"
              onNavigate={onNavigate}
              className="bento-pill"
            >
              {String(invites)} pending {invites === 1 ? 'invite' : 'invites'}
            </Go>
          )}
        </div>
      </Tile>

      <div className="bento-slot" data-span={8}>
        {spaces}
      </div>

      {can.activity && <RecentActivity people={people} span={8} onNavigate={onNavigate} />}

      <Tile
        id="access"
        title="Access"
        sub={`You are ${/^[aeiou]/i.test(myRole) ? 'an' : 'a'} ${myRole}`}
        span={can.activity ? 4 : 12}
        tone="orange"
      >
        <ul className="bento-access">
          {can.roles && (
            <li>
              <Go to="/organisation?tab=roles" onNavigate={onNavigate} className="bento-row">
                <span className="bento-row-name">Roles &amp; permissions</span>
                <span className="bento-row-note">who can do what</span>
                <span className="bento-chevron" aria-hidden="true" />
              </Go>
            </li>
          )}
          {can.tokens && (
            <li>
              <Go to="/organisation?tab=security" onNavigate={onNavigate} className="bento-row">
                <span className="bento-row-name">Tokens &amp; sign-in</span>
                <span className="bento-row-note">everyone’s credentials</span>
                <span className="bento-chevron" aria-hidden="true" />
              </Go>
            </li>
          )}
          {org !== undefined && (
            <li className="bento-row bento-row-static">
              <span className="bento-row-name">Developer insights</span>
              <span className="bento-row-note">{org.developer_insights ? 'on' : 'off'}</span>
            </li>
          )}
          {org !== undefined && (
            <li className="bento-row bento-row-static">
              <span className="bento-row-name">Presence</span>
              <span className="bento-row-note">{org.presence_enabled ? 'recorded' : 'off'}</span>
            </li>
          )}
        </ul>
      </Tile>
    </div>
  );
}

/** What each connection does, in one line, for its tile. */
const CONNECTION_LINES: Readonly<Record<string, string>> = {
  github: 'Pushes, pull requests and CI — what turns claimed proof into confirmed.',
  hr: 'Holidays and leave from Clan, kept in step on its own.',
  email: 'Invite and password-reset links, sent through your SMTP relay.',
  teams: 'Stand-ups, the nightly digest and notices, posted to each space’s channel.',
  calendar: 'Accepted meetings logged on each person’s My day as confirmed time.',
  ai: 'The model Meeting reviews use, and the prices every cost on Usage is computed with.',
};

/**
 * Organisation → Connections (LAI-1318): every connection this reader may
 * configure, as a tile that says its state and opens its own page. Model
 * prices sit with the AI provider, whose page every reader may open.
 */
export function ConnectionsIndex({
  org,
  can,
  onNavigate,
}: {
  readonly org: Org | undefined;
  readonly can: { readonly hr: boolean; readonly teams: boolean; readonly calendar: boolean };
  readonly onNavigate: (to: string) => void;
}) {
  const connections = useConnections(org, can);
  // The AI page is everyone's (Model prices are); a reader who may not see
  // the provider still gets the tile, for the prices.
  const tiles: readonly Connection[] = connections.some((c) => c.key === 'ai')
    ? connections
    : [...connections, { key: 'ai', name: 'Model prices', state: 'off', word: 'read only' }];
  const live = tiles.filter((c) => c.state === 'on').length;
  return (
    <section className="conn-index" aria-labelledby="conn-index-title">
      <header className="conn-index-head">
        <h2 id="conn-index-title" className="bento-title">
          Connections
        </h2>
        <span className="bento-sub">
          {String(live)} of {String(tiles.length)} on — open one to set it up or change it
        </span>
      </header>
      <ul className="conn-grid">
        {tiles.map((c) => (
          <li key={c.key}>
            <Go to={`/organisation?tab=${c.key}`} onNavigate={onNavigate} className="conn-tile">
              <span className="conn-tile-top">
                <span className="conn-tile-name">{c.name}</span>
                <span className="org-status-badge" data-tone={c.state === 'on' ? 'on' : 'off'}>
                  {c.word}
                </span>
              </span>
              <span className="conn-tile-line">{CONNECTION_LINES[c.key]}</span>
              <span className="conn-tile-go">
                {c.state === 'on' ? 'Manage' : 'Set up'}
                <span className="bento-chevron" aria-hidden="true" />
              </span>
            </Go>
          </li>
        ))}
      </ul>
    </section>
  );
}
