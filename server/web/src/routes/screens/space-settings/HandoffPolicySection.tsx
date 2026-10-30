import { useEffect, useState } from 'react';
import {
  getHandoffPolicy,
  handoffRefusal,
  putHandoffPolicy,
  type HandoffPolicyWire,
} from '../../../api/handoffs.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { HandoffPolicyForm } from '../../../components/agent/HandoffPolicyForm.tsx';
import type { HandoffPolicy } from '../../../components/agent/agent-states.ts';

export interface HandoffPolicySectionProps {
  readonly slug: string;
  /** `project.handoff_policy.edit` — a lead's. Everyone else reads it. */
  readonly mayEdit: boolean;
}

function toForm(wire: HandoffPolicyWire): HandoffPolicy {
  return {
    allowOtherOwners: wire.allow_other_owners,
    crossOwnerRequiresApproval: wire.cross_owner_requires_approval,
    maxHandoffs: wire.max_handoffs,
    offerTtlMinutes: wire.offer_ttl_minutes,
  };
}

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly policy: HandoffPolicyWire };

/**
 * The space's agent hand-off policy on Settings → Access (§4.74, LAI-550):
 * read from `GET /projects/:slug/handoff-policy` and, for a lead, saved on
 * each change — the Access tab's rule. A refusal is said beside the form,
 * which then shows what the server still holds.
 */
export function HandoffPolicySection({ slug, mayEdit }: HandoffPolicySectionProps) {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | undefined>(undefined);
  const [settled, setSettled] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ kind: 'loading' });
    getHandoffPolicy(slug, controller.signal)
      .then((policy) => {
        setRead({ kind: 'ready', policy });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setRead({ kind: 'error', error });
      });
    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  const save = (next: HandoffPolicy): void => {
    setSaving(true);
    setFailed(undefined);
    putHandoffPolicy(slug, {
      allow_other_owners: next.allowOtherOwners,
      cross_owner_requires_approval: next.crossOwnerRequiresApproval,
      max_handoffs: next.maxHandoffs,
      offer_ttl_minutes: next.offerTtlMinutes,
    })
      .then((policy) => {
        setRead({ kind: 'ready', policy });
      })
      .catch((cause: unknown) => {
        setFailed(handoffRefusal(cause));
      })
      .finally(() => {
        setSaving(false);
        setSettled((n) => n + 1);
      });
  };

  return (
    <section
      className="ss-card ss-handoff"
      aria-labelledby="ss-handoff-title"
      data-handoff-policy-section
    >
      <header className="ss-card-head ss-card-head-split">
        <div>
          <h2 id="ss-handoff-title">Agent hand-off</h2>
          <p>Who may take over a task from an agent, and for how long an offer stands.</p>
        </div>
        {mayEdit && read.kind === 'ready' && (
          <p className="ss-immediate">Changes save immediately</p>
        )}
      </header>
      <div className="ss-handoff-body">
        {read.kind === 'loading' && (
          <LoadingState shape="row" count={4} label="Loading the hand-off policy" />
        )}
        {read.kind === 'error' && (
          <ApiErrorState
            error={read.error}
            resource="this space’s hand-off policy"
            onRetry={() => {
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {read.kind === 'ready' && (
          <>
            <HandoffPolicyForm
              policy={toForm(read.policy)}
              onChange={save}
              mayEdit={mayEdit}
              busy={saving}
              settled={settled}
            />
            {!read.policy.is_set && (
              <p className="ss-help" data-policy-defaults>
                This space has not set a policy, so these are Laika’s defaults.
              </p>
            )}
            {failed !== undefined && (
              <p className="ss-field-error" role="alert" data-error="handoff_policy">
                Not saved: {failed}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
