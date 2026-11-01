import type { MyDay } from '../../../api/time.ts';
import { DraftMyTime } from './DraftMyTime.tsx';
import { HeaderPopover } from './HeaderPopover.tsx';
import { WhereYouAre } from './WhereYouAre.tsx';

export interface DaySettingsProps {
  readonly settings: MyDay['settings'];
  readonly held: MyDay['drafts_held'];
  readonly tz: string;
  readonly pending: string | undefined;
  readonly run: (key: string, write: () => Promise<unknown>, said: string) => Promise<boolean>;
}

const Sliders = () => (
  <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2 4.5h7M12.5 4.5H14M2 11.5h2.5M8 11.5h6"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
    <circle cx="10.7" cy="4.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="6.2" cy="11.5" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

/**
 * *Day settings* (D-110, LAI-502): the two switches the header used to show
 * in the open, behind one button, as the design has them — *Draft my time*
 * with what it does, and *Where you are* with what it sets.
 */
export function DaySettings({ settings, held, tz, pending, run }: DaySettingsProps) {
  return (
    <HeaderPopover
      label="Day settings"
      triggerClassName="myday-chip myday-head-icon"
      dataAttr="data-day-settings"
      width="wide"
      trigger={<Sliders />}
    >
      <div className="myday-pop-row">
        <div className="myday-pop-words">
          <span className="myday-pop-title">Draft my time</span>
          <span className="myday-quiet">
            Your collector drafts blocks from prompts, commits and agent sessions. Only you see
            drafts.
          </span>
        </div>
        <DraftMyTime settings={settings} held={held} pending={pending} run={run} compact />
      </div>
      <div className="myday-pop-row myday-pop-column">
        <WhereYouAre settings={settings} tz={tz} pending={pending} run={run} />
        <span className="myday-quiet">
          Sets where your day starts and ends, and your organisation’s break bands.
        </span>
      </div>
    </HeaderPopover>
  );
}
