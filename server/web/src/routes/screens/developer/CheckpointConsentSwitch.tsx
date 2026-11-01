import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../../../components/Spinner.tsx';
import { Switch } from '../../../components/Switch.tsx';
import {
  agentAnchor,
  getCheckpointConsent,
  setCheckpointConsent,
  type CheckpointConsent,
  type RegisteredAgent,
} from '../../../api/agents.ts';
import type { MeProfile } from '../../../api/me.ts';
import {
  CONSENT_LABEL,
  CONSENT_MEANING,
  consentLocked,
  consentStateLine,
} from './checkpoint-consent.ts';

export interface CheckpointConsentSwitchProps {
  readonly agent: RegisteredAgent;
  readonly me: MeProfile | undefined;
  readonly canManage: boolean;
  readonly now: number;
}

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly consent: CheckpointConsent }
  | { readonly kind: 'error' };

/** The switch's section in an agent's row, which the wizard's last step links to. */
export function consentSwitchId(agentId: string): string {
  return `${agentAnchor(agentId)}-consent`;
}

/**
 * Bring an agent's switch into view and focus it, as the wizard's link means;
 * `false` when it is not on the page, so the link can fall back to its `href`.
 */
export function goToConsent(agentId: string): boolean {
  const control = document
    .getElementById(consentSwitchId(agentId))
    ?.querySelector<HTMLElement>('[role="switch"]');
  if (control === null || control === undefined) return false;
  control.scrollIntoView({ block: 'center' });
  control.focus();
  return true;
}

/**
 * *Save checkpoints automatically* on one of the owner's agents (LAI-1007,
 * D-115 item 2; API by LAI-545). The caller mounts it only for the owner
 * ({@link showsConsent}), so another person's agent never asks for it.
 *
 * **No optimistic state.** The switch shows what the server last said: a
 * press says *Saving…* and is ignored until the answer, and only the `PUT` or `DELETE`
 * answer moves it. A refusal leaves it where it was and says the server's
 * reason beside it.
 */
export function CheckpointConsentSwitch({
  agent,
  me,
  canManage,
  now,
}: CheckpointConsentSwitchProps) {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const abort = new AbortController();
    setRead({ kind: 'loading' });
    getCheckpointConsent(agent.id, abort.signal)
      .then((consent) => {
        if (!abort.signal.aborted) setRead({ kind: 'ready', consent });
      })
      .catch(() => {
        if (!abort.signal.aborted) setRead({ kind: 'error' });
      });
    return () => {
      abort.abort();
    };
  }, [agent.id, round]);

  const labelId = `${consentSwitchId(agent.id)}-label`;
  const meaningId = `${consentSwitchId(agent.id)}-meaning`;
  const stateId = `${consentSwitchId(agent.id)}-state`;
  const locked = consentLocked(agent, canManage);

  const change = (given: boolean): void => {
    if (saving || locked !== undefined) return;
    setSaving(true);
    setRefusal(undefined);
    setCheckpointConsent(agent.id, given)
      .then((consent) => {
        if (mounted.current) setRead({ kind: 'ready', consent });
      })
      .catch((cause: unknown) => {
        if (!mounted.current) return;
        setRefusal(
          cause instanceof Error && cause.message !== ''
            ? cause.message
            : 'The board did not change it.',
        );
      })
      .finally(() => {
        if (mounted.current) setSaving(false);
      });
  };

  return (
    <section
      className="agents-consent"
      id={consentSwitchId(agent.id)}
      data-consent={agent.id}
      aria-labelledby={labelId}
    >
      <span className="agents-consent-label" id={labelId}>
        {CONSENT_LABEL}
      </span>
      <p className="agents-hint agents-consent-meaning" id={meaningId}>
        {CONSENT_MEANING}
      </p>

      {read.kind === 'loading' && (
        <p className="agents-consent-state">
          <Spinner size="sm" />
          <span>Reading whether it is on…</span>
        </p>
      )}

      {read.kind === 'error' && (
        <p className="agents-consent-state" data-consent-unread>
          <span>Could not read whether automatic saves are on.</span>
          <button
            type="button"
            className="bar-control"
            onClick={() => {
              setRound((n) => n + 1);
            }}
          >
            Try again
          </button>
        </p>
      )}

      {read.kind === 'ready' && (
        <>
          <div className="agents-consent-control">
            <Switch
              className="agents-consent-switch"
              checked={read.consent.given}
              labelledBy={labelId}
              describedBy={`${meaningId} ${stateId}`}
              // Not disabled while saving: a disabled button drops keyboard
              // focus. `change` ignores a press until the answer arrives.
              disabled={locked !== undefined}
              onChange={change}
            >
              {read.consent.given ? 'On' : 'Off'}
            </Switch>
            {saving && (
              <span className="agents-consent-saving" aria-live="polite">
                <Spinner size="sm" />
                Saving…
              </span>
            )}
          </div>
          <p
            className="agents-consent-state"
            id={stateId}
            data-consent-state={read.consent.given ? 'on' : 'off'}
          >
            {consentStateLine(read.consent, me, now)}
          </p>
          {locked !== undefined && (
            <p className="agents-hint" data-consent-locked>
              {locked}
            </p>
          )}
        </>
      )}

      {refusal !== undefined && (
        <p className="agents-error" role="alert" data-consent-refusal>
          {refusal}
        </p>
      )}
    </section>
  );
}
