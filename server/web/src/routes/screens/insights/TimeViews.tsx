import type { MouseEvent } from 'react';
import '../../../components/time-report/time-report.css';
import { TIME_SUBVIEWS, timeSubviewHref, type TimeSubview } from './time-tab.ts';

/**
 * *Time report · Availability* (frames 1g, 2g; LAI-1139): the two views under
 * Insights → Time, as links — each has its own address, so either can be
 * shared or reloaded, and a plain click changes it without a reload.
 */
export function TimeViews({
  current,
  onNavigate,
}: {
  readonly current: TimeSubview;
  readonly onNavigate: (to: string) => void;
}) {
  return (
    <nav className="trep-segments time-views" aria-label="Time views">
      {TIME_SUBVIEWS.map(([id, label]) => {
        const href = timeSubviewHref(id);
        return (
          <a
            key={id}
            href={href}
            className={id === current ? 'trep-segment trep-segment-on' : 'trep-segment'}
            aria-current={id === current ? 'page' : undefined}
            data-time-view={id}
            onClick={(event: MouseEvent) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onNavigate(href);
            }}
          >
            {label}
          </a>
        );
      })}
    </nav>
  );
}
