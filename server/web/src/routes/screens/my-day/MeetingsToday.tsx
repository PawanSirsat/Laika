import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { formatDuration } from '../../../api/duration.ts';
import {
  listMyMeetings,
  logMeetingTime,
  refusalReason,
  type MeetingSummary,
} from '../../../api/meetings.ts';
import { undo } from '../../../api/time.ts';
import { Icon } from '../../../components/icon/Icon.tsx';
import { useToast } from '../../../components/toast/ToastProvider.tsx';
import { meetingHref } from '../meetings/meetings-derive.ts';
import { attendedLine, meetingsToday } from './meetings-today-derive.ts';
import { plainClick } from './task-link.ts';

export interface MeetingsTodayProps {
  /** The day on the page, `YYYY-MM-DD` — always today, or the strip is not drawn. */
  readonly today: string;
  /** The page's zone: the day a meeting counts on, and the clock it reads in. */
  readonly tz: string;
  readonly onNavigate: (to: string) => void;
  /** The day changed on the server — an entry added or taken back: read it again. */
  readonly onDayChanged: () => void;
}

/**
 * The most a day can hold is a handful; one page of the newest attended
 * meetings reaches back well past today, since the list is newest first.
 */
const PAGE = 50;

/**
 * *Meetings today* (LAI-1313): a slim strip above the Timeline of the Teams
 * meetings the reader sat in today and has not put on their day, each with
 * *Add to My day* — the Meetings page's own action, ending in the same toast
 * with Undo through the server's `X-Undo-Id`.
 *
 * **Drawn only where it can be acted on**, which the parent decides: meetings
 * synced on this instance (so a password instance never asks), the reader's
 * own day, and that day today. Here it draws nothing until the list is read,
 * nothing on a failed read — the strip is a shortcut, not a page, and an error
 * card above the Timeline would push the day down for something the Meetings
 * page already offers — and nothing once every meeting is added.
 */
export function MeetingsToday({ today, tz, onNavigate, onDayChanged }: MeetingsTodayProps) {
  const toast = useToast();
  const [rows, setRows] = useState<readonly MeetingSummary[]>([]);
  const [adding, setAdding] = useState<string | undefined>(undefined);
  const [tick, setTick] = useState(0);
  const reread = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    listMyMeetings({ filter: 'attended', limit: PAGE }, controller.signal)
      .then((list) => {
        if (controller.signal.aborted) return;
        setRows(list.enabled ? meetingsToday(list.data, today, tz) : []);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setRows([]);
      });
    return () => {
      controller.abort();
    };
  }, [today, tz, tick]);

  if (rows.length === 0) return null;

  const add = (meeting: MeetingSummary): void => {
    setAdding(meeting.id);
    let undoId: string | undefined;
    logMeetingTime(meeting.id, tz, (given) => {
      undoId = given;
    })
      .then((entry) => {
        const taken = undoId;
        // Off the strip at once: it is on the day now, which is read again to show it.
        setRows((prev) => prev.filter((m) => m.id !== meeting.id));
        onDayChanged();
        reread();
        toast.show({
          text: `Added ${formatDuration(entry.minutes)} to My day`,
          tone: 'success',
          mark: 'meeting-added',
          undo:
            taken === undefined
              ? undefined
              : async () => {
                  await undo(taken);
                  onDayChanged();
                  reread();
                  return 'Taken off My day';
                },
        });
      })
      .catch((error: unknown) => {
        // Added already (another tab, the Meetings page): the next read drops it.
        if (refusalReason(error) === 'already_logged') reread();
        toast.show({
          text: 'Couldn’t add it to My day',
          tone: 'error',
          detail: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        setAdding(undefined);
      });
  };

  return (
    <section className="myday-meetings" aria-labelledby="myday-meetings-title" data-meetings-today>
      <h2 className="myday-meetings-title" id="myday-meetings-title">
        <Icon name="meetings" size="small" />
        Meetings today
      </h2>
      <ul className="myday-meetings-list">
        {rows.map((meeting) => {
          const href = meetingHref(meeting.id);
          return (
            <li key={meeting.id} className="myday-meetings-row" data-meeting-today={meeting.id}>
              <a
                className="myday-meetings-name"
                id={`myday-meeting-${meeting.id}`}
                href={href}
                onClick={(event: MouseEvent) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  onNavigate(href);
                }}
              >
                {meeting.title}
              </a>
              <span className="myday-meetings-when" data-meeting-when>
                {attendedLine(meeting, tz)}
              </span>
              <button
                type="button"
                className="myday-chip myday-meetings-add"
                // Every row's button says the same; the meeting's name tells them apart.
                aria-describedby={`myday-meeting-${meeting.id}`}
                disabled={adding !== undefined}
                aria-busy={adding === meeting.id || undefined}
                onClick={() => {
                  add(meeting);
                }}
              >
                <Icon name="plus" size="small" />
                Add to My day
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
