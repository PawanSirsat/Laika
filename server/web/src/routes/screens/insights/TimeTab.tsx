import { readerZone } from '../../../api/usage.ts';
import { useProjects } from '../../../api/use-projects.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { PermissionDenied } from '../../../components/PermissionDenied.tsx';
import { TimeReport } from '../../../components/time-report/TimeReport.tsx';
import { dayIn } from '../my-day/my-day-derive.ts';
import { AvailabilityView } from './AvailabilityView.tsx';
import { TimeViews } from './TimeViews.tsx';
import './time-tab.css';
import type { TimeSubview } from './time-tab.ts';

export interface TimeTabProps {
  /** `org` for the organisation's report, `space` for a space admin's weeks. */
  readonly view: 'org' | 'space' | 'none';
  /** The spaces the reader leads, by id (§3.2 `time.report.read_project`). */
  readonly leads: readonly string[];
  readonly orgName?: string | undefined;
  /** `&view=` (LAI-1139): the Time report, or who has room for more work. */
  readonly subview?: TimeSubview;
  readonly onNavigate?: (to: string) => void;
}

/**
 * Insights → Time (D-130, LAI-1138; frames 1g–1i): the organisation's Time
 * report with a Member filter, people A–Z — or, for a space admin, one
 * figure a week for a space they lead (D-136, D-138). Nobody else reaches it.
 */
export function TimeTab({
  view,
  leads,
  orgName,
  subview = 'report',
  onNavigate = () => undefined,
}: TimeTabProps) {
  if (view === 'none') {
    return <PermissionDenied resource="the Time report" requiredRole="lead" scope="project" />;
  }
  // Two views under one tab (frames 1g and 2g): the same readers, the same gate.
  return (
    <div className="time-tab">
      <TimeViews current={subview} onNavigate={onNavigate} />
      {subview === 'availability' ? (
        <AvailabilityView />
      ) : (
        <TimeReportView view={view} leads={leads} orgName={orgName} />
      )}
    </div>
  );
}

function TimeReportView({
  view,
  leads,
  orgName,
}: {
  readonly view: 'org' | 'space';
  readonly leads: readonly string[];
  readonly orgName?: string | undefined;
}) {
  const today = dayIn(readerZone(), Date.now());
  const projects = useProjects();
  if (view === 'org') return <TimeReport scope="org" today={today} orgName={orgName} />;
  if (projects.status === 'loading') {
    return <LoadingState shape="card" count={1} label="Loading the spaces you lead" />;
  }
  // The spaces could not be read: say so, never "you lead no space".
  if (projects.status === 'error') {
    return (
      <ApiErrorState
        error={projects.error}
        resource="the spaces you lead"
        onRetry={projects.reload}
      />
    );
  }
  const led = projects.projects
    .filter((p) => leads.includes(p.id))
    .map((p) => ({ slug: p.slug, name: p.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return <TimeReport scope="org" today={today} ledSpaces={led} />;
}
