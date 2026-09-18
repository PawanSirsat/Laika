import { useCallback, useState } from 'react';
import { FirstBootScreen, type FirstBootSubmit } from './FirstBootScreen.tsx';
import { useShell } from '../../components/shell/shell-context.ts';
import { completeSetup, fieldErrors } from '../../api/setup.ts';
import { ApiError } from '../../api/errors.ts';

/**
 * First boot (LAI-250), lifted out of `AppShell`.
 *
 * `POST /setup` **already sets the session cookie**, so there is no sign-in
 * step: on 201 the instance is configured and this browser is the Owner.
 * `markComplete()` flips the gate synchronously so the redirect effect does not
 * bounce the new Owner back to `/setup` on the next render, and `retry()`
 * re-probes `/me` to pick them up.
 */
export function SetupRoute() {
  const {
    host,
    version,
    system,
    markComplete,
    recheck,
    retry,
    route: { navigate },
  } = useShell();

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [fields, setFields] = useState<Readonly<Record<string, string>>>({});

  const submit = useCallback(
    async (values: FirstBootSubmit) => {
      setSubmitting(true);
      setError(undefined);
      setFields({});

      try {
        await completeSetup({
          orgName: values.orgName,
          ownerName: values.ownerName,
          ownerEmail: values.ownerEmail,
          ownerPassword: values.password,
          projectName: values.projectName,
        });
        markComplete();
        retry();
        navigate('/board');
      } catch (cause) {
        if (cause instanceof ApiError && cause.code === 'conflict') {
          // Someone finished setup in another tab or another browser. That is
          // not a failure of this form — the instance is ready, so say so and
          // send them to sign in rather than showing a generic error.
          setError('This Laika has already been set up. Sign in instead.');
          recheck();
          return;
        }
        if (cause instanceof ApiError && cause.code === 'unprocessable') {
          setFields(fieldErrors(cause));
          setError('Some details need fixing before this instance can be created.');
          return;
        }
        setError(cause instanceof Error ? cause.message : 'Could not create this instance.');
      } finally {
        setSubmitting(false);
      }
    },
    [markComplete, recheck, retry, navigate],
  );

  return (
    <FirstBootScreen
      system={system}
      host={host}
      version={version}
      onSubmit={(values) => {
        void submit(values);
      }}
      submitting={submitting}
      serverError={error}
      fieldErrors={fields}
    />
  );
}
