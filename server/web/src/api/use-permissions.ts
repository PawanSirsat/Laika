import { useEffect, useState } from 'react';
import { getPermissions, type Permissions } from './permissions.ts';

/**
 * The caller's own grants (`GET /permissions`), for a screen that shows a
 * control only to whoever may use it (LAI-978).
 *
 * `undefined` while loading and after a failure: a control that is not known
 * to be allowed is not offered, and the server refuses it anyway.
 */
export function usePermissions(): Permissions | undefined {
  const [permissions, setPermissions] = useState<Permissions | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    getPermissions(controller.signal)
      .then(setPermissions)
      .catch(() => {
        setPermissions(undefined);
      });
    return () => {
      controller.abort();
    };
  }, []);
  return permissions;
}
