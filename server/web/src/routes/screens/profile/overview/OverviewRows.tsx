import type { ReactNode } from 'react';
import type { AvailabilitySeen } from '../../../../api/availability.ts';
import type { MemberProfile } from '../../../../api/profiles.ts';
import { AgentsCard } from './AgentsCard.tsx';
import { ProjectsCard } from './ProjectsCard.tsx';
import { ReviewCard } from './ReviewCard.tsx';
import { ThisWeekCard } from './ThisWeekCard.tsx';
import { WorkCard } from './WorkCard.tsx';
import './overview.css';

/** A tab the Overview links into, when the reader has it. */
export interface TabLink {
  readonly href: string;
  readonly go: () => void;
}

/**
 * The profile's Overview (SPEC §11.4.2.1, D-139, LAI-1153): **rows of cards
 * that share a height**, the same for both kinds —
 *
 *     Work + This week
 *     Projects + Agents
 *     Activity                       (full width)
 *     Review for others + LLM tokens
 *
 * — one column on a phone. A row is a grid row, so its two cards stretch to
 * the taller one and nothing leaves a hole. Activity and LLM tokens arrive
 * built (`activity`, `usage`): they are the screen's, with props of their own.
 */
export function OverviewRows({
  profile,
  own,
  first,
  readsTime,
  availability,
  today,
  now,
  workHref,
  onWork,
  timeReport,
  setup,
  activity,
  usage,
}: {
  readonly profile: MemberProfile;
  /** The reader is the person. */
  readonly own: boolean;
  readonly first: string;
  /** May this reader read the person's time — their own, or *See everyone's analytics*. */
  readonly readsTime: boolean;
  readonly availability: AvailabilitySeen | null | undefined;
  readonly today: string;
  readonly now: number;
  /** Work, filtered to them. */
  readonly workHref: string;
  readonly onWork: () => void;
  readonly timeReport?: TabLink | undefined;
  readonly setup?: TabLink | undefined;
  readonly activity: ReactNode;
  readonly usage: ReactNode;
}) {
  const { user, window: span } = profile;
  return (
    <div className="ov" data-overview>
      <div className="ov-row" data-row="work">
        <WorkCard
          key={user.id}
          work={profile.current_work}
          delivery={profile.delivery}
          joined={{ at: user.created_at, since: span.since }}
          workHref={workHref}
          onWork={onWork}
          weeks={span.weeks}
          now={now}
        />
        <ThisWeekCard
          key={`week-${user.id}`}
          userId={user.id}
          today={today}
          reads={readsTime}
          availability={availability}
          timeReport={timeReport}
        />
      </div>

      <div className="ov-row" data-row="projects">
        <ProjectsCard key={user.id} projects={profile.projects} />
        <AgentsCard
          key={`agents-${user.id}`}
          userId={user.id}
          agents={profile.agents}
          first={first}
          own={own}
          setup={setup}
          now={now}
        />
      </div>

      {activity}

      <div className="ov-row ov-row-even" data-row="review">
        <ReviewCard review={profile.review} weeks={span.weeks} />
        {usage}
      </div>
    </div>
  );
}
