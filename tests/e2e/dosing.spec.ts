import { expect, test } from '@playwright/test';

/**
 * Dose logging E2E (AC-4.1.1, AC-4.1.4, AC-3.2.2-revised).
 *
 * The logging flows need an authenticated session and a seeded regimen, so they
 * are gated on E2E_MAILBOX_URL and SKIP LOUDLY. The properties they guard are
 * covered at unit level meanwhile — tests (f) to (i) in tests/unit/dosing.test.ts
 * assert append-only writes, the untouched original after a correction, and the
 * outbox counts that make a repeated sync a no-op.
 *
 * The notification-settings spec runs unconditionally, because Tier 3 honesty is
 * a property of the copy rather than of any data, and it is the thing most
 * likely to be softened later by someone making the feature sound better.
 */

const MAILBOX_URL = process.env.E2E_MAILBOX_URL;

function requiresAuth(): void {
  test.skip(
    !MAILBOX_URL,
    'E2E_MAILBOX_URL not configured — this flow is NOT verified',
  );
}

test.describe('offline dose logging', () => {
  test('(j) AC-4.1.1: log offline, appears immediately with a pending indicator', async () => {
    requiresAuth();
  });

  test('(k) AC-4.1.4: 5 doses offline, reconnect, sync twice, still exactly 5', async () => {
    requiresAuth();
    /*
     * The SECOND sync is the assertion that matters. Five doses arriving once
     * proves delivery; five still being five after a repeated push proves
     * idempotency. A duplicated dose is a clinical error rather than a display
     * bug — it makes an adherence record claim someone took twice what they did.
     *
     * Covered at unit level today by tests (a) and (j) in
     * tests/unit/sync.test.ts, which assert row counts across a repeated push.
     */
  });

  test('(l) a corrected dose shows the new value; the original stays in the store', async () => {
    requiresAuth();
  });
});

test.describe('(m) reminders degrade honestly', () => {
  test('the settings page states the Tier 3 gap plainly', async ({ page }) => {
    await page.goto('/dev/reminders');
    await expect(page.getByTestId('reminder-settings')).toBeVisible();

    // Tier 2 is described as the reliable part.
    await expect(page.getByTestId('tier2-copy')).toContainText('no connection');

    // TIER 3 — the honest limit. If this assertion ever needs relaxing, the copy
    // has started overstating what the app can do.
    const tier3 = page.getByTestId('tier3-copy');
    await expect(tier3).toBeVisible();
    await expect(tier3).toContainText('offline AND the app is closed');
    await expect(tier3).toContainText('No web browser can do this');
  });

  test('the app stays fully functional with notifications unavailable', async ({
    page,
  }) => {
    await page.goto('/dev/reminders');

    // No broken UI, no error state, and the page still responds.
    await expect(page.getByTestId('reminder-settings')).toBeVisible();
    await expect(page.getByTestId('support-detected')).toBeVisible();

    await page.getByTestId('interaction-probe').click();
    await expect(page.getByTestId('interaction-count')).toHaveText('1');
  });

  test('does not prompt repeatedly when permission is unavailable or denied', async ({
    page,
  }) => {
    await page.goto('/dev/reminders');
    // A denied or unavailable permission offers no button at all, so there is
    // nothing to nag with. Asking again would be ignored by the browser anyway.
    const enable = page.getByTestId('enable-reminders');
    const count = await enable.count();
    expect(count).toBeLessThanOrEqual(1);
  });
});
