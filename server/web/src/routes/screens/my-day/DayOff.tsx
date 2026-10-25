import { useEffect, useState } from 'react';
import { getOrg } from '../../../api/org.ts';
import './day-states.css';

/**
 * Time tracking is off for the organisation (`bd.orgOff`): nothing is
 * collected or drafted, so My day is this card and the way to the setting.
 * The organisation's name is read once; without it the card says
 * *your organisation*.
 */
export function DayOff({ onOpenSettings }: { readonly onOpenSettings: () => void }) {
  const [org, setOrg] = useState<string | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    getOrg(controller.signal)
      .then((o) => {
        if (!controller.signal.aborted) setOrg(o.name);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, []);
  return (
    <section className="myday-card dstate-card dstate-centre dstate-off" data-day-off>
      <span className="dstate-mark dstate-mark-off" aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="9" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M9 5.5V9l2.5 1.5M3 15L15 3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <h2 className="dstate-title">Time tracking is off for {org ?? 'your organisation'}</h2>
      <p className="dstate-body">
        Nothing is collected or drafted while it’s off, and My day stays empty. Owners and admins
        can turn it on in Organisation settings.
      </p>
      <button type="button" className="myday-chip dstate-action" onClick={onOpenSettings}>
        Open Organisation settings
      </button>
    </section>
  );
}
