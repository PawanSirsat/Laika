import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/errors.ts';
import {
  getMeeting,
  linkMeetingSpace,
  logMeetingTime,
  refusalReason,
  reviewMeeting,
  type MeetingDetail,
  type MeetingSummary,
} from '../../../api/meetings.ts';
import { formatDuration } from '../../../api/duration.ts';
import { clockTime } from '../../../api/time-label.ts';
import { undo } from '../../../api/time.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Dropdown, type DropdownOption } from '../../../components/Dropdown.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { Tabs, tabId } from '../../../components/tabs/Tabs.tsx';
import { useToast } from '../../../components/toast/ToastProvider.tsx';
import { useSpaces } from '../../use-spaces.ts';
import { MeetingTranscriptTab } from './MeetingTranscriptTab.tsx';
import { canAddToDay, isUpcoming, organiserLabel, scheduleLine } from './meetings-derive.ts';

type DetailTab = 'attendance' | 'transcript' | 'review';

const TAB_LABELS: readonly (readonly [DetailTab, string])[] = [
  ['attendance', 'Attendance'],
  ['transcript', 'Transcript'],
  ['review', 'Review'],
];

/** The value the space picker uses for *no space*; never a project id (those are ULIDs). */
const NO_SPACE = '';

type DetailState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly meeting: MeetingDetail };

export interface MeetingDetailPaneProps {
  readonly id: string;
  /** Back to the list — the phone's way out of the meeting. */
  readonly onBack: () => void;
  readonly onNavigate: (to: string) => void;
  /** Tell the list a row changed, so it need not be read again. */
  readonly onRowChanged: (row: MeetingSummary) => void;
}

/** The plural the toasts and the Review tab say. */
const proposalWords = (n: number): string => `${String(n)} ${n === 1 ? 'proposal' : 'proposals'}`;

/** Where a review opens: Meeting review, in its space. */
const reviewHref = (slug: string): string => `/meeting-review?project=${encodeURIComponent(slug)}`;

/**
 * One meeting (LAI-1312): what was planned against what ran, who organised
 * it, the space it belongs to, and three tabs — who was there, what was said
 * (fetched only when that tab opens, and never kept), and the Meeting review
 * made from it. Each action ends in a toast; errors persist with the
 * server's own sentence.
 */
export function MeetingDetailPane({
  id,
  onBack,
  onNavigate,
  onRowChanged,
}: MeetingDetailPaneProps) {
  const toast = useToast();
  const [state, setState] = useState<DetailState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<DetailTab>('attendance');
  const [reviewing, setReviewing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const { all: spaces } = useSpaces(true);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    getMeeting(id, controller.signal)
      .then((meeting) => {
        setState({ status: 'ready', meeting });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? { status: 'missing' }
            : { status: 'error', error },
        );
      });
    return () => {
      controller.abort();
    };
  }, [id, attempt]);

  /** Re-read after a change whose effect is on the server only (a review, an undo). */
  const reread = (): void => {
    getMeeting(id)
      .then((meeting) => {
        setState({ status: 'ready', meeting });
        onRowChanged(meeting);
      })
      .catch(() => {
        // What is shown stays; the next open reads it fresh.
      });
  };

  const back = (
    <button type="button" className="meetings-back" onClick={onBack}>
      <Icon name="arrow-left" size="small" />
      All meetings
    </button>
  );

  if (state.status === 'loading') {
    return (
      <div className="meetings-detail">
        {back}
        <LoadingState shape="drawer" label="Loading the meeting" />
      </div>
    );
  }
  if (state.status === 'missing') {
    return (
      <div className="meetings-detail" data-missing>
        {back}
        <EmptyState
          headline="No such meeting"
          body="It is not one you were invited to or joined, or it is no longer in your list."
          action={{ label: 'Back to your meetings', onClick: onBack }}
        />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <div className="meetings-detail">
        {back}
        <ApiErrorState
          error={state.error}
          resource="this meeting"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }

  const { meeting } = state;
  const now = Date.now();
  const linked = meeting.project;

  const spaceOptions: readonly DropdownOption[] = [
    { value: NO_SPACE, label: 'No space' },
    ...spaces.map((s) => ({ value: s.id, label: s.name })),
    // The linked space even before the list lands, so the picker never shows a blank.
    ...(linked !== null && !spaces.some((s) => s.id === linked.id)
      ? [{ value: linked.id, label: linked.name }]
      : []),
  ];

  const link = (projectId: string): void => {
    const next = projectId === NO_SPACE ? null : projectId;
    if (next === (linked?.id ?? null)) return;
    setLinking(true);
    linkMeetingSpace(meeting.id, next)
      .then((updated) => {
        setState({ status: 'ready', meeting: updated });
        onRowChanged(updated);
        toast.show({
          text: updated.project === null ? 'Space unlinked' : `Linked to ${updated.project.name}`,
          tone: 'success',
        });
      })
      .catch((error: unknown) => {
        toast.show({
          text: 'Couldn’t link the space',
          tone: 'error',
          detail: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        setLinking(false);
      });
  };

  const review = (): void => {
    setReviewing(true);
    reviewMeeting(meeting.id)
      .then((started) => {
        toast.show({
          text: `Review ready — ${proposalWords(started.proposals)}`,
          tone: 'success',
          action: {
            label: 'Open',
            run: () => {
              onNavigate(reviewHref(started.project_slug));
            },
          },
        });
        reread();
        setTab('review');
      })
      .catch((error: unknown) => {
        toast.show({
          text: 'Couldn’t review this meeting',
          tone: 'error',
          detail: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        setReviewing(false);
      });
  };

  const addToDay = (): void => {
    setAdding(true);
    let undoId: string | undefined;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    logMeetingTime(meeting.id, tz, (given) => {
      undoId = given;
    })
      .then((entry) => {
        const taken = undoId;
        reread();
        toast.show({
          text: `Added ${formatDuration(entry.minutes)} to My day`,
          tone: 'success',
          undo:
            taken === undefined
              ? undefined
              : async () => {
                  await undo(taken);
                  reread();
                  return 'Taken off My day';
                },
        });
      })
      .catch((error: unknown) => {
        // Already there (another tab, or before this read): show it as it is.
        if (refusalReason(error) === 'already_logged') reread();
        toast.show({
          text: 'Couldn’t add it to My day',
          tone: 'error',
          detail: error instanceof Error ? error.message : undefined,
        });
      })
      .finally(() => {
        setAdding(false);
      });
  };

  const reviewAction = (
    <Button
      variant="primary"
      size="sm"
      icon="checklist"
      busy={reviewing}
      disabled={linked === null || !meeting.has_transcript}
      disabledReason={
        linked === null
          ? 'Link a space first: the review proposes tasks in it.'
          : 'Teams has no transcript for this meeting.'
      }
      onClick={review}
    >
      Review with AI
    </Button>
  );

  return (
    <article
      className="meetings-detail"
      aria-labelledby="meeting-title"
      data-meeting-detail={meeting.id}
    >
      {back}
      <header className="meetings-detail-head">
        <h2 id="meeting-title" className="meetings-detail-title">
          {meeting.title}
        </h2>
        <p className="meetings-detail-meta">
          <span>Organised by {organiserLabel(meeting)}</span>
          <span data-schedule>{scheduleLine(meeting)}</span>
        </p>
        <div className="meetings-space">
          <span className="meetings-space-label" id="meeting-space-label">
            Space
          </span>
          <Dropdown
            value={linked?.id ?? NO_SPACE}
            options={spaceOptions}
            onChange={link}
            noun="space"
            searchable
            disabled={linking}
            name="meeting-space"
          />
        </div>
        <div className="meetings-actions">
          {reviewAction}
          {canAddToDay(meeting) && (
            <Button variant="secondary" size="sm" icon="clock" busy={adding} onClick={addToDay}>
              Add to My day
            </Button>
          )}
          {meeting.join_url !== null && isUpcoming(meeting, now) && (
            <a
              className="button button-secondary button-sm meetings-join"
              href={meeting.join_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open in Teams
            </a>
          )}
        </div>
      </header>

      <Tabs
        label="Meeting sections"
        items={TAB_LABELS.map(([tabValue, label]) => ({ id: tabValue, label }))}
        selected={tab}
        onSelect={setTab}
        idBase="meeting-tab"
        panelId="meeting-panel"
        className="meetings-tabs"
        tabClassName="meetings-tab"
        selectedClassName="meetings-tab-on"
      />
      <div
        id="meeting-panel"
        role="tabpanel"
        aria-labelledby={tabId('meeting-tab', tab)}
        className="meetings-panel"
        data-panel={tab}
      >
        {tab === 'attendance' && <AttendanceTable meeting={meeting} now={now} />}
        {tab === 'transcript' && <MeetingTranscriptTab meeting={meeting} />}
        {tab === 'review' &&
          (meeting.review === null ? (
            <div className="meetings-review-none">
              <p>
                No review yet. Review with AI reads the transcript and proposes task changes in the
                linked space; nothing applies until someone accepts it, line by line.
              </p>
              {reviewAction}
            </div>
          ) : (
            <div className="meetings-review" data-review={meeting.review.id}>
              <dl className="meetings-review-facts">
                <div>
                  <dt>Status</dt>
                  <dd data-review-status>{meeting.review.status}</dd>
                </div>
                <div>
                  <dt>Proposals</dt>
                  <dd>{proposalWords(meeting.review.proposals)}</dd>
                </div>
              </dl>
              <a
                className="meetings-review-open"
                href={reviewHref(meeting.review.project_slug)}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                    return;
                  event.preventDefault();
                  onNavigate(reviewHref(meeting.review?.project_slug ?? ''));
                }}
              >
                Open review
                <Icon name="arrow-right" size="small" />
              </a>
            </div>
          ))}
      </div>
    </article>
  );
}

/** When someone was there, or that they were not; a meeting still to come is just *invited*. */
function AttendanceTable({
  meeting,
  now,
}: {
  readonly meeting: MeetingDetail;
  readonly now: number;
}) {
  const over = meeting.scheduled_end < now;
  return (
    <table className="meetings-attendance">
      <thead>
        <tr>
          <th scope="col">Person</th>
          <th scope="col">Joined</th>
          <th scope="col">Left</th>
          <th scope="col">Time</th>
        </tr>
      </thead>
      <tbody>
        {meeting.attendees.map((person) => (
          <tr
            key={person.email}
            data-attendee={person.email}
            data-me={person.is_me ? 'true' : undefined}
          >
            <th scope="row">
              <span className="meetings-person">{person.name}</span>
              {person.is_me && <span className="meetings-tag">You</span>}
              {person.is_organiser && <span className="meetings-tag">Organiser</span>}
            </th>
            {person.joined_at === null ? (
              <td colSpan={3} className="meetings-absent">
                {over ? 'Didn’t join' : 'Invited'}
              </td>
            ) : (
              <>
                <td>{clockTime(person.joined_at)}</td>
                <td>{person.left_at === null ? '—' : clockTime(person.left_at)}</td>
                <td>{formatDuration(person.minutes)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
