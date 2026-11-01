import { useEffect, useState } from 'react';
import { listAgents, type RegisteredAgent } from './agents.ts';
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

/**
 * `GET /agents`, every page, once per mount. Every role may read its own
 * agents (§3.1 `agent.read_own`); the answer is the caller's and nobody
 * else's, so it can name no agent the reader may not see.
 */
export function useMyAgents(): MyAgents {
  const [state, setState] = useState<MyAgents>({ kind: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    everyPage((cursor) =>
      listAgents(controller.signal, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }),
    )
      .then(({ items }) => {
        setState({ kind: 'ready', agents: items });
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          kind: 'error',
          message: cause instanceof Error ? cause.message : 'Could not load your agents.',
        });
      });
    return () => {
      controller.abort();
    };
  }, []);
  return state;
}
