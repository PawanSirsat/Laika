import { createContext, useContext, type ElementType, type ReactNode } from 'react';
import { glassClass, type GlassLevel } from './glass-level.ts';
import './glass.css';

/** True inside any GlassSurface: what a nested one reads to stay solid. */
const InsideGlass = createContext(false);

export interface GlassSurfaceProps {
  /** 1 chrome (rails, bars) · 2 panels and cards · 3 floating (menus, dialogs, toasts). */
  readonly level: GlassLevel;
  /** The element to render — `div` unless the content says otherwise. */
  readonly as?: ElementType;
  /** Hover lift, pressed and focus states, for a surface that is a control. */
  readonly interactive?: boolean;
  /** The brand glow ring. Say so in ARIA too — never by colour alone. */
  readonly selected?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
  readonly [attribute: `aria-${string}` | `data-${string}`]: string | boolean | undefined;
  readonly id?: string;
  readonly role?: string;
  readonly tabIndex?: number;
}

/**
 * The one way to get glass in a new component (LAI-1132).
 *
 * Renders one element with `.glass-N`, whose `::before` pane carries the
 * tint, sheen, highlight and blur from `glass.css`. Inside another
 * GlassSurface it renders `.glass-solid` instead, and says so in development —
 * a blur never nests.
 */
export function GlassSurface({
  level,
  as: Tag = 'div',
  interactive,
  selected,
  className,
  children,
  ...rest
}: GlassSurfaceProps) {
  const nested = useContext(InsideGlass);
  if (nested && import.meta.env.DEV) {
    console.warn(
      `GlassSurface level ${String(level)} is inside another glass surface; it renders solid-on-glass.`,
    );
  }
  const classes = [glassClass(level, nested, { interactive, selected }), className ?? '']
    .filter((c) => c !== '')
    .join(' ');
  return (
    <InsideGlass.Provider value={true}>
      <Tag className={classes} {...rest}>
        {children}
      </Tag>
    </InsideGlass.Provider>
  );
}
