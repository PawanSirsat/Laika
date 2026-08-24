import { ErrorState } from './ErrorState.tsx';
import { PermissionDenied, type Role } from './PermissionDenied.tsx';
import { ApiError, NetworkError } from '../api/errors.ts';

export interface ApiErrorStateProps {
  readonly error: unknown;
  /** What the caller was trying to reach — "this project", "org settings". */
  readonly resource: string;
  /** Lowest role that would be allowed, when the server does not say. */
  readonly requiredRole?: Role;
  readonly scope?: 'organisation' | 'project';
  /** Omit when retrying cannot help. Ignored for `forbidden`. */
  readonly onRetry?: (() => void) | undefined;
}

/**
 * Map a failed API call onto the right LAI-020 state.
 *
 * This exists so LAI-007 AC6 — *"`403` renders the permission-denied state,
 * **never** an empty list"* — is the **default** rather than something each
 * screen has to remember. The failure it guards against is quiet: a Viewer
 * shown "no tasks" when tasks exist has been told something false and has no
 * way to find out. Screens should render this rather than branching on status
 * codes themselves.
 *
 * Three outcomes, because there are three different remedies:
 *
 * | Cause | Rendered as | Why |
 * | --- | --- | --- |
 * | `forbidden` | permission-denied | ask someone for access; retrying cannot help |
 * | network | error, retryable | the instance may come back |
 * | anything else | error | the server said no for a reason it stated |
 */
export function ApiErrorState({
  error,
  resource,
  requiredRole = 'member',
  scope = 'project',
  onRetry,
}: ApiErrorStateProps) {
  if (error instanceof ApiError && error.code === 'forbidden') {
    // Deliberately no retry: permission is not a transient condition, and a
    // retry button here teaches people to mash it.
    return <PermissionDenied resource={resource} requiredRole={requiredRole} scope={scope} />;
  }

  if (error instanceof NetworkError) {
    return (
      <ErrorState
        headline="Could not reach the instance"
        body="The request never arrived. Check your connection — the board keeps working for anything already loaded."
        {...(onRetry === undefined ? {} : { onRetry })}
      />
    );
  }

  if (error instanceof ApiError) {
    return (
      <ErrorState
        headline={`Could not load ${resource}`}
        body={error.message}
        {...(error.requestId === undefined ? {} : { requestId: error.requestId })}
        // Only where retrying could plausibly work — a 422 will fail again.
        {...(error.retryable && onRetry !== undefined ? { onRetry } : {})}
      />
    );
  }

  return (
    <ErrorState
      headline={`Could not load ${resource}`}
      body="Something went wrong that we did not anticipate."
      {...(onRetry === undefined ? {} : { onRetry })}
    />
  );
}
