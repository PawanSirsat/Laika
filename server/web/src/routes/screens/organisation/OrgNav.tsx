import {
  TAB_ACTIVE,
  TAB_ITEM,
  TabStrip,
  rovingTabIndex,
} from '../../../components/tabs/TabStrip.tsx';
import { tabHref, type PageTab } from '../../page-tabs.ts';

export interface OrgNavProps {
  /** The sections this reader is offered, in order; `group` makes the headings. */
  readonly tabs: readonly PageTab[];
  readonly current: string;
  /** A figure after a label — People's head count. */
  readonly counts?: Readonly<Record<string, number | undefined>>;
  /** A state after a connection's label: `on` lights a dot. */
  readonly states?: Readonly<Record<string, 'on' | 'off' | undefined>>;
  readonly onNavigate: (to: string) => void;
}

/**
 * The Organisation's settings hub navigation (LAI-1345): the sections down
 * the side, grouped by job — Workspace, People & access, Connections,
 * Records — one focused page each. On a narrow screen it becomes one row
 * that scrolls sideways above the page.
 *
 * Each item keeps the `page-tab` / `data-tab` / `aria-current` it had in the
 * strip, so every reader of those — a test, a screen reader, a shortcut —
 * finds the same thing.
 *
 * **On the one tab strip** (LAI-1193), as the page tabs it replaced were:
 * one stop in the Tab order (the current section), Left/Right/Home/End
 * between sections across every group, and — as the row it becomes at or
 * below 900px — an edge fade where it scrolls, with the current section
 * scrolled into view.
 */
export function OrgNav({ tabs, current, counts, states, onNavigate }: OrgNavProps) {
  const groups: { readonly name: string | undefined; readonly items: PageTab[] }[] = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.name === tab.group) last.items.push(tab);
    else groups.push({ name: tab.group, items: [tab] });
  }
  const anyActive = tabs.some((tab) => tab.id === current);
  return (
    <nav className="org-nav" aria-label="Organisation sections">
      <TabStrip activeKey={current} className="org-nav-strip">
        {groups.map((group) => (
          <div key={group.name ?? 'top'} className="org-nav-group">
            {group.name !== undefined && <p className="org-nav-heading">{group.name}</p>}
            <ul className="org-nav-list">
              {group.items.map((tab) => {
                const active = tab.id === current;
                const index = tabs.indexOf(tab);
                const href = tabHref('/organisation', tab.id);
                const count = counts?.[tab.id];
                const state = states?.[tab.id];
                return (
                  <li key={tab.id}>
                    <a
                      href={href}
                      className={
                        active ? 'page-tab page-tab-active org-nav-item' : 'page-tab org-nav-item'
                      }
                      aria-current={active ? 'page' : undefined}
                      tabIndex={rovingTabIndex(active, index, anyActive)}
                      data-tab={tab.id}
                      {...{ [TAB_ITEM]: '' }}
                      {...(active ? { [TAB_ACTIVE]: '' } : {})}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
                          return;
                        event.preventDefault();
                        onNavigate(href);
                      }}
                    >
                      <span className="org-nav-label">{tab.label}</span>
                      {state !== undefined && (
                        <span
                          className="org-nav-dot"
                          data-state={state}
                          aria-label={state === 'on' ? 'on' : 'off'}
                        />
                      )}
                      {count !== undefined && <span className="page-tab-count">{count}</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </TabStrip>
    </nav>
  );
}
