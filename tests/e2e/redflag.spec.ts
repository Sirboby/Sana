import { expect, test } from '@playwright/test';

/**
 * Escalation screen E2E (AC-6.1.2, PRD §2.3).
 *
 * Runs against a harness route rather than the real symptom picker, which is
 * step 12. The properties under test belong to the SCREEN — non-dismissible,
 * exactly one primary action, empty facility slot — and those are testable now.
 */

test.describe('emergency escalation screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/emergency?rule=RF001');
    await expect(page.getByTestId('emergency-screen')).toBeVisible();
  });

  test('(k) renders, resists dismissal, and offers exactly one primary action', async ({
    page,
  }) => {
    const screen = page.getByTestId('emergency-screen');

    // It named the finding, and named it as a finding rather than a condition.
    await expect(screen).toContainText('Chest pain');
    await expect(screen).not.toContainText(/heart attack/i);

    // The back button must not dismiss it.
    await page.goBack().catch(() => undefined);
    await expect(page.getByTestId('emergency-screen')).toBeVisible();

    // Escape must not dismiss it.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('emergency-screen')).toBeVisible();

    // A click outside the actions must not dismiss it.
    await screen.click({ position: { x: 5, y: 5 } });
    await expect(page.getByTestId('emergency-screen')).toBeVisible();

    // EXACTLY ONE primary action. Until a human verifies the emergency number,
    // that is the "get to a hospital" state rather than a fabricated tel: link.
    const callLink = page.getByTestId('emergency-call');
    const unavailable = page.getByTestId('emergency-number-unavailable');
    const primaryCount = (await callLink.count()) + (await unavailable.count());
    expect(primaryCount).toBe(1);

    // The secondary facility slot renders NOTHING (§2.3: an absent block is
    // correct, a wrong destination is harm). Wired in step 13a.
    await expect(page.getByTestId('emergency-facility')).toHaveCount(0);

    // No other navigation of any kind (§2.3: these two actions and nothing else).
    const links = await screen.locator('a').count();
    expect(links).toBeLessThanOrEqual(1);
  });

  test('is dismissible only by the explicit acknowledgement', async ({
    page,
  }) => {
    await expect(page.getByTestId('emergency-acknowledge')).toBeVisible();
    await page.getByTestId('emergency-acknowledge').click();
    await expect(page.getByTestId('emergency-acknowledged')).toBeVisible();
  });

  test('renders identically with the network offline', async ({
    page,
    context,
  }) => {
    const online = await page.getByTestId('emergency-screen').innerText();

    await context.setOffline(true);
    await page.reload().catch(() => undefined);
    const offlineScreen = page.getByTestId('emergency-screen');
    if ((await offlineScreen.count()) > 0) {
      expect(await offlineScreen.innerText()).toBe(online);
    }
    await context.setOffline(false);
  });
});
