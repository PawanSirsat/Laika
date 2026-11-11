import { useCallback, useEffect, useMemo, useState } from 'react';
import { getCheckpointConsent, listAgents } from '../../../api/agents.ts';
import { getOwnSetupActivity, type SetupUser } from '../../../api/developer-setup.ts';
import { getCompatibility } from '../../../api/developer-updates.ts';
import { listPendingPairingRequests } from '../../../api/device-pairing.ts';
import { listDevices } from '../../../api/devices.ts';
import { everyPage } from '../../../api/every-page.ts';
import { listProjectSetups } from '../../../api/project-setups.ts';
import { listTokens } from '../../../api/tokens.ts';
import { getAgentVerification, type AgentVerification } from '../../../api/tool-setup.ts';
import { updateManifestOf, type UpdateManifest } from '../developer/v3/update-status.ts';
import type { SetupView } from './developer-setup-derive.ts';
import { ownSetupView, toFixCount } from './own-setup-derive.ts';

export type SetupLoad =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly view: SetupView };

export interface OwnSetup {
  readonly load: SetupLoad;
  readonly manifest: UpdateManifest | 'failed' | undefined;
  /** Read everything again; what is shown stays until the answer arrives. */
  readonly reload: () => void;
  /** After a failed read: show the loading state, and read again. */
  readonly retry: () => void;
  /** The tab badge's count, once the setup is read; undefined until then or on a failed read. */
  readonly toFix: number | undefined;
}

/** Every one of your own reads, in parallel, then each live tool's verification and consent. */
async function readOwn(user: SetupUser, signal: AbortSignal): Promise<SetupView> {
  const [devices, agents, setups, tokens, pending, activity] = await Promise.all([
    listDevices(signal),
    everyPage((cursor) =>
      listAgents(signal, cursor === undefined ? { limit: 100 } : { limit: 100, cursor }),
    ),
    listProjectSetups(undefined, undefined, signal),
    everyPage((cursor) =>
      listTokens(signal, cursor === undefined ? { limit: 200 } : { limit: 200, cursor }),
    ),
    listPendingPairingRequests(signal),
    getOwnSetupActivity(signal),
  ]);
  const live = [
    ...new Set(
      [...agents.items, ...devices.data.flatMap((d) => d.agents)]
        .filter((a) => a.status === 'active')
        .map((a) => a.id),
    ),
  ];
  // One tool's verification or consent failing to read leaves that tool
  // `unverified` (or *Not given*), never the whole tab unread.
  const [verified, consented] = await Promise.all([
    Promise.allSettled(live.map((id) => getAgentVerification(id, signal))),
    Promise.allSettled(live.map((id) => getCheckpointConsent(id, signal))),
  ]);
  const verifications = new Map<string, AgentVerification>();
  const consents = new Map<string, boolean>();
  live.forEach((id, i) => {
    const v = verified[i];
    const c = consented[i];
    if (v?.status === 'fulfilled') verifications.set(id, v.value);
    if (c?.status === 'fulfilled') consents.set(id, c.value.given);
  });
  return ownSetupView({
    now: activity.now,
    user,
    devices: devices.data,
    agents: agents.items,
    verifications,
    consents,
    setups,
    tokens: tokens.items,
    pending: pending.data,
    activity: activity.data,
  });
}

/**
 * Your own developer setup for your profile (LAI-1156): read once when your
 * own profile opens — without waiting on it, so the head draws first — for
 * the Developer access tab and its *N to fix* badge (D-139 item 5). Your own
 * reads write no look. `user` undefined reads nothing: someone else's
 * profile never asks.
 */
export function useOwnSetup(user: SetupUser | undefined): OwnSetup {
  const [load, setLoad] = useState<SetupLoad>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [manifest, setManifest] = useState<UpdateManifest | 'failed' | undefined>(undefined);
  const id = user?.id;
  const name = user?.name;
  const role = user?.org_role;
  const active = user?.is_active;

  useEffect(() => {
    if (id === undefined || name === undefined || role === undefined || active === undefined) {
      return;
    }
    const controller = new AbortController();
    readOwn({ id, name, org_role: role, is_active: active }, controller.signal)
      .then((view) => {
        if (!controller.signal.aborted) setLoad({ kind: 'ready', view });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [id, name, role, active, attempt]);

  useEffect(() => {
    if (id === undefined) return;
    const controller = new AbortController();
    getCompatibility(controller.signal)
      .then((body) => {
        if (!controller.signal.aborted) setManifest(updateManifestOf(body) ?? 'failed');
      })
      .catch(() => {
        if (!controller.signal.aborted) setManifest('failed');
      });
    return () => {
      controller.abort();
    };
  }, [id]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);
  const retry = useCallback(() => {
    setLoad({ kind: 'loading' });
    setAttempt((n) => n + 1);
  }, []);
  const toFix = useMemo(
    () => (load.kind === 'ready' ? toFixCount(load.view, manifest) : undefined),
    [load, manifest],
  );
  return { load, manifest, reload, retry, toFix };
}
