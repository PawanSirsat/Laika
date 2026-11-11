import type { ProfileReview } from '../../../../api/profiles.ts';
import { durationLabel, weekLabel } from '../profile-derive.ts';
import { Dashed, OverviewCard, Tile, WeekBars } from './OverviewCard.tsx';

/**
 * Review for others (SPEC §11.4.2.1, frame A): their decisions on work that is
 * not theirs — decided in thirty days, accepted, sent back, median to decide —
 * and accepted and sent back per week over the window. The same card for both
 * kinds (D-139 item 2): a manager's queue tiles are not on it.
 */
export function ReviewCard({
  review,
  weeks,
}: {
  readonly review: ProfileReview;
  readonly weeks: number;
}) {
  const decided = review.accepted + review.sent_back;
  return (
    <OverviewCard name="review" title="Review for others" caption={`${String(weeks)} weeks`}>
      {decided === 0 ? (
        <Dashed>No review decisions in these {weeks} weeks.</Dashed>
      ) : (
        <>
          <dl className="prof-stats ov-tiles">
            <Tile name="review_30d" label="Decided · 30 days" value={String(review.last_30_days)} />
            <Tile name="review_accepted" label="Accepted" value={String(review.accepted)} />
            <Tile name="review_sent_back" label="Sent back" value={String(review.sent_back)} />
            <Tile
              name="decide_p50"
              label="Median to decide"
              value={durationLabel(review.time_to_decide.p50_ms)}
            />
          </dl>
          <WeekBars
            label={`Review decisions per week, the last ${String(weeks)} weeks`}
            weeks={review.per_week.map((week) => ({
              week_start: week.week_start,
              values: [week.accepted, week.sent_back],
              text: `Week of ${weekLabel(week.week_start)}: ${String(week.accepted)} accepted, ${String(week.sent_back)} sent back`,
            }))}
            legend={
              <span className="prof-legend ov-legend" aria-hidden="true">
                <span className="prof-swatch" data-part="0" /> Accepted
                <span className="prof-swatch" data-part="1" /> Sent back
              </span>
            }
          />
        </>
      )}
    </OverviewCard>
  );
}
