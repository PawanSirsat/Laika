/**
 * **Every screen's stylesheet, in the order the screens used to bring it**
 * (LAI-1219).
 *
 * The screens load on demand now; their CSS does not, yet. Before the split,
 * one stylesheet held every screen's CSS in the order `ScreenOutlet` imported
 * the screens, and screens leaned on that: the board's layout lived in a file
 * only Activity imported. Letting each chunk bring its own CSS would break
 * those, and would make the cascade depend on which pages someone happened
 * to open first.
 *
 * So `ScreenOutlet` imports this file first, where it imported the screens,
 * and the entry stylesheet comes out **byte for byte** as it was —
 * `screen-styles.test.ts` asserts that no screen chunk carries CSS of its
 * own, which is what keeps this list complete. A stylesheet a screen gains
 * is added here, at the place it belongs.
 *
 * Retired when each screen imports what it uses and CSS splits by screen.
 */
import '../priority-icon.css';
import '../tooltip/tooltip.css';
import '../chip/chip.css';
import '../icon/icon.css';
import '../copy-button.css';
import '../states.css';
import '../forms/button.css';
import '../overlay/overlay.css';
import '../dropdown.css';
import '../../routes/screens/board/assign.css';
import '../../routes/screens/board/tag-picker.css';
import '../agent-mark/agent-mark.css';
import '../agent/agent.css';
import '../tooltip/info-hint.css';
import '../../routes/screens/task/task-panel.css';
import '../../routes/screens/task/task-markdown.css';
import '../../routes/screens/task/forecast.css';
import '../../routes/screens/usage/usage.css';
import '../../routes/screens/task/tokens.css';
import '../../routes/screens/profile/profile.css';
import '../../routes/screens/task/evidence.css';
import '../../routes/screens/task/attachments.css';
import '../../routes/screens/task/hero.css';
import '../../routes/screens/task/delivers.css';
import '../../routes/screens/task/feed.css';
import '../confirm-dialog.css';
import '../tabs/tabs.css';
import '../markers.css';
import '../../routes/screens/task/tracked-time.css';
import '../../routes/screens/board/task-detail.css';
import '../drawer/drawer.css';
import '../toast/toast.css';
import '../forms/forms.css';
import '../create-task/create-task.css';
import '../create-task/create-task-hints.css';
import '../space/space.css';
import '../avatar/avatar.css';
// D-161 (LAI-1330): a person's title, department and manager, on three screens.
import '../person-facts/person-facts.css';
import '../size-chip.css';
import '../../routes/screens/board/column-composer.css';
import '../../routes/screens/board/board.css';
import '../state-kit.css';
import '../bulk-bar.css';
import '../../routes/screens/list/list.css';
import '../../routes/screens/board/sprint-stats.css';
import '../../routes/screens/board/board-insights.css';
// LAI-1353: the Archived panel, Insights' shape with rows.
import '../../routes/screens/board/board-archived.css';
import '../../routes/screens/board/board-toolbar.css';
import '../../routes/screens/board/column-editor.css';
import '../../routes/screens/board/view-settings.css';
import '../../routes/screens/board/board-motion.css';
import '../../routes/screens/calendar/calendar.css';
import '../screen-header.css';
import '../scroll-cue.css';
import '../kpi/kpi.css';
import '../../routes/screens/capacity/capacity.css';
import '../presence-person.css';
import '../../routes/screens/board/board-rail.css';
import '../../routes/screens/activity/activity.css';
import '../donut.css';
import '../../routes/screens/dashboard/dashboard.css';
import '../brand/brand.css';
import '../theme-switch.css';
import '../../routes/screens/auth.css';
import '../glass/glass.css';
import '../auth/auth-card.css';
import '../../routes/screens/meeting-review/meeting-review.css';
import '../../routes/screens/members.css';
import '../../routes/screens/not-found.css';
import '../page-tabs.css';
import '../switch.css';
import '../token-row.css';
import '../project-mark.css';
import '../offboarding-dialog.css';
import '../wizard/overflow-menu.css';
import '../save-status.css';
import '../../routes/screens/organisation/work-tab.css';
import '../../routes/screens/organisation/organisation.css';
import '../../routes/screens/projects/project-context.css';
import '../../routes/screens/projects.css';
import '../availability/availability.css';
import '../../routes/screens/profile/activity.css';
import '../../routes/screens/profile/admin-panel.css';
import '../side-panel.css';
import '../../routes/screens/my-day/summary.css';
import '../time-report/time-report.css';
import '../../routes/screens/my-day/day-skeleton.css';
import '../../routes/screens/my-day/overview.css';
import '../../routes/screens/my-day/wheel.css';
import '../../routes/screens/my-day/editor.css';
import '../../routes/screens/my-day/day-states.css';
import '../../routes/screens/my-day/timeline.css';
import '../../routes/screens/my-day/toast.css';
import '../../routes/screens/my-day/my-day.css';
import '../../routes/screens/my-day/lists.css';
import '../../routes/screens/my-day/phone.css';
import '../../routes/screens/my-day/span.css';
import '../../routes/screens/connect/connect.css';
import '../../routes/screens/profile/developer-setup.css';
import '../../routes/screens/profile/overview/overview.css';
import '../../routes/screens/review/review-dialog.css';
import '../../routes/screens/review/review.css';
import '../../routes/screens/sprints/sprint-key.css';
import '../../routes/screens/sprints/sprints.css';
import '../../routes/screens/timeline/timeline.css';
import '../wizard/status-chip.css';
import '../../routes/screens/tokens/tokens.css';
import '../../routes/screens/developer/devices.css';
import '../../routes/screens/developer/agents.css';
import '../../routes/screens/developer/v3/page-notices.css';
import '../../routes/screens/developer/v3/advanced.css';
import '../../routes/screens/developer/v3/activity.css';
import '../../routes/screens/developer/v3/update-cli.css';
import '../../routes/screens/developer/v3/add-wizards.css';
import '../../routes/screens/developer/v3/status-legend.css';
import '../../routes/screens/developer/v3/details-sections.css';
import '../../routes/screens/developer/v3/update-status.css';
import '../../routes/screens/developer/v3/tool-groups.css';
import '../../routes/screens/developer/v3/devices-tab.css';
import '../../routes/screens/developer/v3/repo-rows.css';
import '../../routes/screens/developer/v3/overview.css';
import '../../routes/screens/developer/v3/project-setup-design.css';
import '../../routes/screens/developer/developer.css';
import '../../routes/screens/developer/v3/v3.css';
import '../../routes/screens/developer/v3/design.css';
import '../../routes/screens/insights/insights.css';
import '../../routes/screens/insights/time-logging.css';
import '../../routes/screens/insights/time-tab.css';
import '../../routes/screens/unlisted/unlisted.css';
import '../inline-confirm.css';
import '../../routes/screens/space-settings/space-settings.css';
import '../../routes/screens/workroom/workroom.css';
import '../../routes/screens/appearance/appearance.css';
import '../state-gallery.css';
import '../../theme/token-reference.css';
