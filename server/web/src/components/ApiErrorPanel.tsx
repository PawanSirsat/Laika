import { ErrorPanel } from './ErrorPanel.tsx';
import type { EmptyAction } from './EmptyPanel.tsx';
import { PermissionDenied, type Role } from './PermissionDenied.tsx';
import { errorCopy } from './error-copy.ts';
import { ApiError } from '../api/errors.ts';

export interface ApiErrorPanelProps {
  readonly error: unknown;
  /** What was being read, after the verb: "members", "your tokens". */
  readonly resource: string;
  /** What the caller was doing. `load` for a read; the real verb for a write. */
  readonly verb?: string | undefined;
  /** Lowest role that would be allowed, for a `forbidden` answer. */
  readonly requiredRole?: Role | undefined;
  readonly scope?: 'organisation' | 'project' | undefined;
  /** Ask again. Offered only when the failure is one a retry could fix. */
  readonly onRetry?: (() => void) | undefined;
  readonly retrying?: boolean | undefined;
  readonly help?: EmptyAction | undefined;
  readonly size?: 'compact' | 'regular' | undefined;
}

/**
 * A failed API call, drawn as the right state (LAI-1207) — `ApiErrorState`'s
 * routing with `ErrorPanel`'s words.
 *
 * `forbidden` is a permission, not a failure: it renders `PermissionDenied`,
 * with no Retry, exactly as `ApiErrorState` does (LAI-007 AC6). Everything
 * else becomes an `ErrorPanel` whose copy comes from `errorCopy`, and whose
 * Retry appears only when the failure is one a retry could fix.
 */
export function ApiErrorPanel({
  error,
  resource,
  verb = 'load',
  requiredRole = 'member',
  scope = 'project',
  onRetry,
  retrying,
  help,
  size,
}: ApiErrorPanelProps) {
  if (error instanceof ApiError && error.code === 'forbidden') {
    return <PermissionDenied resource={resource} requiredRole={requiredRole} scope={scope} />;
  }
  const copy = errorCopy(error, resource, verb);
  return (
    <ErrorPanel
      title={copy.title}
      why={copy.why}
      requestId={copy.requestId}
      kind={copy.kind}
      onRetry={copy.retryable ? onRetry : undefined}
      retrying={retrying}
      help={help}
      size={size}
    />
  );
}
