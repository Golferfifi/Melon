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

async function stat(page: Page, name: 'stretch' | 'rotation' | 'tilt' | 'height' | 'tosses' | 'landings' | 'bend') {
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
  await expect(page.locator('#firmness')).toHaveValue('35');
  await expect(page.locator('#damping')).toHaveValue('22');
  await expect(page.locator('#translucency')).toHaveValue('92');
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
  await expect(page.locator('#scene')).toHaveAttribute('data-tosses', '0');
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

test('translucency changes the rendered gel and reset restores its clear default', async ({ page }) => {
  await expect(page.locator('#translucency')).toHaveValue('92');
  await page.locator('#pause').click();
  await page.locator('#translucency').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#scene')).toHaveAttribute('data-transmission', '0.00');
  const opaque = await page.locator('#scene canvas').screenshot();
  await page.keyboard.press('End');
  await expect(page.locator('#scene')).toHaveAttribute('data-transmission', '1.00');
  const clear = await page.locator('#scene canvas').screenshot();
  expect(opaque.equals(clear), 'The translucency control must visibly change the rendered fruit').toBe(false);
  await page.locator('#reset').click();
  await expect(page.locator('#scene')).toHaveAttribute('data-transmission', '0.92');
});

test('a toss flips, pauses in midair, lands and upright preserves the chosen settings', async ({ page }) => {
  await page.locator('button[data-palette="golden"]').click();
  await page.locator('#toss').click();
  await expect.poll(() => stat(page, 'tosses')).toBe(1);
  await expect.poll(() => stat(page, 'height')).toBeGreaterThan(0.1);
  await page.locator('#pause').click();
  await expect(page.locator('#scene')).toHaveAttribute('data-paused', 'true');
  await expect(page.locator('#scene')).toHaveAttribute('data-airborne', 'true');
  // A repeated toss during a paused flip must not silently resume the simulation.
  await page.locator('#toss').click();
  await expect(page.locator('#scene')).toHaveAttribute('data-paused', 'true');
  await expect.poll(() => stat(page, 'tosses')).toBe(1);
  await page.waitForTimeout(150);
  const height = await stat(page, 'height');
  const tilt = await stat(page, 'tilt');
  await page.waitForTimeout(350);
  expect(await stat(page, 'height')).toBe(height);
  expect(await stat(page, 'tilt')).toBe(tilt);
  await page.locator('#pause').click();
  await expect.poll(() => stat(page, 'landings'), { timeout: 25_000 }).toBe(1);
  await expect(page.locator('#scene')).toHaveAttribute('data-airborne', 'false');
  await page.locator('#toss').click();
  await expect.poll(() => stat(page, 'tosses')).toBe(2);
  await page.locator('#upright').click();
  await expect(page.locator('#scene')).toHaveAttribute('data-airborne', 'false');
  await expect.poll(async () => Math.abs(await stat(page, 'tilt') - 0.1)).toBeLessThan(0.025);
  await expect(page.locator('#palette-name')).toHaveText('Golden hour');
  await expect(page.locator('#firmness')).toHaveValue('35');
  await expect(page.locator('#translucency')).toHaveValue('92');
});

test('the slice can turn onto its side and the upright shortcut restores its pose', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile', 'Full mouse rotation is exercised on desktop.');
  const box = (await page.locator('#scene canvas').boundingBox())!;
  const x = box.x + box.width * 0.18;
  const y = box.y + box.height * 0.58;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 180, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => stat(page, 'tilt')).toBeGreaterThan(1.2);
  await page.keyboard.press('u');
  await expect.poll(async () => Math.abs(await stat(page, 'tilt') - 0.1)).toBeLessThan(0.025);
  await expect.poll(async () => Math.abs(await stat(page, 'rotation') - 0.62)).toBeLessThan(0.025);
});

test('an upward flick tosses the slice with a mouse or touch', async ({ page }, testInfo) => {
  const canvas = (await page.locator('#scene canvas').boundingBox())!;
  const x = canvas.x + canvas.width * 0.5;
  const y = canvas.y + canvas.height * 0.5;
  const client = await page.context().newCDPSession(page);
  const time = Date.now() / 1000;
  // Explicit hardware-event timestamps keep this fast gesture realistic under software rendering.
  if (testInfo.project.name === 'mobile') {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }], timestamp: time });
    for (let i = 1; i <= 3; i++) await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x, y: y - i * 35 }], timestamp: time + i * 0.03,
    });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: time + 0.1 });
  } else {
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1, timestamp: time });
    for (let i = 1; i <= 3; i++) await client.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x, y: y - i * 35, button: 'left', buttons: 1, timestamp: time + i * 0.03,
    });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y: y - 105, button: 'left', buttons: 0, clickCount: 1, timestamp: time + 0.1 });
  }
  await expect.poll(() => stat(page, 'tosses')).toBe(1);
  await expect.poll(() => stat(page, 'landings'), { timeout: 25_000 }).toBe(1);
  await expect(page.locator('#scene')).toHaveAttribute('data-airborne', 'false');
});
