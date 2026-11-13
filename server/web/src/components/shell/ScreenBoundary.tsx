import {
  Component,
  createElement,
  lazy,
  Suspense,
  useEffect,
  useState,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import type { ScreenChunk } from '../../routes/route-table.ts';
import {
  arrivedChunk,
  ChunkLoadError,
  loadChunk,
  type ChunkModule,
} from '../../routes/screen-chunks.ts';
import { ErrorState } from '../ErrorState.tsx';
import { LoadingState, type SkeletonShape } from '../LoadingState.tsx';

/**
 * How long a screen's chunk may take before the loading state appears
 * (LAI-1219). A chunk from cache or a preload lands well inside this, and a
 * skeleton that flashes for one frame reads as a flicker rather than as
 * progress.
 */
export const SCREEN_LOADING_DELAY_MS = 300;

/**
 * A screen from a lazily loaded chunk (LAI-1219): `React.lazy` over
 * `loadChunk`, with one difference that matters. `React.lazy` remembers a
 * rejection for good, so a chunk that failed once would fail on every render
 * after — Try again could not work. This component swaps in a fresh `lazy`
 * the first time it renders after a failure, and `loadChunk` has already
 * forgotten the failed fetch, so the retry really asks the network again.
 */
export function lazyScreen<K extends ScreenChunk, P extends object>(
  chunk: K,
  pick: (module: ChunkModule<K>) => ComponentType<P>,
): ComponentType<P> {
  let failed = false;
  const make = () =>
    lazy(async () => {
      try {
        return { default: pick(await loadChunk(chunk)) };
      } catch (error) {
        failed = true;
        throw error;
      }
    });
  let current = make();
  function LazyScreen(props: P) {
    // Chosen once per mount: switching between the lazy wrapper and the real
    // component on a later render would remount the screen and lose its state.
    // A mount that suspended is discarded, so the choice is made again once
    // the chunk is in.
    const [Screen] = useState<ComponentType<P>>(() => {
      const ready = arrivedChunk(chunk);
      if (ready !== undefined) return pick(ready);
      if (failed) {
        failed = false;
        current = make();
      }
      return current as ComponentType<P>;
    });
    return createElement(Screen, props);
  }
  LazyScreen.displayName = `LazyScreen(${chunk})`;
  return LazyScreen;
}

/** The shared loading state, after {@link SCREEN_LOADING_DELAY_MS} and not before. */
function DelayedLoading({ shape, label }: { readonly shape: SkeletonShape; readonly label: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setShown(true);
    }, SCREEN_LOADING_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  if (!shown) return <div data-screen-loading="pending" />;
  return (
    <div data-screen-loading="shown">
      <LoadingState shape={shape} count={3} label={label} />
    </div>
  );
}

interface BoundaryProps {
  /** Who is loading, for the loading state's announcement: "Loading Board". */
  readonly label: string;
  readonly shape: SkeletonShape;
  readonly children: ReactNode;
}

/**
 * Where a lazily loaded screen waits and where it fails (LAI-1219).
 *
 * While the chunk is on its way: nothing at first, then the shared loading
 * state. If it will not load: the shared error state with Try again, which
 * fetches the chunk again — never a blank page. Any **other** error a screen
 * throws is not this boundary's to soften, so it is thrown on up, exactly as
 * it was before screens were split.
 *
 * The caller keys it by path, so moving to another page starts clean.
 */
export class ScreenBoundary extends Component<BoundaryProps, { error: unknown }> {
  override state: { error: unknown } = { error: undefined };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    if (error instanceof ChunkLoadError) {
      console.error(error.message, error.cause, info.componentStack);
    }
  }

  private readonly retry = (): void => {
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error !== undefined) {
      if (!(error instanceof ChunkLoadError)) throw error;
      return (
        <div data-screen-failed={error.chunk}>
          <ErrorState
            headline="This page didn’t load"
            body="Part of Laika could not be fetched — the connection dropped, or a new version was released since this page opened. Try again to fetch it."
            onRetry={this.retry}
          />
        </div>
      );
    }
    return (
      <Suspense
        fallback={<DelayedLoading shape={this.props.shape} label={`Loading ${this.props.label}`} />}
      >
        {this.props.children}
      </Suspense>
    );
  }
}
