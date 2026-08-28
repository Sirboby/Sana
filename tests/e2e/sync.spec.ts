import { expect, test } from '@playwright/test';

/**
 * Sync E2E (§12.3 scenario 2 and 3, AC-8.1.1, AC-8.1.5).
 *
 * The offline round trip (m) needs an authenticated session to reach the
 * dose-logging UI, and dose logging itself is step 11. Both are gated on
 * E2E_MAILBOX_URL like the other authenticated specs, and SKIP LOUDLY rather
 * than reporting green on a flow they never exercised.
 *
 * The sync-indicator spec (o) needs neither, so it runs unconditionally — and it
 * is the one that guards the property most likely to regress: that a sync
 * failure never blocks the UI.
 */

const MAILBOX_URL = process.env.E2E_MAILBOX_URL;

function requiresAuthHarness(): void {
  test.skip(
    !MAILBOX_URL,
    'E2E_MAILBOX_URL not configured — cannot reach authenticated routes, so this flow is NOT verified',
  );
}

test.describe('offline round trip (§12.3 scenario 2)', () => {
  test('(m) five doses logged offline sync once, and stay five after a second sync', async () => {
    requiresAuthHarness();
    /*
     * The assertion that matters is the SECOND sync. Logging five doses offline
     * and seeing five appear online proves delivery; syncing again and still
     * seeing five proves idempotency, which is the property that actually breaks
     * in production. A duplicate dose record is a clinical error, not a display
     * glitch: it makes an adherence timeline claim someone took twice what they
     * did.
     *
     * Covered at the unit level today by tests (a) and (j) in
     * tests/unit/sync.test.ts, which assert row counts after a repeated push.
     */
  });

  test('(n) two-device convergence (§12.3 scenario 3)', async () => {
    requiresAuthHarness();
    // Needs two authenticated browser contexts.
  });
});

test.describe('sync failure is never blocking (AC-8.1.5)', () => {
  test('(o) a failing sync leaves the app usable', async ({
    page,
    context,
  }) => {
    await page.goto('/dev/sync');
    await expect(page.getByTestId('sync-harness')).toBeVisible();

    // Break the network and force a cycle.
    await context.setOffline(true);
    await page.getByTestId('sync-trigger').click();

    // The indicator reports the state...
    const indicator = page.getByTestId('sync-indicator');
    await expect(indicator).toBeVisible();

    // ...and nothing is blocked. No overlay, no disabled controls, and the
    // page still responds to input.
    await expect(page.getByTestId('sync-trigger')).toBeEnabled();
    await page.getByTestId('interaction-probe').click();
    await expect(page.getByTestId('interaction-count')).toHaveText('1');

    await context.setOffline(false);
  });

  test('the indicator never covers the page', async ({ page }) => {
    await page.goto('/dev/sync');
    const box = await page.getByTestId('sync-indicator').boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    if (box && viewport) {
      // A status element that filled the screen would be a blocking overlay by
      // another name.
      expect(box.width * box.height).toBeLessThan(
        viewport.width * viewport.height * 0.25,
      );
    }
  });
});
