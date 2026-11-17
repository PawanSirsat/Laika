import { useEffect, useRef, useState } from 'react';
import {
  acceptReview,
  getTaskRounds,
  sendBackReview,
  type TaskRounds,
} from '../../../api/review.ts';
import { useAction } from '../../../components/toast/use-action.ts';

/**
 * **A task's rounds, read once** (LAI-1117) — for the state panel, the proof
 * and the feed's finish summaries — keyed on `updated_at`, which the store
 * keeps current from the stream. Shared by the drawer's panel and the
 * Workroom page (LAI-1199), moved here unchanged from `TaskDetailPanel`.
 */
export interface RoundsRead {
  readonly rounds: TaskRounds | undefined;
  readonly failed: boolean;
}

export function useTaskRounds(taskId: string, updatedAt: number): RoundsRead {
  const [roundsRead, setRoundsRead] = useState<RoundsRead>({ rounds: undefined, failed: false });
  useEffect(() => {
    const controller = new AbortController();
    setRoundsRead((was) => ({ rounds: was.rounds, failed: false }));
    getTaskRounds(taskId, controller.signal)
      .then((answer) => {
        if (!controller.signal.aborted) setRoundsRead({ rounds: answer, failed: false });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setRoundsRead((was) => ({ rounds: was.rounds, failed: true }));
      });
    return () => {
      controller.abort();
    };
  }, [taskId, updatedAt]);
  return roundsRead;
}

export interface TaskReview {
  readonly deciding: 'accept' | 'send_back' | null;
  readonly accept: () => void;
  /** The Send back dialog is open. */
  readonly sendingBack: boolean;
  /** The server's reason the last send-back was refused, for the dialog's reason field. */
  readonly sendBackError: string | undefined;
  /** Open the dialog; focus returns to `opener` when it closes. */
  readonly openSendBack: (opener: HTMLElement | null) => void;
  readonly closeSendBack: () => void;
  readonly sendBack: (reason: string) => void;
  readonly sendBackOpener: () => HTMLElement | null;
}

/**
 * **Accept and Send back** (D-129 item 5; *Accept*, D-146): the Review
 * screen's endpoints, offered to the reader the server lets decide. Either
 * ends in a toast (LAI-1310) — *LAI-12 accepted*, or the refusal as the
 * server words it. No Undo: a decision is a new round's start, not a field
 * the server can put back. `onDecided` runs after either succeeds.
 *
 * A refused send-back also stays in its dialog, under the reason, so the
 * reason somebody wrote is still there to fix and send again.
 */
export function useTaskReview(taskId: string, taskKey: string, onDecided: () => void): TaskReview {
  const { run } = useAction();
  const [deciding, setDeciding] = useState<'accept' | 'send_back' | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  const [sendBackError, setSendBackError] = useState<string | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const accept = (): void => {
    setDeciding('accept');
    void run({
      do: () => acceptReview(taskId),
      success: `${taskKey} accepted`,
      failure: `Couldn’t accept ${taskKey}`,
    }).then((done) => {
      setDeciding(null);
      if (done !== undefined) onDecided();
    });
  };
  const sendBack = (reason: string): void => {
    setDeciding('send_back');
    setSendBackError(undefined);
    void run({
      do: () => sendBackReview(taskId, reason),
      success: `${taskKey} sent back`,
      failure: `Couldn’t send ${taskKey} back`,
      onError: (cause) => {
        setSendBackError(
          cause instanceof Error && cause.message !== '' ? cause.message : 'Something went wrong.',
        );
      },
    }).then((done) => {
      setDeciding(null);
      if (done === undefined) return;
      setSendingBack(false);
      onDecided();
    });
  };
  return {
    deciding,
    accept,
    sendingBack,
    sendBackError,
    openSendBack: (from) => {
      opener.current = from;
      setSendBackError(undefined);
      setSendingBack(true);
    },
    closeSendBack: () => {
      setSendingBack(false);
    },
    sendBack,
    sendBackOpener: () => opener.current,
  };
}
