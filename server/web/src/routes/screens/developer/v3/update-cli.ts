import type { BoardBuild, CliSource } from '../../../../api/developer-compat.ts';
import { CHECKOUT, shellWord } from './add-flow.ts';
import { shortCommit, updateCommand, type UpdateCommand, type UpdateKey } from './update-status.ts';

/**
 * *Update your Laika CLI* (LAI-1086): one guidance, the same everywhere a
 * developer meets an out-of-date CLI — a tool's update status, a device's
 * summary, Project setup's check step, and the two wizards before their
 * `laika` command. (The Overview's own notice went with LAI-1096: a tool to
 * update is behind its Connection status chip, one click from its details.)
 *
 * The owner followed V3 Project setup with a checkout 389 commits behind the
 * board and got `laika: unknown command "project"`; nothing on the page said
 * the CLI was too old, or how to update one. A CLI that old has neither
 * `laika version` nor `laika update`, so the guide has a path for it too.
 *
 * **That path never assumes where the old checkout is** (LAI-1093). On a new
 * laptop the CLI ran from a checkout that was not at `~/laika`, and
 * `git -C ~/laika pull --ff-only` answered `cannot change to
 * '/Users/kvelld/laika'`; a checkout `laika update` left detached at the
 * board's commit refuses a plain `pull` too. So the guide shows where this
 * `laika` comes from, then installs a fresh checkout at the board's own
 * commit beside it — which works whatever the old one is, and changes
 * nothing in it.
 *
 * What the board is — its build commit, its helper protocol, the oldest it
 * accepts, and where its helper comes from — is read from
 * `GET /developer/compatibility` (`boardBuildOf`, `cliSourceOf`), never from
 * this file. Nothing here carries a secret: the commands name the board by
 * its origin and the repository by its address, and nothing else.
 *
 * Kept free of React so `node --test` reaches every line of it.
 */

/** Step 1: which CLI is this? Prints its commit and protocol, with no network. */
export const CHECK_COMMAND = 'laika version';

/** What a CLI that predates `laika version` answers instead. */
export const TOO_OLD_ANSWER = 'laika: unknown command "version"';

/**
 * Where this terminal's `laika` comes from, changing nothing: the link
 * `plugin/scripts/install.sh` made, and its target, which ends in
 * `/cli/bin/laika` — the folder that holds `cli` is the checkout. With no
 * `laika` on the PATH, `ls` says so.
 */
export const FIND_COMMAND = 'ls -l "$(command -v laika)"';

/** What the target of that link ends with. */
export const LINK_TAIL = '/cli/bin/laika';

/**
 * The fresh install's first step when {@link CHECKOUT} already exists: bring
 * the repository's history in, changing no file yet.
 */
export const FETCH_COMMAND = `git -C ${CHECKOUT} fetch origin`;

/**
 * The terminal remembers where it last found `laika`; this makes it look
 * again. `hash -r` is the one spelling zsh and bash both take — `rehash` is
 * zsh's alone, and bash answers it `command not found` (review round 1).
 */
export const REHASH_COMMAND = 'hash -r';

/**
 * For a link that `install.sh` did not replace because it sits in a folder
 * earlier on the PATH: point it at the new checkout. Only for a link — `ln
 * -sf` would replace a real file just the same, and that file is not ours.
 */
export const RELINK_COMMAND = `ln -sf ${CHECKOUT}/cli/bin/laika "$(command -v laika)"`;

/** What `install.sh` prints when it leaves a `laika` it does not own alone. */
export const SKIP_ANSWER = 'something else called laika is already on your PATH';

/** The fresh install, filled from the board's own `cli.source`. */
export interface FreshInstall {
  /** No {@link CHECKOUT} yet: clone, detach at the board's commit, link. */
  readonly text: string;
  /** {@link CHECKOUT} already exists: fetch instead of the clone, then the same two. */
  readonly existing: string;
  /**
   * The board's commit, or `null` when it does not say: then the newest on
   * the repository's default branch (`origin/HEAD`, which a clone sets).
   */
  readonly commit: string | null;
}

/**
 * The commands of a fresh install (plan §F.6, `cli/README.md`), or
 * `undefined` when the board does not say where its helper comes from — an
 * older board, or an answer this build cannot read. `install.sh
 * --no-credential` asks for no token and writes none.
 *
 * Each is one `&&` list over three lines, so the first step that fails stops
 * the rest: a clone refused because `~/laika` exists does not go on to link
 * whatever is in it.
 */
export function freshInstall(source: CliSource | undefined): FreshInstall | undefined {
  if (source === undefined) return undefined;
  const rest = [
    `git -C ${CHECKOUT} checkout --detach ${source.commit ?? 'origin/HEAD'}`,
    `${CHECKOUT}/plugin/scripts/install.sh --no-credential`,
  ];
  return {
    text: [`git clone ${shellWord(source.url)} ${CHECKOUT}`, ...rest].join(' &&\n'),
    existing: [FETCH_COMMAND, ...rest].join(' &&\n'),
    commit: source.commit,
  };
}

/** Then: forget the old path, and check. */
export const RECHECK_COMMAND = [REHASH_COMMAND, CHECK_COMMAND].join('\n');

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
  /** Where this `laika` comes from. */
  readonly find: string;
  /** A current checkout beside the old one; `undefined` when the board does not say its source. */
  readonly fresh: FreshInstall | undefined;
  readonly recheck: string;
  readonly relink: string;
  readonly after: string;
}

/** Every command the guide shows, for this board's origin and helper source. */
export function guideCommands(origin: string, source?: CliSource): GuideCommands {
  return {
    check: CHECK_COMMAND,
    update: updateCommand(origin),
    find: FIND_COMMAND,
    fresh: freshInstall(source),
    recheck: RECHECK_COMMAND,
    relink: RELINK_COMMAND,
    after: AFTER_COMMAND,
  };
}

/** The update statuses a tool's details link to the guide from. */
export function guideFor(key: UpdateKey | undefined): boolean {
  return key === 'available' || key === 'required' || key === 'unknown';
}

/**
 * *Version unknown*, and how to make it known: `laika update` on that device
 * sends the board its helper's version report — even when the helper is
 * already current, since LAI-1085 (#238).
 */
export function versionUnknownHint(device = 'that device'): string {
  return `To make its version appear, run laika update on ${device}: it reports the helper’s version to this board, even when it is already current. If laika update is an unknown command there, that CLI is older still: ${GUIDE_TITLE}, below, has the steps for it.`;
}
