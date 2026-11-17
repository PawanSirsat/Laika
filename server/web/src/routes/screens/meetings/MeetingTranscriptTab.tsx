import { useEffect, useState } from 'react';
import {
  getMeetingTranscript,
  refusalReason,
  type MeetingDetail,
  type TranscriptLine,
} from '../../../api/meetings.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { EmptyState } from '../../../components/EmptyState.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';
import { Icon } from '../../../components/icon/Icon.tsx';
import { searchTranscript, transcriptStamp } from './meetings-derive.ts';

type TranscriptState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly lines: readonly TranscriptLine[] }
  | { readonly status: 'refused'; readonly reason: string | undefined; readonly error: unknown };

/** The words for each refusal the transcript can meet, keyed by the server's `reason`. */
function refusalWords(reason: string | undefined): { headline: string; body: string } | undefined {
  if (reason === 'not_attended') {
    return {
      headline: 'Only people in the meeting can read this',
      body: 'You were invited but did not join, so the transcript is not yours to read.',
    };
  }
  if (reason === 'no_transcript') {
    return {
      headline: 'No transcript',
      body: 'Teams did not record a transcript for this meeting. Transcription has to be turned on during the meeting.',
    };
  }
  if (reason === 'meetings_sync_off') {
    return {
      headline: 'Meetings sync is off',
      body: 'Transcripts are read from Microsoft Teams, which this instance is not connected to any more.',
    };
  }
  return undefined;
}

/**
 * What was said (LAI-1312). **Mounted only when the tab is opened**, and
 * that is when it asks — read live from Graph, kept nowhere: not in this
 * state past the tab, not in a cache, not on the server (D-005, D-056).
 * What the server already told us — no transcript, or a reader who was not
 * there — is answered without asking.
 */
export function MeetingTranscriptTab({ meeting }: { readonly meeting: MeetingDetail }) {
  const known = !meeting.has_transcript
    ? 'no_transcript'
    : !meeting.can_read_transcript
      ? 'not_attended'
      : undefined;
  const [state, setState] = useState<TranscriptState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (known !== undefined) return;
    const controller = new AbortController();
    setState({ status: 'loading' });
    getMeetingTranscript(meeting.id, controller.signal)
      .then((transcript) => {
        setState({ status: 'ready', lines: transcript.lines });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: 'refused', reason: refusalReason(error), error });
      });
    return () => {
      controller.abort();
    };
  }, [meeting.id, known, attempt]);

  const note = (
    <p className="meetings-transcript-note">
      <Icon name="info" size="small" />
      Only people in the meeting can read this. It is read from Teams when you open it and kept
      nowhere.
    </p>
  );

  const reason = known ?? (state.status === 'refused' ? state.reason : undefined);
  const words = refusalWords(reason);
  if (words !== undefined) {
    return (
      <div className="meetings-transcript" data-transcript={reason}>
        <EmptyState headline={words.headline} body={words.body} headingLevel={3} />
      </div>
    );
  }
  if (state.status === 'loading') {
    return (
      <div className="meetings-transcript">
        {note}
        <LoadingState shape="row" count={4} label="Reading the transcript from Teams" />
      </div>
    );
  }
  if (state.status === 'refused') {
    return (
      <div className="meetings-transcript" data-transcript="error">
        <ApiErrorState
          error={state.error}
          resource="the transcript"
          onRetry={() => {
            setAttempt((n) => n + 1);
          }}
        />
      </div>
    );
  }

  const shown = searchTranscript(state.lines, query);
  return (
    <div className="meetings-transcript" data-transcript="ready">
      {note}
      <label className="meetings-search meetings-transcript-search">
        <Icon name="search" size="small" />
        <span className="visually-hidden">Search the transcript</span>
        <input
          type="search"
          className="meetings-search-input"
          placeholder="Search the transcript"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </label>
      {state.lines.length === 0 ? (
        <p className="meetings-transcript-empty">The transcript is empty.</p>
      ) : shown.length === 0 ? (
        <p className="meetings-transcript-empty" role="status">
          No line says “{query.trim()}”.
        </p>
      ) : (
        <ol className="meetings-lines">
          {shown.map((line, index) => (
            <li key={`${String(line.at_ms)}-${String(index)}`} className="meetings-line">
              <span className="meetings-line-stamp">{transcriptStamp(line.at_ms)}</span>
              <span className="meetings-line-speaker">{line.speaker ?? 'Unknown speaker'}</span>
              <span className="meetings-line-text">{line.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
