import { useEffect, useState } from 'react';
import type { OwnLocalActivity } from '../../../api/local-activity.ts';
import { getPersonLocalActivity } from '../../../api/people-analytics.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Spinner } from '../../../components/Spinner.tsx';
import { dayLabel, HeldDays } from '../connect/HeldDays.tsx';

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly held: OwnLocalActivity };

/**
 * A member's shared local activity **as they see it** (D-102 rule 1,
 * LAI-959): the fourteen days Connect shows them under *What the board holds
 * for you*, in the same table, from `GET /people/:id/local-activity`. Read
 * only — nothing to delete, no switch — and the read is logged for them.
 */
export function PersonLocalActivity({
  userId,
  name,
}: {
  readonly userId: string;
  readonly name: string;
}) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ kind: 'loading' });
    getPersonLocalActivity(userId, controller.signal)
      .then((held) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', held });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [userId, attempt]);

  return (
    <section
      className="prof-card prof-held"
      aria-labelledby="prof-held-title"
      data-person-local-activity
    >
      <h2 className="prof-card-title" id="prof-held-title">
        Shared local activity · last 14 days
      </h2>
      {load.kind === 'loading' && <Spinner size="sm" label={`Reading ${name}’s local activity`} />}
      {load.kind === 'error' && (
        <ApiErrorState
          error={load.error}
          resource={`${name}’s local activity`}
          requiredRole="admin"
          scope="organisation"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      )}
      {load.kind === 'ready' &&
        (load.held.days.length === 0 ? (
          <p className="prof-hours-note" data-state="nothing-held">
            Nothing held for {name} in these 14 days
            {load.held.oldest_day === null ? ', and nothing older.' : '.'}
          </p>
        ) : (
          <HeldDays held={load.held} />
        ))}
      {load.kind === 'ready' && load.held.oldest_day !== null && (
        <p className="prof-hours-note">
          Held since {dayLabel(load.held.oldest_day)} · from{' '}
          {load.held.collectors === 1 ? 'one machine' : `${String(load.held.collectors)} machines`}{' '}
          in these days.
        </p>
      )}
    </section>
  );
}
