import { useEffect, useState } from 'react';
import { listAgents, type RegisteredAgent } from './agents.ts';
import { PRESENCE_REREAD_MS } from './capacity.ts';
import { everyPage } from './every-page.ts';

/** The caller's own registered agents, as a screen holds them (LAI-538). */
export type MyAgents =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly agents: readonly RegisteredAgent[] }
  | { readonly kind: 'error'; readonly message: string };

const NONE: readonly RegisteredAgent[] = [];

/** The agents in a {@link MyAgents}, or none until they have arrived. */
export function agentsOf(state: MyAgents): readonly RegisteredAgent[] {
  return state.kind === 'ready' ? state.agents : NONE;
}

export interface MyAgentsOptions {
  /**
   * Read again, quietly, when the window comes back and every
   * {@link PRESENCE_REREAD_MS} while it is shown (LAI-1102 review): the task
   * drawer's *Starts automatically on …* comes from each agent's launcher, and
   * must not outlive the three minutes the board calls a report *on*. A quiet
   * read that fails keeps what is shown; one that brings nothing new changes
   * nothing, so a list the reader is in does not move.
   */
  readonly refresh?: boolean;
}

/**
 * `GET /agents`, every page, once per mount — and again quietly with
 * `refresh`. Every role may read its own agents (§3.1 `agent.read_own`); the
 * answer is the caller's and nobody else's, so it can name no agent the
 * reader may not see.
 */
export function useMyAgents(options: MyAgentsOptions = {}): MyAgents {
  const refresh = options.refresh === true;
  const [state, setState] = useState<MyAgents>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const read = (quiet: boolean): void => {
      everyPage((cursor) =>
        listAgents(
          controller.signal,
          cursor === undefined ? { limit: 100 } : { limit: 100, cursor },
        ),
      )
        .then(({ items }) => {
          setState((was) =>
            was.kind === 'ready' && JSON.stringify(was.agents) === JSON.stringify(items)
              ? was
              : { kind: 'ready', agents: items },
          );
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || quiet) return;
          setState({
            kind: 'error',
            message: cause instanceof Error ? cause.message : 'Could not load your agents.',
          });
        });
    };
    read(false);
    const again = (): void => {
      if (document.visibilityState === 'visible') read(true);
    };
    const timer = refresh ? setInterval(again, PRESENCE_REREAD_MS) : undefined;
    if (refresh) {
      window.addEventListener('focus', again);
      document.addEventListener('visibilitychange', again);
    }
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [refresh]);
  return state;
}
