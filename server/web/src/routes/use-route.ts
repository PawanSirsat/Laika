import { useCallback, useEffect, useMemo, useState } from 'react';
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
  readonly setParams: (next: URLSearchParams) => void;
}

function currentPath(): string {
  const { pathname } = window.location;
  return pathname === '/' ? DEFAULT_PATH : pathname;
}

function currentSearch(): string {
  return window.location.search;
}

export function useRoute(): UseRoute {
  const [path, setPath] = useState<string>(() => currentPath());
  const [search, setSearch] = useState<string>(() => currentSearch());

  const navigate = useCallback((to: string): void => {
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
  const setParams = useCallback((next: URLSearchParams): void => {
    const query = next.toString();
    const url = query === '' ? window.location.pathname : `${window.location.pathname}?${query}`;
    window.history.replaceState({}, '', url);
    setSearch(query === '' ? '' : `?${query}`);
  }, []);

  // Back and forward buttons. Without this the URL changes and the view does
  // not, which is the classic hand-rolled-router bug.
  useEffect(() => {
    const onPop = (): void => {
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
