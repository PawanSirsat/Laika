import { useEffect, useRef } from 'react';
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
 * The Organisation's settings hub navigation (LAI-1318): the sections down
 * the side, grouped by job — Workspace, People & access, Connections,
 * Records — one focused page each. On a narrow screen it becomes one row
 * that scrolls sideways above the page.
 *
 * Each item keeps the `page-tab` / `data-tab` / `aria-current` it had in the
 * strip, so every reader of those — a test, a screen reader, a shortcut —
 * finds the same thing.
 */
export function OrgNav({ tabs, current, counts, states, onNavigate }: OrgNavProps) {
  const groups: { readonly name: string | undefined; readonly items: PageTab[] }[] = [];
  for (const tab of tabs) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.name === tab.group) last.items.push(tab);
    else groups.push({ name: tab.group, items: [tab] });
  }
  // On a narrow screen the sections are one row that scrolls: keep the open
  // one in view, so the reader can see where they are.
  const navRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (nav === null || nav === undefined || item === null || item === undefined) return;
    if (nav.scrollWidth <= nav.clientWidth) return;
    nav.scrollLeft = item.offsetLeft - (nav.clientWidth - item.offsetWidth) / 2;
  }, [current]);
  return (
    <nav className="org-nav" aria-label="Organisation sections" ref={navRef}>
      {groups.map((group) => (
        <div key={group.name ?? 'top'} className="org-nav-group">
          {group.name !== undefined && <p className="org-nav-heading">{group.name}</p>}
          <ul className="org-nav-list">
            {group.items.map((tab) => {
              const active = tab.id === current;
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
                    data-tab={tab.id}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
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
    </nav>
  );
}
