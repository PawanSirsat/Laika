import { useRef } from 'react';
import { PANEL_LIMITS, dragWidth, separatorKey, type PanelSide } from './workroom-layout.ts';

export interface PanelSeparatorProps {
  readonly side: PanelSide;
  /** The panel it resizes, by id, for `aria-controls`. */
  readonly controls: string;
  readonly label: string;
  readonly width: number;
  readonly collapsed: boolean;
  /** While dragging: a width to draw, not yet kept. */
  readonly onPreview: (width: number) => void;
  /** The width to keep: a key, the end of a drag, a double-click. */
  readonly onCommit: (width: number) => void;
  readonly onToggle: () => void;
}

/**
 * **A window splitter with no library** (LAI-1199; WAI-ARIA window splitter
 * pattern): a focusable `role="separator"` with its value, limits and the
 * panel it controls. ← → move it, Shift for a bigger step, Home and End go to
 * the limits, Enter collapses and expands. A drag holds the pointer and is
 * drawn once a frame; a double-click returns the panel to its default width.
 */
export function PanelSeparator({
  side,
  controls,
  label,
  width,
  collapsed,
  onPreview,
  onCommit,
  onToggle,
}: PanelSeparatorProps) {
  const drag = useRef<{ x: number; width: number; last: number; frame: number } | null>(null);
  const limits = PANEL_LIMITS[side];

  return (
    <div
      className="wr-separator"
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-controls={controls}
      aria-label={label}
      aria-valuenow={collapsed ? 0 : width}
      aria-valuemin={limits.min}
      aria-valuemax={limits.max}
      aria-valuetext={collapsed ? 'Collapsed' : `${String(width)} pixels`}
      tabIndex={0}
      onKeyDown={(event) => {
        const command = separatorKey(side, width, event);
        if (command === null) return;
        event.preventDefault();
        if (command.kind === 'toggle') onToggle();
        else if (!collapsed) onCommit(command.width);
      }}
      onDoubleClick={() => {
        onCommit(limits.initial);
      }}
      onPointerDown={(event) => {
        if (collapsed || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, last: width, frame: 0 };
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (d === null) return;
        d.last = dragWidth(side, d.width, event.clientX - d.x);
        if (d.frame !== 0) return;
        d.frame = requestAnimationFrame(() => {
          d.frame = 0;
          onPreview(d.last);
        });
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        if (d === null) return;
        drag.current = null;
        if (d.frame !== 0) cancelAnimationFrame(d.frame);
        event.currentTarget.releasePointerCapture(event.pointerId);
        onCommit(d.last);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        if (d !== null) onCommit(d.width);
      }}
    >
      <span className="wr-separator-grip" aria-hidden="true" />
    </div>
  );
}
