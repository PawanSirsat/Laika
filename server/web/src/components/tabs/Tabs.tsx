import type { ReactNode } from 'react';
import { TAB_ACTIVE, TAB_ITEM, TabStrip, rovingTabIndex } from './TabStrip.tsx';

export interface TabItem<T extends string> {
  readonly id: T;
  /** What the tab says — words, and a count if it has one. */
  readonly label: ReactNode;
  /** Hooks a test or a stylesheet already reads, such as `data-filter`. */
  readonly data?: Readonly<Record<`data-${string}`, string>> | undefined;
}

export interface TabsProps<T extends string> {
  /** Names the tablist for a screen reader: `Task activity`. */
  readonly label: string;
  readonly items: readonly TabItem<T>[];
  readonly selected: T;
  readonly onSelect: (id: T) => void;
  /** Each tab's id is `${idBase}-${id}`; its panel names it with `aria-labelledby`. */
  readonly idBase: string;
  /**
   * The panel a tab controls — one id for a shared panel, or one per tab.
   * Absent only where the page has no single element to name (the day tabs,
   * whose sections are siblings in My day's grid): then no `aria-controls`.
   */
  readonly panelId?: string | ((id: T) => string) | undefined;
  /** The tablist's own class (its look): `panel-tabs`, `dash-tabs`. */
  readonly className?: string | undefined;
  readonly tabClassName: string;
  /** Added to the selected tab's class, for a look that does not key off `aria-selected`. */
  readonly selectedClassName?: string | undefined;
  /** `ul` puts each tab in an `li role="presentation"`, for a strip styled as a list. */
  readonly element?: 'div' | 'ul' | 'span' | undefined;
}

/** The id of a tab drawn by {@link Tabs}, for its panel's `aria-labelledby`. */
export function tabId(idBase: string, id: string): string {
  return `${idBase}-${id}`;
}

/**
 * Tabs that switch a panel on this page (LAI-1193) — the *local* variant of
 * the one tab strip. Buttons with `role="tab"`, `aria-selected`,
 * `aria-controls` and a roving tabindex, inside {@link TabStrip}, which owns
 * the keys, the overflow fade and the reveal. Tabs that go to an address are
 * `PageTabs` / `ViewTabs`, links on the same strip.
 *
 * The panel stays the caller's: it carries `role="tabpanel"`, the
 * `panelId` and `aria-labelledby={tabId(idBase, selected)}`.
 */
export function Tabs<T extends string>({
  label,
  items,
  selected,
  onSelect,
  idBase,
  panelId,
  className,
  tabClassName,
  selectedClassName,
  element = 'div',
}: TabsProps<T>) {
  const anyActive = items.some((item) => item.id === selected);
  const tabs = items.map((item, index) => {
    const active = item.id === selected;
    const button = (
      <button
        key={item.id}
        type="button"
        role="tab"
        id={tabId(idBase, item.id)}
        className={
          active && selectedClassName !== undefined
            ? `${tabClassName} ${selectedClassName}`
            : tabClassName
        }
        aria-selected={active}
        aria-controls={
          panelId === undefined
            ? undefined
            : typeof panelId === 'string'
              ? panelId
              : panelId(item.id)
        }
        tabIndex={rovingTabIndex(active, index, anyActive)}
        {...{ [TAB_ITEM]: '' }}
        {...(active ? { [TAB_ACTIVE]: '' } : {})}
        {...item.data}
        onClick={() => {
          if (!active) onSelect(item.id);
        }}
      >
        {item.label}
      </button>
    );
    return element === 'ul' ? (
      <li key={item.id} role="presentation">
        {button}
      </li>
    ) : (
      button
    );
  });

  return (
    <TabStrip
      activeKey={selected}
      element={element}
      role="tablist"
      label={label}
      className={className}
    >
      {tabs}
    </TabStrip>
  );
}
