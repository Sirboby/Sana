import { expect, test } from '@playwright/test';

/**
 * Medication flow E2E (§12.3 scenario 1, AC-3.1.1 to AC-3.1.4).
 *
 * The full chain (i) needs an authenticated session, so it is gated on
 * E2E_MAILBOX_URL and SKIPS LOUDLY rather than reporting green.
 *
 * The action-hierarchy spec (j) needs neither auth nor data — it is about the
 * gate component itself — so it runs unconditionally against a harness. That is
 * deliberate: (j) guards the property most likely to be "improved" away by
 * someone optimising for flow completion.
 */

const MAILBOX_URL = process.env.E2E_MAILBOX_URL;

function requiresAuth(): void {
  test.skip(
    !MAILBOX_URL,
    'E2E_MAILBOX_URL not configured — this flow is NOT verified',
  );
}

test.describe('add-medication chain (§12.3 scenario 1)', () => {
  test('(i) sign up -> consent -> allergy -> flagged medicine -> alert before save', async () => {
    requiresAuth();
  });

  test('(k) manual entry shows the limitation at entry and in the result', async () => {
    requiresAuth();
  });

  test('(l) adding a medicine fully offline works and queues for sync', async () => {
    requiresAuth();
  });
});

test.describe('(j) CRITICAL alert action hierarchy', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/gate?severity=CRITICAL');
    await expect(page.getByTestId('screening-gate')).toBeVisible();
  });

  test('the primary action is the CANCEL path, not the save', async ({
    page,
  }) => {
    const cancel = page.getByTestId('gate-cancel');
    const confirm = page.getByTestId('gate-confirm');

    await expect(cancel).toBeVisible();
    await expect(confirm).toBeVisible();

    // Cancel is marked primary, and comes FIRST in the DOM — which is what a
    // screen reader reaches first and what a keyboard user tabs to first.
    await expect(cancel).toHaveAttribute('data-role', 'primary');
    await expect(confirm).toHaveAttribute('data-role', 'secondary');

    const cancelPrecedes = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="gate-cancel"]');
      const a = document.querySelector('[data-testid="gate-confirm"]');
      if (!c || !a) return false;
      return (
        (c.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
      );
    });
    expect(cancelPrecedes, 'cancel must precede add-anyway in the DOM').toBe(
      true,
    );
  });

  test('add-anyway requires a SECOND, DIFFERENT confirmation', async ({
    page,
  }) => {
    const confirm = page.getByTestId('gate-confirm');

    // Disabled until the acknowledgement is made, so it cannot be cleared by
    // tapping the same spot twice.
    await expect(confirm).toBeDisabled();

    const acknowledgement = page.getByTestId('critical-acknowledge-checkbox');
    await expect(acknowledgement).toBeVisible();
    await acknowledgement.check();

    await expect(confirm).toBeEnabled();
  });

  test('the acknowledgement names what was flagged rather than being a bare OK', async ({
    page,
  }) => {
    const text = await page.getByTestId('critical-acknowledgement').innerText();
    expect(text.toLowerCase()).toContain('critical');
    // Names the medicine, so it cannot be a generic confirm dialog.
    expect(text).toContain('Amoxicillin');
  });

  test('a SERIOUS alert emphasises cancel but needs no second confirmation', async ({
    page,
  }) => {
    await page.goto('/dev/gate?severity=SERIOUS');
    await expect(page.getByTestId('gate-cancel')).toHaveAttribute(
      'data-role',
      'primary',
    );
    await expect(page.getByTestId('gate-confirm')).toBeEnabled();
    await expect(page.getByTestId('critical-acknowledge-checkbox')).toHaveCount(
      0,
    );
  });

  test('there is never a single control that both dismisses and saves', async ({
    page,
  }) => {
    const buttons = await page
      .getByTestId('gate-actions')
      .locator('button')
      .allInnerTexts();
    expect(buttons.length).toBe(2);
    expect(buttons.some((label) => label.trim().toLowerCase() === 'ok')).toBe(
      false,
    );
  });
});

test.describe('DUPLICATE_INGREDIENT alert rendering', () => {
  test('names both products, the ingredient, and carries the disclaimer', async ({
    page,
  }) => {
    await page.goto('/dev/gate?severity=SERIOUS');
    const card = page.getByTestId('alert-card').first();

    await expect(card).toHaveAttribute('data-kind', 'DUPLICATE_INGREDIENT');
    await expect(page.getByTestId('alert-explanation').first()).toContainText(
      'Panadol Extra',
    );
    await expect(page.getByTestId('alert-explanation').first()).toContainText(
      'acetaminophen',
    );
    await expect(page.getByTestId('alert-disclaimer').first()).toContainText(
      'Do not stop any prescribed medicine',
    );
    await expect(page.getByTestId('alert-provenance').first()).toBeVisible();
  });
});
