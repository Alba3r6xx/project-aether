// Project Aether — E2E smoke tests (AUDIT H18)
//
// Basic smoke tests for critical user flows. These run against the dev server
// with no Supabase configured (empty-state mode) so they work in any env.
//
// Requires: npm install -D @playwright/test && npx playwright install

import { test, expect } from '@playwright/test';

test.describe('Smoke tests (no Supabase)', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Project Aether/);
  });

  test('dashboard renders empty state', async ({ page }) => {
    await page.goto('/dashboard');
    // In no-Supabase mode, the dashboard shows an empty state message.
    await expect(page.locator('text=No sensor nodes reporting yet')).toBeVisible({ timeout: 10000 });
  });

  test('history page loads', async ({ page }) => {
    await page.goto('/history');
    await expect(page.locator('h1')).toContainText('History');
  });

  test('analytics page loads', async ({ page }) => {
    await page.goto('/analytics');
    await expect(page.locator('h1')).toContainText('Analytics');
  });

  test('login page loads', async ({ page }) => {
    await page.goto('/login');
    // Login page should have a form (only visible when Supabase is configured,
    // but the page itself should always render).
    await expect(page).toHaveTitle(/Project Aether/);
  });

  test('health endpoint returns 200', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.status).toBeDefined();
  });

  test('skip-to-content link is present', async ({ page }) => {
    await page.goto('/');
    const skipLink = page.locator('a[href="#main-content"]');
    await expect(skipLink).toBeAttached();
  });
});
