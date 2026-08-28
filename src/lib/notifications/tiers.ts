/**
 * Reminder capability detection and the honest description of each tier.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AC-3.2.2 IS NOT ACHIEVABLE AS WRITTEN, AND THIS FILE SAYS SO
 * ─────────────────────────────────────────────────────────────────────────────
 * AC-3.2.2 asks for a notification with the app CLOSED and NO NETWORK. The only
 * web API that could do both — Notification Triggers / TimestampTrigger — was
 * abandoned by Chrome and never shipped to stable. Nothing implements it.
 *
 * Service-worker timers are not a substitute and must not be used as one: the
 * worker is killed when idle and `setTimeout` does not survive that. Code built
 * on it appears to work in a foregrounded tab during development and silently
 * fails on the devices it was written for.
 *
 * So there are three tiers, and the third is a documented gap rather than a
 * workaround:
 *
 *   TIER 1  Web Push       online, app closed        — the common case
 *   TIER 2  In-app due list offline, app open        — always works
 *   TIER 3  (gap)          offline AND app closed    — not possible on the web
 *
 * The copy below states that plainly. A user who trusts a reminder that never
 * fires is worse off than one who knows to open the app, and overstating this
 * would be the more damaging choice precisely because it is the more reassuring
 * one.
 */

export type PushSupport = {
  /** The browser exposes the Push API at all. */
  pushApi: boolean;
  serviceWorker: boolean;
  notifications: boolean;
  permission: NotificationPermission | 'unavailable';
  /**
   * iOS only delivers push to a PWA installed to the home screen. A Safari tab
   * cannot receive one however the permission prompt goes, so telling the user
   * otherwise would set up a reminder that can never arrive.
   */
  requiresInstall: boolean;
  /** Tier 1 can actually work here. */
  tier1Available: boolean;
};

export function detectPushSupport(): PushSupport {
  if (typeof window === 'undefined') {
    return {
      pushApi: false,
      serviceWorker: false,
      notifications: false,
      permission: 'unavailable',
      requiresInstall: false,
      tier1Available: false,
    };
  }

  const serviceWorker = 'serviceWorker' in navigator;
  const pushApi = 'PushManager' in window;
  const notifications = 'Notification' in window;

  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  const requiresInstall = isIos && !isStandalone;

  return {
    pushApi,
    serviceWorker,
    notifications,
    permission: notifications ? Notification.permission : 'unavailable',
    requiresInstall,
    tier1Available:
      serviceWorker && pushApi && notifications && !requiresInstall,
  };
}

/**
 * User-facing copy describing what reminders can and cannot do.
 *
 * Written to be accurate rather than reassuring. Every sentence here is either
 * true of the running environment or describes a limit.
 */
export const REMINDER_COPY = {
  heading: 'How reminders work',

  tier2Always:
    'Sana always shows you which doses are due when you open the app. This works with no connection and no permissions — it is the part you can rely on.',

  tier1Available:
    'If you turn on reminders, we can also send you a notification when a dose is due, even when the app is closed. This needs a connection at the time the dose is due.',

  tier1Unavailable:
    'This browser cannot send reminder notifications. Sana will still show you which doses are due whenever you open it.',

  tier1RequiresInstall:
    'On iPhone and iPad, reminder notifications only work if you add Sana to your home screen first. Until then, open the app to see which doses are due.',

  /**
   * TIER 3. The honest limit, stated in the settings screen rather than buried.
   * Someone who is offline overnight needs to know the app cannot reach them.
   */
  tier3Gap:
    'We cannot send you a reminder when you are offline AND the app is closed. No web browser can do this. If you are often without a connection, check the app when you can — the due list is always there.',

  denied:
    'Reminder notifications are turned off in your browser settings. Sana will still show due doses when you open it. You can turn them back on in your browser if you want them.',
} as const;

/** Which line applies to this environment. */
export function reminderStatusCopy(support: PushSupport): string {
  if (support.permission === 'denied') return REMINDER_COPY.denied;
  if (support.requiresInstall) return REMINDER_COPY.tier1RequiresInstall;
  if (!support.tier1Available) return REMINDER_COPY.tier1Unavailable;
  return REMINDER_COPY.tier1Available;
}
