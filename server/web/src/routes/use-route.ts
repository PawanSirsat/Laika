import { useCallback, useEffect, useMemo, useState } from 'react';
import { redirectFor } from './redirects.ts';
import { DEFAULT_PATH, matchRoute, type Route } from './route-table.ts';

/**
 * Routing on the History API, with no router dependency.
 *
 * LAI-019's Notes name no packages, and CLAUDE.md §5 says a task that does not
 * name a dependency does not get one. That is a smaller constraint than it
 * sounds: this app needs path matching, back/forward, and a link that does not
 * reload the page. When the first parameterised route arrives (`/projects/:slug`,
 * Phase 2) is the moment to reconsider — say so in a task rather than reaching
 * for a router quietly.
 */

export interface UseRoute {
  /** The current path, normalised. */
  readonly path: string;
  /** The matched route, or `undefined` for a 404. */
  readonly route: Route | undefined;
  readonly navigate: (to: string) => void;
  /**
   * The query string, as state.
   *
   * Filters live here rather than in a component so a filtered board is a
   * link someone can paste (LAI-049) — and so back and forward move through
   * filter changes the way people expect.
   */
  readonly params: URLSearchParams;
  /**
   * Write the query string.
   *
   * `push` opts a change **into** the history stack. The default is `replace`
   * — see below — but opening something the reader expects Back to close is
   * the case that needs an entry of its own (LAI-252).
   */
  readonly setParams: (next: URLSearchParams, options?: { readonly push?: boolean }) => void;
}

/**
 * Move an old address to its new home in place (LAI-796), before anything
 * reads the location. A `replace`, never a `push`: Back must not return to an
 * address whose only job is to bounce forward again.
 */
function followRedirect(): void {
  const to = redirectFor(window.location.pathname, window.location.search);
  if (to !== undefined) window.history.replaceState({}, '', `${to}${window.location.hash}`);
}

/** Where an in-app link to `to` should land — its new home, if it moved. */
function redirected(to: string): string {
  const mark = to.search(/[?#]/);
  const path = mark === -1 ? to : to.slice(0, mark);
  const rest = mark === -1 ? '' : to.slice(mark);
  const hash = rest.includes('#') ? rest.slice(rest.indexOf('#')) : '';
  const search = rest.includes('#') ? rest.slice(0, rest.indexOf('#')) : rest;
  const moved = redirectFor(path, search);
  return moved === undefined ? to : `${moved}${hash}`;
}

function currentPath(): string {
  const { pathname } = window.location;
  return pathname === '/' ? DEFAULT_PATH : pathname;
}

function currentSearch(): string {
  return window.location.search;
}

export function useRoute(): UseRoute {
  const [path, setPath] = useState<string>(() => {
    followRedirect();
    return currentPath();
  });
  const [search, setSearch] = useState<string>(() => currentSearch());

  const navigate = useCallback((link: string): void => {
    const to = redirected(link);
    if (to === window.location.pathname + window.location.search) return;
    window.history.pushState({}, '', to);
    setPath(currentPath());
    setSearch(currentSearch());
  }, []);

  /**
   * Filter changes `replace` rather than `push`.
   *
   * Pushing would make Back step through every checkbox toggle before leaving
   * the screen, which is the thing everyone hates about filter UIs.
   */
  const setParams = useCallback(
    (next: URLSearchParams, options?: { readonly push?: boolean }): void => {
      const query = next.toString();
      const url = query === '' ? window.location.pathname : `${window.location.pathname}?${query}`;
      // `push` for a state the reader will want Back to undo — opening a task
      // drawer is the case. Everything else replaces, per the rule above.
      if (options?.push === true) window.history.pushState({}, '', url);
      else window.history.replaceState({}, '', url);
      setSearch(query === '' ? '' : `?${query}`);
    },
    [],
  );

  // Back and forward buttons. Without this the URL changes and the view does
  // not, which is the classic hand-rolled-router bug.
  useEffect(() => {
    const onPop = (): void => {
      // An old address can be in the history from before LAI-796.
      followRedirect();
      setPath(currentPath());
      setSearch(currentSearch());
    };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
    };
  }, []);

  // `/` is not a screen; rewrite it so the address bar matches what is rendered.
  useEffect(() => {
    if (window.location.pathname === '/') {
      window.history.replaceState({}, '', DEFAULT_PATH);
    }
  }, []);

  const route = matchRoute(path);

  // The title is the first thing a screen reader announces after navigation and
  // the only label a browser tab carries.
  useEffect(() => {
    document.title = route === undefined ? 'Not found · Laika' : `${route.label} · Laika`;
  }, [route]);

  const params = useMemo(() => new URLSearchParams(search), [search]);

  return { path, route, navigate, params, setParams };
}
