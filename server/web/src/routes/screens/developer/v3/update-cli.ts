import type { BoardBuild } from '../../../../api/developer-compat.ts';
import { shortCommit, updateCommand, type UpdateCommand, type UpdateKey } from './update-status.ts';

/**
 * *Update your Laika CLI* (LAI-1086): one guidance, the same everywhere a
 * developer meets an out-of-date CLI — a tool's update status, a device's
 * summary, the Overview, and the two wizards before their `laika` command.
 *
 * The owner followed V3 Project setup with a checkout 389 commits behind the
 * board and got `laika: unknown command "project"`; nothing on the page said
 * the CLI was too old, or how to update one. A CLI that old has neither
 * `laika version` nor `laika update`, so the guide has a path for it too:
 * update the git checkout the CLI runs from, forward only.
 *
 * What the board is — its build commit, its helper protocol and the oldest it
 * accepts — comes from `GET /developer/compatibility` (`boardBuildOf`), never
 * from this file. Nothing here carries a secret: the commands name the board
 * by its origin, and nothing else.
 *
 * Kept free of React so `node --test` reaches every line of it.
 */

/** Step 1: which CLI is this? Prints its commit and protocol, with no network. */
export const CHECK_COMMAND = 'laika version';

/** What a CLI that predates `laika version` answers instead. */
export const TOO_OLD_ANSWER = 'laika: unknown command "version"';

/**
 * Step 3, for a CLI without `laika update`: move the checkout it runs from
 * forward. `--ff-only` refuses rather than merge, and nothing here resets,
 * forces or stashes — a refusal leaves the checkout as it was.
 */
export const OLDER_COMMAND = 'git -C ~/laika pull --ff-only';

/** Where an install puts the checkout (plan §F.6), named in the replace note. */
export const DEFAULT_CHECKOUT = '~/laika';

/**
 * Finds the checkout without changing anything: the file the terminal's
 * `laika` points at. `plugin/scripts/install.sh` links it from the checkout's
 * `cli/bin/laika`. Tested by hand on macOS (sh, bash, zsh) and Debian 12
 * (dash, bash); with no `laika` on the PATH it prints nothing.
 */
export const FIND_COMMAND = 'readlink "$(command -v laika)"';

/** Step 4: is this machine set up for this board now? Read-only. */
export const AFTER_COMMAND = 'laika doctor';

/** What the summary line of the guide says wherever it is folded away. */
export const GUIDE_TITLE = 'How to update your Laika CLI';

/** The wizards' line before `laika device pair` / `laika tool add`. */
export const WIZARD_SUMMARY = 'Already have Laika installed? Make sure it’s current';

export type GuideStep = 'check' | 'update' | 'older' | 'after';

/** The four steps, in the order they are read. */
export const GUIDE_STEPS: readonly GuideStep[] = ['check', 'update', 'older', 'after'];

export const STEP_TITLES: Readonly<Record<GuideStep, string>> = {
  check: 'Check which CLI you have',
  update: 'Update it with laika update',
  older: 'An older CLI, without laika update',
  after: 'After updating',
};

/** The board, as its compatibility answer says it — or why it cannot be said. */
export function boardLine(build: BoardBuild | undefined): string {
  if (build === undefined) {
    return 'This board did not say which build it runs. laika update --check asks it directly.';
  }
  const accepts = `it accepts helpers from protocol ${String(build.minClient)}`;
  if (build.commit === null) {
    return `This board does not say which commit it was built from. It speaks helper protocol ${String(build.protocol)}; ${accepts}.`;
  }
  return `This board runs build ${shortCommit(build.commit)} and speaks helper protocol ${String(build.protocol)}; ${accepts}.`;
}

export interface GuideCommands {
  readonly check: string;
  /** `laika update --check`, then `laika update`, as #218 builds them for this board. */
  readonly update: UpdateCommand;
  readonly older: string;
  readonly find: string;
  readonly after: string;
}

/** Every command the guide shows, for this board's origin. */
export function guideCommands(origin: string): GuideCommands {
  return {
    check: CHECK_COMMAND,
    update: updateCommand(origin),
    older: OLDER_COMMAND,
    find: FIND_COMMAND,
    after: AFTER_COMMAND,
  };
}

/** The update statuses a tool's details link to the guide from. */
export function guideFor(key: UpdateKey | undefined): boolean {
  return key === 'available' || key === 'required' || key === 'unknown';
}

/**
 * *Version unknown*, and how to make it known: `laika update` on that device
 * sends the board its helper's version report. Worded for LAI-1085, which
 * makes it send one even when the helper is already current; until that
 * lands, it sends one when it updates.
 */
export function versionUnknownHint(device = 'that device'): string {
  return `To make its version appear, run laika update on ${device}: it reports the helper’s version to this board, even when it is already current.`;
}

export interface CliNotice {
  /** Tools whose helper the board needs updated. */
  readonly required: number;
  /** Tools whose helper has never reported a version. */
  readonly unknown: number;
}

/**
 * The Overview's quiet notice: any of the reader's tools *Update required*,
 * or with no version report. `undefined` — no notice — when every one is up
 * to date, has an update merely available, or could not be checked: a failed
 * read is not evidence of anything.
 */
export function cliNotice(statuses: Iterable<{ readonly key: UpdateKey }>): CliNotice | undefined {
  let required = 0;
  let unknown = 0;
  for (const s of statuses) {
    if (s.key === 'required') required += 1;
    else if (s.key === 'unknown') unknown += 1;
  }
  return required === 0 && unknown === 0 ? undefined : { required, unknown };
}

function tools(n: number): string {
  return `${String(n)} ${n === 1 ? 'tool' : 'tools'}`;
}

/** The notice's sentence, from its counts. */
export function cliNoticeText(notice: CliNotice): string {
  const parts: string[] = [];
  if (notice.required > 0) {
    parts.push(
      `${tools(notice.required)} ${notice.required === 1 ? 'runs' : 'run'} a Laika CLI this board needs updated`,
    );
  }
  if (notice.unknown > 0) {
    parts.push(
      `${tools(notice.unknown)} ${notice.unknown === 1 ? 'has' : 'have'} never reported a CLI version`,
    );
  }
  return `${parts.join('; ')}.`;
}
