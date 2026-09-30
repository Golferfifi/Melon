import { test as base, expect, type Page } from '@playwright/test';

// Every scenario also checks for application exceptions and browser console errors.
const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await use(errors);
    expect(errors, 'The experiment should run without browser errors').toEqual([]);
  }, { auto: true }],
});

async function stat(page: Page, name: 'stretch' | 'rotation') {
  return Number(await page.locator('#scene').getAttribute(`data-${name}`));
}

async function energy(page: Page) {
  return Number(await page.locator('#energy-value').textContent());
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#scene')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('#scene')).toHaveAttribute('data-rotation', /-?\d+\.\d+/);
});

test('the 3D experiment fits desktop and small phone screens', async ({ page }, testInfo) => {
  await expect(page).toHaveTitle(/Melon Jelly/);
  await expect(page.getByRole('heading', { name: 'Melon Jelly.' })).toBeVisible();
  const widths = testInfo.project.name === 'mobile' ? [390, 360] : [1280, 1024];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() =>
      document.documentElement.scrollWidth <= window.innerWidth,
    ), { message: `No horizontal overflow at ${width}px` }).toBe(true);
    const canvas = await page.locator('#scene canvas').boundingBox();
    expect(canvas?.width).toBeGreaterThan(250);
    expect(canvas?.height).toBeGreaterThan(400);
  }
});

test('palettes and keyboard-operable sliders update; reset restores all defaults', async ({ page }) => {
  for (const [palette, name] of [['peach', 'Peach daydream'], ['golden', 'Golden hour'], ['ruby', 'Ruby summer']]) {
    await page.locator(`button[data-palette="${palette}"]`).click();
    await expect(page.locator('#palette-name')).toHaveText(name);
    await expect(page.locator('#scene')).toHaveAttribute('data-palette', palette);
    await expect(page.locator(`button[data-palette="${palette}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('button[data-palette][aria-pressed="true"]')).toHaveCount(1);
  }

  await page.getByRole('slider', { name: 'Firmness' }).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#firmness')).toHaveValue('1');
  await expect(page.locator('#firmness-value')).toHaveText('1');
  await page.getByRole('slider', { name: 'Internal damping' }).focus();
  await page.keyboard.press('End');
  await expect(page.locator('#damping')).toHaveValue('100');
  await expect(page.locator('#damping-value')).toHaveText('100');

  // These custom checkboxes are activated through their visible labels.
  await page.locator('label.check-label').filter({ hasText: '½ speed' }).click();
  await expect(page.getByLabel('½ speed', { exact: true })).toBeChecked();
  await page.locator('label.check-label').filter({ hasText: 'Show mesh' }).click();
  await expect(page.getByLabel('Show mesh', { exact: true })).toBeChecked();
  await page.locator('button[data-palette="golden"]').click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Reset the watermelon' }).click();
  await expect(page.locator('#firmness')).toHaveValue('58');
  await expect(page.locator('#damping')).toHaveValue('34');
  await expect(page.locator('#palette-name')).toHaveText('Ruby summer');
  await expect(page.locator('#scene')).toHaveAttribute('data-paused', 'false');
  await expect(page.getByLabel('½ speed', { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Show mesh', { exact: true })).not.toBeChecked();
  await expect.poll(() => energy(page)).toBe(0);
});

test('nudge animates the slice and pause freezes its motion until resumed', async ({ page }) => {
  await page.getByRole('button', { name: 'Give it a nudge' }).click();
  await expect.poll(() => energy(page)).toBeGreaterThan(0.005);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-paused', 'true');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // Allow the displayed metrics' 100ms refresh to catch up, then observe a sustained pause.
  await page.waitForTimeout(200);
  const pausedStretch = await stat(page, 'stretch');
  const pausedEnergy = await energy(page);
  await page.waitForTimeout(600);
  expect(await stat(page, 'stretch')).toBe(pausedStretch);
  expect(await energy(page)).toBe(pausedEnergy);
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-paused', 'false');
  await expect.poll(async () => Math.abs(await stat(page, 'stretch') - pausedStretch)).toBeGreaterThan(0.005);

  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Give it a nudge' }).click();
  await expect(page.locator('#scene')).toHaveAttribute('data-paused', 'false');
  await expect.poll(() => energy(page)).toBeGreaterThan(0.005);
});

test('pulling the fruit stretches it, releasing settles it, and empty-space drag rotates it', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Mouse manipulation is covered on desktop; mobile checks cover touch-sized controls and layout.');
  const box = (await page.locator('#scene canvas').boundingBox())!;
  const fruit = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
  await page.mouse.move(fruit.x, fruit.y);
  await page.mouse.down();
  await expect(page.locator('#scene')).toHaveClass(/is-grabbing/);
  await page.mouse.move(fruit.x + 125, fruit.y - 65, { steps: 8 });
  await expect.poll(() => stat(page, 'stretch')).toBeGreaterThan(0.4);
  await page.mouse.up();
  await expect(page.locator('#scene')).not.toHaveClass(/is-grabbing/);
  await expect(page.locator('button[data-palette="ruby"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[data-palette][aria-pressed="true"]')).toHaveCount(1);
  await expect.poll(() => stat(page, 'stretch'), { timeout: 25_000 }).toBeLessThan(0.02);
  await expect.poll(() => energy(page)).toBeLessThan(0.01);

  const rotation = await stat(page, 'rotation');
  const empty = { x: box.x + box.width * 0.14, y: box.y + box.height * 0.8 };
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await expect(page.locator('#scene')).not.toHaveClass(/is-grabbing/);
  await page.mouse.move(empty.x + 180, empty.y - 20, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => stat(page, 'rotation')).toBeGreaterThan(rotation + 0.7);
});

test('sound and the experiment explanation can be toggled', async ({ page }) => {
  await page.locator('#sound').click();
  await expect(page.getByRole('button', { name: 'Turn sound off' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Give it a nudge' }).click();
  await page.locator('#sound').click();
  await expect(page.getByRole('button', { name: 'Turn sound on' })).toHaveAttribute('aria-pressed', 'false');
  const details = page.locator('.about-experiment');
  await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
  await expect(details.locator('p')).toBeVisible();
  await details.locator('summary').click();
  await expect(details).not.toHaveAttribute('open', '');
});
