/*
 * Service worker — push handling only (step 11, Tier 1).
 *
 * DELIBERATELY CONTAINS NO TIMERS. A service worker is killed when idle, and
 * setTimeout does not survive that, so any schedule built here would appear to
 * work in a foregrounded dev tab and silently fail on a real device. Scheduling
 * lives on the server; this worker only renders what arrives.
 *
 * The PWA shell, caching and offline strategy are step 15.
 */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  // The notification names the medicine and nothing else. No dose, no
  // instruction — PRD 2.2 prohibitions 1 and 2 apply to a notification exactly
  // as they apply to a screen, and a lock-screen preview is more public than
  // either.
  const title = payload.title || 'A dose is due';
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'sana-dose',
    data: { url: payload.url || '/app' },
    renotify: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url ?? '/app';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing window rather than opening a second one.
        for (const client of clients) {
          if ('focus' in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
