import { test, expect } from '@playwright/test';

/**
 * Smoke E2E — the deterministic baseline gate.
 *
 * The login page renders fully client-side (the API is only hit on submit), so this
 * passes without a running backend. Extend with authenticated flows (seed a test user,
 * log in, assert dashboard) once a test DB/fixtures exist.
 */

test('login page renders its form', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('input#email')).toBeVisible();
  await expect(page.locator('input#password')).toBeVisible();
  await expect(page.getByRole('button', { name: /^sign in$/i })).toBeVisible();
  await expect(page.getByText(/sign in to your account/i)).toBeVisible();
});

test('unauthenticated root redirects to /login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
