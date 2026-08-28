import { type SyncOutcome, sync } from './engine';
import { SYNC_DEBOUNCE_MS, SYNC_INTERVAL_MS, backoffDelayMs } from './protocol';

/**
 * Sync triggers and backoff (PRD §7.1, AC-8.1.5).
 *
 * Triggers: app foreground, the browser `online` event, after any local mutation
 * (debounced 2s), and every 5 minutes while foregrounded.
 *
 * All four can fire at once — coming back online while foregrounding after a
 * mutation is an ordinary Tuesday. They are not coordinated here because they do
 * not need to be: engine.sync() is single-flight, so overlapping triggers
 * collapse into one cycle.
 */

export type SchedulerState = {
  status: 'idle' | 'syncing' | 'failed' | 'offline';
  consecutiveFailures: number;
  lastOutcome: SyncOutcome | null;
  lastError: string | null;
  nextRetryAt: number | null;
};

type Listener = (state: SchedulerState) => void;

let state: SchedulerState = {
  status: 'idle',
  consecutiveFailures: 0,
  lastOutcome: null,
  lastError: null,
  nextRetryAt: null,
};

const listeners = new Set<Listener>();
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function emit(patch: Partial<SchedulerState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener(state);
}

export function subscribeToSync(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function syncState(): SchedulerState {
  return state;
}

/**
 * Run one cycle and fold the result into the visible state.
 *
 * A failure NEVER throws to the caller. Sync is background work; a rejected
 * promise reaching a click handler would turn a transient network blip into a
 * broken interaction, and AC-8.1.5 requires the indicator to be non-blocking.
 */
export async function triggerSync(reason: string): Promise<SyncOutcome | null> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    emit({ status: 'offline' });
    return null;
  }

  emit({ status: 'syncing' });

  try {
    const outcome = await sync();
    emit({
      status: 'idle',
      consecutiveFailures: 0,
      lastOutcome: outcome,
      lastError: null,
      nextRetryAt: null,
    });
    return outcome;
  } catch (error) {
    const failures = state.consecutiveFailures + 1;
    const delay = backoffDelayMs(failures - 1);

    emit({
      status: 'failed',
      consecutiveFailures: failures,
      lastError:
        error instanceof Error ? error.message : `Sync failed (${reason}).`,
      nextRetryAt: Date.now() + delay,
    });

    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void triggerSync('backoff-retry'), delay);
    (retryTimer as unknown as { unref?: () => void }).unref?.();

    return null;
  }
}

/** Called after a local mutation. Debounced so a burst of edits is one cycle. */
export function requestSyncSoon(): void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(
    () => void triggerSync('post-mutation'),
    SYNC_DEBOUNCE_MS,
  );
  (debounceTimer as unknown as { unref?: () => void }).unref?.();
}

/** Wire the browser triggers. Returns a teardown. No-op outside a browser. */
export function startScheduler(): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onOnline = () => void triggerSync('online');
  const onVisibility = () => {
    if (document.visibilityState === 'visible') void triggerSync('foreground');
  };

  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);

  intervalTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void triggerSync('interval');
  }, SYNC_INTERVAL_MS);

  void triggerSync('startup');

  return () => {
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisibility);
    if (intervalTimer !== null) clearInterval(intervalTimer);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    if (retryTimer !== null) clearTimeout(retryTimer);
  };
}

/** Test-only reset. */
export function __resetSchedulerForTests(): void {
  state = {
    status: 'idle',
    consecutiveFailures: 0,
    lastOutcome: null,
    lastError: null,
    nextRetryAt: null,
  };
  listeners.clear();
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  if (intervalTimer !== null) clearInterval(intervalTimer);
  if (retryTimer !== null) clearTimeout(retryTimer);
  debounceTimer = null;
  intervalTimer = null;
  retryTimer = null;
}
