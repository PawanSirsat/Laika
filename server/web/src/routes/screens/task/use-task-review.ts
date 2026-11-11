import { useEffect, useRef, useState } from 'react';
import {
  acceptReview,
  getTaskRounds,
  sendBackReview,
  type TaskRounds,
} from '../../../api/review.ts';

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
  readonly decideError: string | undefined;
  readonly accept: () => void;
  /** The Send back dialog is open. */
  readonly sendingBack: boolean;
  readonly sendBackError: string | undefined;
  /** Open the dialog; focus returns to `opener` when it closes. */
  readonly openSendBack: (opener: HTMLElement | null) => void;
  readonly closeSendBack: () => void;
  readonly sendBack: (reason: string) => void;
  readonly sendBackOpener: () => HTMLElement | null;
}

/**
 * **Accept and Send back** (D-129 item 5; *Accept*, D-146): the Review
 * screen's endpoints, offered to the reader the server lets decide. A refusal
 * is shown as the server words it. `onDecided` runs after either succeeds.
 */
export function useTaskReview(taskId: string, onDecided: () => void): TaskReview {
  const [deciding, setDeciding] = useState<'accept' | 'send_back' | null>(null);
  const [decideError, setDecideError] = useState<string | undefined>(undefined);
  const [sendingBack, setSendingBack] = useState(false);
  const [sendBackError, setSendBackError] = useState<string | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const accept = (): void => {
    setDeciding('accept');
    setDecideError(undefined);
    acceptReview(taskId)
      .then(onDecided)
      .catch((cause: unknown) => {
        setDecideError(
          cause instanceof Error && cause.message !== '' ? cause.message : 'Something went wrong.',
        );
      })
      .finally(() => {
        setDeciding(null);
      });
  };
  const sendBack = (reason: string): void => {
    setDeciding('send_back');
    setSendBackError(undefined);
    sendBackReview(taskId, reason)
      .then(() => {
        setSendingBack(false);
        onDecided();
      })
      .catch((cause: unknown) => {
        setSendBackError(
          cause instanceof Error && cause.message !== '' ? cause.message : 'Something went wrong.',
        );
      })
      .finally(() => {
        setDeciding(null);
      });
  };
  return {
    deciding,
    decideError,
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
