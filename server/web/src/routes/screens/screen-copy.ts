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
  '/timeline': {
    headline: 'No sprints to lay out yet',
    body: 'The timeline draws sprints against dates once a project has them.',
  },
  '/sprints': {
    headline: 'No sprints yet',
    body: 'A sprint groups tasks into a window with a start and an end. Create one from a project.',
  },
  '/capacity': {
    headline: 'Nothing assigned in progress',
    body: 'Capacity shows who — human or agent — is on what right now, from heartbeats and in-progress tasks.',
  },
  '/dashboard': {
    headline: 'No activity in this window',
    body: 'Throughput, cycle time and stuck work are derived from the activity feed. Widen the range once there is history.',
  },
  '/meeting-review': {
    headline: 'No meetings waiting on review',
    body: 'A transcript becomes proposed task changes here. Nothing applies until a human accepts it, line by line.',
  },
  '/tokens': {
    headline: 'No tokens yet',
    body: 'A personal access token lets an agent read and write this board as you. It is shown once when created.',
  },
  '/organisation': {
    headline: 'Organisation settings are not built yet',
    body: 'Members, invites, roles and the AI provider key live here.',
  },
  '/projects': {
    headline: 'No projects yet',
    body: 'Create the first one and point it at a repo.',
  },
  '/members': {
    headline: 'No project chosen',
    body: 'Open a project from Projects to see who is on it.',
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
