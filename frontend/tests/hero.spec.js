import { test, expect } from '@playwright/test';

// The homepage hero's promises, on every device in playwright.config.js.

test('hero CTAs sit inside the first screen', async ({ page }) => {
  await page.goto('/');
  const cta = page.getByRole('link', { name: /Build with ManagerXP/ });
  await expect(cta).toBeVisible();
  const box = await cta.boundingBox();
  const vh = page.viewportSize().height;
  expect(box.y + box.height, 'primary CTA is below the fold').toBeLessThanOrEqual(vh);
});

test('desktop nav stays on one line', async ({ page }) => {
  test.skip(page.viewportSize().width < 1024, 'phones and tablets use the menu button');
  await page.goto('/');
  const bar = page.locator('nav[aria-label="Main"] > .wrap');
  const height = (await bar.boundingBox()).height;
  expect(height, 'nav bar wrapped onto a second line').toBeLessThanOrEqual(80);
  for (const label of ['Custom Development', "Let's build together", 'Sign in']) {
    const link = page.locator('nav[aria-label="Main"] > .wrap').getByText(label, { exact: true }).first();
    const lines = await link.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines, `"${label}" wraps`).toBeLessThanOrEqual(1);
  }
});

test('phones and reduced motion never download the 3D scene', async ({ browser }, info) => {
  const device = info.project.use;
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const ctx = await browser.newContext({ ...device, reducedMotion });
    const page = await ctx.newPage();
    const errors = [];
    const sceneRequests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => /heroScene|scene3d|node_modules\/\.vite\/deps\/three/.test(r.url()) && sceneRequests.push(r.url()));
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await page.waitForTimeout(2500);
    const phone = page.viewportSize().width < 1024;
    if (phone || reducedMotion === 'reduce') {
      expect(sceneRequests, `3D downloaded (${reducedMotion})`).toEqual([]);
      await expect(page.locator('main canvas')).toHaveCount(0);
    }
    // The still poster is always there to show.
    await expect(page.locator('main section img[src*="network-poster"]')).toHaveCount(1);
    expect(errors).toEqual([]);
    await ctx.close();
  }
});
