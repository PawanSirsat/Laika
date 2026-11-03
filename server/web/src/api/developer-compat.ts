import { useEffect, useState } from 'react';
import { request } from './client.ts';

/**
 * `GET /api/v1/developer/compatibility` (LAI-1043, plan §E.6), as the web reads
 * it (LAI-1048): only `features.developer_access`, the switch that decides how
 * Developer access is shown. The rest of the body is the helper's business.
 *
 * Public and built from deployment settings only, so it is the same for every
 * reader and changes only with a restart — which is why it is read **once per
 * page load** and shared.
 */
export interface DeveloperCompatibility {
  readonly features: { readonly developer_access: string };
}

/**
 * How a deployment shows Developer access (LAI-1048, plan §I). `classic` is
 * today's five tabs, unchanged; `preview` adds the V3 tabs beside them; `v3`
 * is the V3 tabs alone, Overview first.
 */
export type DeveloperAccessMode = 'classic' | 'preview' | 'v3';

export const DEVELOPER_ACCESS_MODES: readonly DeveloperAccessMode[] = ['classic', 'preview', 'v3'];

/**
 * The mode shown when the answer cannot say one: `v3`, the server's own
 * default (LAI-1076, owner decision 2026-11-02). It was `classic` while V3
 * was opt-in (plan §I). A deployment that wants classic says so with
 * `LAIKA_DEVELOPER_ACCESS=classic`, and that answer is read as given.
 */
export const FALLBACK_MODE: DeveloperAccessMode = 'v3';

/**
 * The mode a compatibility answer names. **Anything unreadable is
 * {@link FALLBACK_MODE}**: a board without the endpoint, a failed request, or a
 * mode this build does not know all show what an unset flag would.
 */
export function developerAccessMode(body: unknown): DeveloperAccessMode {
  if (typeof body !== 'object' || body === null) return FALLBACK_MODE;
  const features = (body as { features?: unknown }).features;
  if (typeof features !== 'object' || features === null) return FALLBACK_MODE;
  const mode = (features as { developer_access?: unknown }).developer_access;
  return DEVELOPER_ACCESS_MODES.find((known) => known === mode) ?? FALLBACK_MODE;
}

/**
 * How long Developer access waits for the answer before showing the fallback
 * (LAI-1048, review round 1). The page draws nothing until the mode is known,
 * so a request that hangs would otherwise hold the whole page on its loading
 * card, in every mode.
 */
export const MODE_TIMEOUT_MS = 4_000;

export interface ModeTimer {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
}

const REAL_TIMER: ModeTimer = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

/**
 * `answer`, or {@link FALLBACK_MODE} if it has not settled within `ms` — and
 * `onTimeout`, so the caller can abort the request it no longer waits for. A
 * failed answer is the fallback too. Never rejects.
 */
export function modeWithin(
  answer: Promise<DeveloperAccessMode>,
  ms: number,
  onTimeout: () => void = () => undefined,
  timer: ModeTimer = REAL_TIMER,
): Promise<DeveloperAccessMode> {
  return new Promise((resolve) => {
    let settled = false;
    const handle = timer.set(() => {
      if (settled) return;
      settled = true;
      onTimeout();
      resolve(FALLBACK_MODE);
    }, ms);
    answer.then(
      (mode) => {
        if (settled) return;
        settled = true;
        timer.clear(handle);
        resolve(mode);
      },
      () => {
        if (settled) return;
        settled = true;
        timer.clear(handle);
        resolve(FALLBACK_MODE);
      },
    );
  });
}

let asked: Promise<DeveloperAccessMode> | undefined;
let known: DeveloperAccessMode | undefined;

/** The mode, read once for the page's life; a failure or a timeout settles as the fallback. */
export function loadDeveloperAccessMode(): Promise<DeveloperAccessMode> {
  if (asked === undefined) {
    const controller = new AbortController();
    const answer = request<DeveloperCompatibility>('/developer/compatibility', {
      signal: controller.signal,
    }).then(developerAccessMode);
    asked = modeWithin(answer, MODE_TIMEOUT_MS, () => {
      controller.abort();
    }).then((mode) => {
      known = mode;
      return mode;
    });
  }
  return asked;
}

/** `undefined` until the answer is in — a screen waits rather than guessing a mode. */
export function useDeveloperAccessMode(): DeveloperAccessMode | undefined {
  const [mode, setMode] = useState<DeveloperAccessMode | undefined>(known);
  useEffect(() => {
    if (mode !== undefined) return;
    let live = true;
    void loadDeveloperAccessMode().then((answer) => {
      if (live) setMode(answer);
    });
    return () => {
      live = false;
    };
  }, [mode]);
  return mode;
}

/**
 * Where a device gets the helper (LAI-1061, plan §E.6, §F.6): the repository
 * and the commit this board was built from. `commit` is `null` on a build
 * that does not know its own commit, which the screen says rather than
 * guessing a branch.
 */
export interface CliSource {
  readonly url: string;
  readonly commit: string | null;
}

/**
 * `cli.source` from a compatibility answer, or `undefined` when it has none
 * a device could clone from — an older board, or a body this build cannot
 * read. Only an `http(s)` or `ssh`/`git@` address is accepted, and a commit
 * only as hex: both are pasted into a terminal.
 */
export function cliSourceOf(body: unknown): CliSource | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const cli = (body as { cli?: unknown }).cli;
  if (typeof cli !== 'object' || cli === null) return undefined;
  const source = (cli as { source?: unknown }).source;
  if (typeof source !== 'object' || source === null) return undefined;
  const { url, commit } = source as { url?: unknown; commit?: unknown };
  if (typeof url !== 'string' || !/^(https?:\/\/|ssh:\/\/|git@)[^\s'"`$\\]+$/.test(url)) {
    return undefined;
  }
  return {
    url,
    commit: typeof commit === 'string' && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
  };
}

/** The board's helper source. Never rejects: unreadable is `undefined`. */
export function loadCliSource(signal?: AbortSignal): Promise<CliSource | undefined> {
  return request<unknown>('/developer/compatibility', signal === undefined ? {} : { signal }).then(
    cliSourceOf,
    () => undefined,
  );
}

/**
 * Which build this board is (LAI-1069, plan §J E3): the server's version and
 * the commit it was built from, and the helper protocol it speaks. `commit` is
 * `null` on a build that does not know its own commit.
 */
export interface BoardBuild {
  readonly version: string;
  readonly commit: string | null;
  readonly protocol: number;
  readonly minClient: number;
}

/**
 * `server` and `protocol` from a compatibility answer, or `undefined` when it
 * has none this build can read — an older board, or a malformed body. A commit
 * is kept only as hex, the version only as a short plain string.
 */
export function boardBuildOf(body: unknown): BoardBuild | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { server, protocol } = body as { server?: unknown; protocol?: unknown };
  if (typeof server !== 'object' || server === null) return undefined;
  if (typeof protocol !== 'object' || protocol === null) return undefined;
  const { version, build_commit: commit } = server as { version?: unknown; build_commit?: unknown };
  const { current, min_client: minClient } = protocol as {
    current?: unknown;
    min_client?: unknown;
  };
  if (typeof version !== 'string' || !/^[\w.+-]{1,40}$/.test(version)) return undefined;
  if (!Number.isInteger(current) || !Number.isInteger(minClient)) return undefined;
  return {
    version,
    commit: typeof commit === 'string' && /^[0-9a-f]{7,40}$/.test(commit) ? commit : null,
    protocol: current as number,
    minClient: minClient as number,
  };
}

/** The board's build. Never rejects: unreadable is `undefined`. */
export function loadBoardBuild(signal?: AbortSignal): Promise<BoardBuild | undefined> {
  return request<unknown>('/developer/compatibility', signal === undefined ? {} : { signal }).then(
    boardBuildOf,
    () => undefined,
  );
}

/** Which build this board is, and where its helper comes from, from one answer. */
export interface BoardFacts {
  readonly build: BoardBuild | undefined;
  readonly source: CliSource | undefined;
}

/**
 * The board's build and its helper source (LAI-1093), read in one request.
 * Never rejects: whatever is unreadable is `undefined`.
 */
export function loadBoardFacts(signal?: AbortSignal): Promise<BoardFacts> {
  return request<unknown>('/developer/compatibility', signal === undefined ? {} : { signal }).then(
    (body) => ({ build: boardBuildOf(body), source: cliSourceOf(body) }),
    () => ({ build: undefined, source: undefined }),
  );
}
