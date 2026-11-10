'use client';
import { createContext, lazy, Suspense, useContext, type ComponentProps, type ComponentType } from 'react';

// Code-split screens (tabs and panels) loaded on demand, with recovery when their code file fails to download:
// - a failed download is tried once more after a short wait;
// - if it fails again with a chunk error (network blip, or an older deployment's files are gone), the page reloads
//   itself once; a second reload within 60 s is not done, the error goes to the nearest TabErrorBoundary instead;
// - "Try again" in the boundary bumps LazyAttempt, which makes every lazy screen below it load its code again
//   (React.lazy remembers a failed load forever, so a new lazy component is created per attempt).
export const LazyAttempt = createContext(0);

const RELOAD_KEY = 'ryzevo:chunk-reload-at';
const RETRY_DELAY_MS = 1500;

export function isChunkLoadError(error: unknown): boolean {
  const e = error as { name?: string; message?: string } | null;
  return Boolean(e && (e.name === 'ChunkLoadError'
    || /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(e.message || '')));
}

// Reloads the page once per 60 s; returns false when a reload was already tried (or storage is unavailable).
export function reloadOnceForChunkError(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch { return false; }
  window.location.reload();
  return true;
}

export async function loadWithRetry<T>(load: () => Promise<T>): Promise<T> {
  try { return await load(); }
  catch {
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
    try { return await load(); }
    catch (error) {
      if (isChunkLoadError(error) && typeof window !== 'undefined' && reloadOnceForChunkError()) return new Promise<T>(() => { /* reloading */ });
      throw error;
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyTab<C extends ComponentType<any>>(load: () => Promise<{ default: C }>, Fallback?: ComponentType) {
  type P = ComponentProps<C>;
  const byAttempt = new Map<number, ComponentType<P>>();
  function LazyScreen(props: P) {
    const attempt = useContext(LazyAttempt);
    let Screen = byAttempt.get(attempt);
    if (!Screen) { Screen = lazy(() => loadWithRetry(load)) as unknown as ComponentType<P>; byAttempt.set(attempt, Screen); }
    return <Suspense fallback={Fallback ? <Fallback /> : null}><Screen {...props} /></Suspense>;
  }
  return LazyScreen;
}
