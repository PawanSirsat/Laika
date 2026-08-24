import { LoadingState } from '../../../components/LoadingState.tsx';

/**
 * Timeline (LAI-082 registers it; Builder-A builds it — D-028).
 *
 * A shell, deliberately: the route and this file exist so the screen can be
 * filled in without touching `route-table.ts` or `Sidebar.tsx`, which stay
 * Builder-B's. Everything inside `routes/screens/timeline/` is Builder-A's.
 *
 * It renders the loading state rather than an empty state because it is about
 * to load something. **If that stops being true — if this sits unfilled — the
 * spinner becomes a lie and this should say what it is instead.**
 */
export function TimelineScreen() {
  return <LoadingState shape="row" count={4} label="Loading timeline" />;
}
