import { useEffect, useState } from 'react';
import { calendarRefusal } from '../../../api/calendar.ts';
import { reloadDirectory } from '../../../api/people-directory.ts';
import {
  getPeopleSync,
  type PeopleSync,
  savePeopleSync,
  syncPeopleNow,
} from '../../../api/people-sync.ts';
import { useGates } from '../../../api/permissions.ts';
import { timeLabel } from '../../../api/time-label.ts';
import { Avatar } from '../../../components/avatar/Avatar.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { PersonLink } from '../../../components/PersonLink.tsx';
import { Switch } from '../../../components/Switch.tsx';
import { useTheme } from '../../../theme/use-theme.ts';
import {
  leaverHeadline,
  leaverReasonWords,
  leaversNote,
  peopleCountsLine,
  peopleSyncErrorWords,
  profileNote,
  protectionWords,
} from './people-sync-derive.ts';

export interface PeopleSyncPanelProps {
  /** The Microsoft 365 connection is saved — from the calendar's own read. */
  readonly connected: boolean;
  /** The card's clock, so "4 min ago" moves with the calendar's. */
  readonly now: number;
}

type Busy = 'profile' | 'leavers' | 'sync';

/**
 * The people sync's part of the Microsoft 365 card (D-161, LAI-1330): the
 * *Photos and profile* and *Leavers* switches, the last run, and its leaver
 * review — **a dry run while Leavers is off**, so an owner sees exactly who
 * the sync would deactivate before turning it on.
 *
 * A switch saves the moment it is flipped, as the calendar's does. *Leavers*
 * is offered only with *Photos and profile* on, and only to someone who may
 * deactivate people (`user.deactivate`); the server asks both again.
 */
export function PeopleSyncPanel({ connected, now }: PeopleSyncPanelProps) {
  const gates = useGates();
  const { theme } = useTheme();
  const [view, setView] = useState<PeopleSync | undefined>(undefined);
  const [busy, setBusy] = useState<Busy | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  // Read again whenever the connection appears or goes: `connected` is in the answer.
  useEffect(() => {
    const controller = new AbortController();
    getPeopleSync(controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setView(answer);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(calendarRefusal(cause));
      });
    return () => {
      controller.abort();
    };
  }, [connected]);

  if (view === undefined) {
    return error === undefined ? null : (
      <span className="org-fact-error" role="alert">
        The people sync could not be read. {error}
      </span>
    );
  }

  const mayDeactivate = gates.org('user.deactivate');
  const run = (which: Busy, call: () => Promise<PeopleSync>): void => {
    setBusy(which);
    setError(undefined);
    call()
      .then((answer) => {
        setView(answer);
        // New faces and titles on every avatar on the page.
        if (answer.profile_enabled) void reloadDirectory();
      })
      .catch((cause: unknown) => {
        setError(calendarRefusal(cause));
      })
      .finally(() => {
        setBusy(undefined);
      });
  };
  const ago = (at: number): string => timeLabel(at, now).text;
  const review = view.leavers;
  const headline = review === null ? null : leaverHeadline(review);

  return (
    <div className="org-people-sync" data-people-sync>
      <span className="org-cal-switch" data-people-switch="profile">
        <span className="org-cal-switch-label" id="org-people-profile-label">
          Photos and profile
        </span>
        <Switch
          checked={view.profile_enabled}
          labelledBy="org-people-profile-label"
          describedBy="org-people-profile-note"
          disabled={!view.connected || busy !== undefined}
          onChange={(on) => {
            run('profile', () =>
              savePeopleSync({ profile_enabled: on, leavers_enabled: on && view.leavers_enabled }),
            );
          }}
        >
          {view.profile_enabled ? 'On' : 'Off'}
        </Switch>
        <span className="org-fact-note" id="org-people-profile-note">
          {profileNote(view)} Job titles, departments and managers show on People, profiles and
          Capacity.
        </span>
      </span>

      <span className="org-cal-switch" data-people-switch="leavers">
        <span className="org-cal-switch-label" id="org-people-leavers-label">
          Deactivate leavers
        </span>
        <Switch
          checked={view.leavers_enabled}
          labelledBy="org-people-leavers-label"
          describedBy="org-people-leavers-note"
          disabled={
            !view.profile_enabled || busy !== undefined || (!mayDeactivate && !view.leavers_enabled)
          }
          onChange={(on) => {
            run('leavers', () => savePeopleSync({ profile_enabled: true, leavers_enabled: on }));
          }}
        >
          {view.leavers_enabled ? 'On' : 'Off'}
        </Switch>
        <span className="org-fact-note" id="org-people-leavers-note">
          {leaversNote(view, mayDeactivate)}
        </span>
      </span>

      {view.profile_enabled && (
        <div className="org-cal-check" data-people-last>
          <span className="org-cal-check-head">People</span>
          <span className="org-hr-sync">
            {view.last_attempt_at === null ? (
              'No sync has finished yet.'
            ) : view.last_error !== null ? (
              <span className="org-hr-sync-error" data-people-sync-error={view.last_error.code}>
                Last sync {ago(view.last_attempt_at)} failed:{' '}
                {peopleSyncErrorWords(view.last_error)}.
              </span>
            ) : (
              <span data-people-counts>
                Last sync {ago(view.last_success_at ?? view.last_attempt_at)}
                {view.last_result === null ? '.' : `: ${peopleCountsLine(view.last_result)}.`}
              </span>
            )}
          </span>
          {review !== null && headline !== null && (
            <div className="org-leavers" data-leavers={review.state}>
              <span
                className="org-fact-note"
                data-tone={review.state === 'held' ? 'warning' : undefined}
              >
                {headline}
              </span>
              <ul className="org-leavers-list">
                {review.people.map((leaver) => {
                  const kept = protectionWords(leaver);
                  return (
                    <li key={leaver.user_id} className="org-leaver" data-leaver={leaver.user_id}>
                      <Avatar
                        name={leaver.name}
                        userId={leaver.user_id}
                        theme={theme}
                        size={28}
                        label={null}
                      />
                      <span className="org-leaver-who">
                        <PersonLink userId={leaver.user_id} className="org-person-link">
                          {leaver.name}
                        </PersonLink>
                        <span className="org-leaver-why">
                          {leaver.email} · {leaverReasonWords(leaver)}
                          {kept === null ? '' : ` · ${kept}`}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <span className="org-break-actions">
            <Button
              variant="secondary"
              busy={busy === 'sync'}
              disabled={busy !== undefined}
              onClick={() => {
                run('sync', syncPeopleNow);
              }}
            >
              Sync people now
            </Button>
          </span>
        </div>
      )}

      {error !== undefined && (
        <span className="org-fact-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
