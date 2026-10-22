/**
 * The empty state each screen shows before its endpoints exist.
 *
 * LAI-019 AC4: every route renders **its** empty state from LAI-020, not fake
 * content and not "coming soon". These sentences say what the screen will show
 * and what it is waiting for — which is true now and stays true, rather than a
 * placeholder someone has to remember to delete.
 *
 * Copy follows `docs/design/`'s voice and reuses its sentences where the
 * prototype writes one. No fixtures: no Mira Kellner, no laika.kvelld.internal,
 * no "13/34 done" (CLAUDE.md §5.1).
 */

export interface ScreenCopy {
  readonly headline: string;
  readonly body: string;
}

export const SCREEN_COPY: Readonly<Record<string, ScreenCopy>> = {
  '/board': {
    headline: 'Nothing in this lane',
    body: 'The board shows backlog, to do, in progress, review and done for one project. It fills in once projects and tasks exist.',
  },
  '/list': {
    headline: 'No tasks to list',
    body: 'The list is the board as a table — same tasks, same filters, one row each. It fills in once the project has tasks.',
  },
  '/calendar': {
    headline: 'Nothing scheduled',
    body: 'The calendar lays tasks out by the day they are due. Laika does not store a due date yet, so the dates here are sample data and the screen says so.',
  },
  '/timeline': {
    headline: 'No sprints to lay out yet',
    body: 'The timeline draws sprints against dates once a project has them.',
  },
  '/sprints': {
    headline: 'No sprints yet',
    body: 'A sprint groups tasks into a window with a start and an end. Create one from a project.',
  },
  /*
   * Insights (LAI-796): Capacity and Usage & cost as tabs. Capacity opens
   * first, so the copy is the one Capacity carried.
   */
  '/insights': {
    headline: 'Nothing assigned in progress',
    body: 'Capacity shows who — human or agent — is on what right now, from heartbeats and in-progress tasks. Usage & cost shows what the agents spent.',
  },
  '/dashboard': {
    headline: 'No activity in this window',
    body: 'Throughput, cycle time and stuck work are derived from the activity feed. Widen the range once there is history.',
  },
  '/activity': {
    headline: 'Nothing has happened here yet',
    body: 'The live stream shows work as it lands. Agent sessions and stale tasks appear here too, so this is the one place to look when you want to know what is moving.',
  },
  '/meeting-review': {
    headline: 'No meetings waiting on review',
    body: 'A transcript becomes proposed task changes here. Nothing applies until a human accepts it, line by line.',
  },
  /*
   * Inbox (LAI-796): Review and Unlisted work as tabs. Empty is the good
   * state — nothing is waiting on this person.
   */
  '/inbox': {
    headline: 'Your inbox is clear',
    body: 'Work an agent hands back lands on Review with its proof; work nobody filed lands on Unlisted work. Both are counted beside Inbox in the sidebar.',
  },
  /*
   * The Review tab's own empty state, read by ReviewScreen — kept under the
   * address the screen had, which now redirects to the tab (LAI-796).
   *
   * The good state: every finish has been decided. Says what arrives here,
   * because a person new to the board has not seen it fill yet (D-082).
   */
  '/review': {
    headline: 'Nothing waiting for review',
    body: 'When an agent finishes a task it lands here with its proof — commits, pull request, tests. Accept it into done, or send it back with a reason the agent reads first.',
  },
  /*
   * My day (D-088, LAI-787): the reader's own, drafted on their machine and
   * confirmed by them — so the copy says where a draft comes from.
   */
  '/work': {
    headline: 'No work in your spaces yet',
    body: 'Work lists every task in the spaces you can read, across all of them at once. It fills in as tasks are created on any board.',
  },
  '/my-day': {
    headline: 'Nothing on this day yet',
    body: 'Your day is drafted on your own machine by the Laika collector when Draft my time is on, and only you see it until you confirm it. Add a meeting or a call by hand at any time.',
  },
  /*
   * Developer access (LAI-796): connecting an agent and your tokens, on one
   * page. The wizard keeps the copy Connect had.
   */
  '/developer': {
    headline: 'No tokens yet',
    body: 'A personal access token lets an agent read and write this board as you. It is shown once when created; Connect an agent makes one for you, step by step.',
  },
  '/developer/connect': {
    headline: 'No project to mirror work into',
    body: 'Setup still works without one — a session can connect and report in. Create a project and this page fills in the block its space admin commits.',
  },
  /*
   * An empty state, not an "unbuilt" notice — the screen exists (LAI-086).
   *
   * It is close to unreachable in practice, because whoever is reading it is
   * themselves in the list. It stays because every route carries copy: that is
   * what stops a routed path ever rendering a bare headline, and a screen that
   * loses its copy the moment it gains a component is one refactor away from
   * exactly that.
   */
  '/organisation': {
    headline: 'Nobody else here yet',
    body: 'Invite someone and they will appear alongside you.',
  },
  '/projects': {
    headline: 'No projects yet',
    body: 'Create the first one and point it at a repo.',
  },
  '/people': {
    headline: 'No person chosen',
    body: 'A profile opens from a person’s name — on Organisation, a Capacity card or the Dashboard’s Contributors.',
  },
  '/members': {
    headline: 'No project chosen',
    body: 'Open a project from Projects to see who is on it.',
  },
  '/spaces/:slug/settings': {
    headline: 'No such space',
    body: 'Space settings open from a space: its ⋯ menu, or the gear on its card under Spaces.',
  },
  '/login': {
    headline: 'Sign-in did not load',
    body: 'Reload the page. If it keeps happening the instance may be restarting.',
  },
  '/invite': {
    headline: 'No invite in this link',
    body: 'An invite link carries a token. Ask whoever invited you to send the full link.',
  },
  '/setup': {
    headline: 'First boot did not load',
    body: 'Reload the page. If this instance already has an owner, sign in instead.',
  },
};
