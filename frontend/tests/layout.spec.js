import { test, expect } from '@playwright/test';

// Layout checks every public page must pass on every device in
// playwright.config.js.
const PAGES = [
  '/', '/solutions', '/products', '/products/cafexp', '/products/racexp',
  '/about', '/contact', '/demo', '/privacy-policy', '/terms-of-service',
  '/login', '/signup', '/forgot-password', '/no-such-page',
];

// Page titles are capped at 5.75rem (92px); anything bigger means a heading
// is growing with screen width again.
const MAX_HEADING_PX = 92;
const MIN_TEXT_PX = 11;

for (const path of PAGES) {
  test(`layout ${path}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(path);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const m = await page.evaluate(() => {
      const visibleText = [...document.body.querySelectorAll('*')].filter((el) =>
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) &&
        !el.closest('[aria-hidden="true"], .sr-only, [inert]') &&
        el.getBoundingClientRect().width > 0);
      const size = (el) => parseFloat(getComputedStyle(el).fontSize);
      return {
        overflow: document.documentElement.scrollWidth - window.innerWidth,
        biggest: Math.max(...visibleText.map(size)),
        tiny: visibleText.filter((el) => size(el) < 11).map((el) => `${el.textContent.trim().slice(0, 30)} (${size(el)}px)`),
      };
    });

    expect(m.overflow, 'page scrolls sideways').toBeLessThanOrEqual(0);
    expect(m.biggest, 'a heading is larger than the type scale allows').toBeLessThanOrEqual(MAX_HEADING_PX + 4);
    expect(m.tiny, `text smaller than ${MIN_TEXT_PX}px`).toEqual([]);
    expect(errors, 'JavaScript errors on the page').toEqual([]);
  });
}
