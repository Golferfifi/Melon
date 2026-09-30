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

async function stat(page: Page, name: 'stretch' | 'rotation' | 'tilt' | 'height' | 'tosses' | 'landings' | 'bend' | 'faceUpness' | 'clearance' | 'x' | 'grip' | 'pickup') {
  return Number(await page.locator('#scene').getAttribute(`data-${name.replace(/[A-Z]/g, letter => "-" + letter.toLowerCase())}`));
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
  await expect(page.locator('#translucency')).toHaveValue('72');
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
  await expect.poll(() => stat(page, 'stretch')).toBeGreaterThan(0.03);
  await page.mouse.up();
  await expect(page.locator('#scene')).not.toHaveClass(/is-grabbing/);
  await expect(page.locator('#scene')).toHaveAttribute('data-tosses', '0');
  await expect(page.locator('button[data-palette="ruby"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[data-palette][aria-pressed="true"]')).toHaveCount(1);
  await expect.poll(() => stat(page, 'stretch'), { timeout: 25_000 }).toBeLessThan(0.02);
  await expect.poll(() => energy(page)).toBeLessThan(0.01);

  await page.keyboard.press('u');
  await expect.poll(async () => Math.abs(await stat(page, 'rotation') - 0.62)).toBeLessThan(0.025);
  const rotation = await stat(page, 'rotation');
  const empty = { x: box.x + box.width * 0.14, y: box.y + box.height * 0.8 };
  await page.mouse.move(empty.x, empty.y);
  await page.mouse.down();
  await expect(page.locator('#scene')).not.toHaveClass(/is-grabbing/);
  await page.mouse.move(empty.x + 70, empty.y, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => stat(page, 'rotation')).toBeGreaterThan(rotation + 0.4);
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

test('translucency changes the gel while zero and maximum retain saturated fruit color', async ({ page }) => {
  await expect(page.locator('#translucency')).toHaveValue('72');
  await page.locator('#pause').click();
  await page.locator('#translucency').focus();
  await page.keyboard.press('Home');
  await expect(page.locator('#scene')).toHaveAttribute('data-transmission', '0.00');
  const redPixels = () => page.locator('#scene canvas').evaluate(canvas => new Promise<number>(resolve => {
    requestAnimationFrame(() => {
      const source = canvas as HTMLCanvasElement;
      const copy = document.createElement('canvas');
      copy.width = source.width; copy.height = source.height;
      const context = copy.getContext('2d')!;
      context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 150 && pixels[i] > pixels[i + 1] * 1.3 && pixels[i] > pixels[i + 2] * 1.15) red++;
      }
      resolve(red);
    });
  }));
  await expect.poll(redPixels, { message: 'Opaque fruit must stay red instead of becoming white' }).toBeGreaterThan(1500);
  const opaque = await page.locator('#scene canvas').screenshot();
  await page.keyboard.press('End');
  await expect(page.locator('#scene')).toHaveAttribute('data-transmission', '1.00');
  await expect.poll(redPixels, { message: 'Transparent fruit must retain its red tint' }).toBeGreaterThan(1500);
  const clear = await page.locator('#scene canvas').screenshot();
  expect(opaque.equals(clear), 'The translucency control must visibly change the rendered fruit').toBe(false);
  await page.locator('#reset').click();
  await expect(page.locator('#scene')).toHaveAttribute('data-transmission', '0.72');
});

test('a little hop pauses in midair, lands and upright preserves the chosen settings', async ({ page }) => {
  await page.locator('button[data-palette="golden"]').click();
  await page.locator('label.check-label').filter({ hasText: '½ speed' }).click();
  await page.locator('#toss').click();
  await expect.poll(() => stat(page, 'tosses')).toBe(1);
  await expect.poll(() => stat(page, 'height')).toBeGreaterThan(0.1);
  await page.locator('#pause').click();
  await expect(page.locator('#scene')).toHaveAttribute('data-paused', 'true');
  await expect(page.locator('#scene')).toHaveAttribute('data-airborne', 'true');
  // The UI explains readiness; a repeated shortcut must not resume a paused hop.
  await expect(page.locator('#toss')).toBeDisabled();
  await page.keyboard.press('t');
  await expect(page.locator('#scene')).toHaveAttribute('data-paused', 'true');
  await expect.poll(() => stat(page, 'tosses')).toBe(1);
  await page.waitForTimeout(150);
  const height = await stat(page, 'height');
  const tilt = await stat(page, 'tilt');
  await page.waitForTimeout(350);
  expect(await stat(page, 'height')).toBe(height);
  expect(await stat(page, 'tilt')).toBe(tilt);
  await page.locator('#pause').click();
  await expect.poll(() => stat(page, 'landings'), { timeout: 25_000 }).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#scene')).toHaveAttribute('data-airborne', 'false');
  await expect(page.locator('#toss')).toBeEnabled();
  await page.locator('#toss').click();
  await expect.poll(() => stat(page, 'tosses')).toBe(2);
  await page.locator('#upright').click();
  await expect(page.locator('#scene')).toHaveAttribute('data-airborne', 'false');
  await expect.poll(async () => Math.abs(await stat(page, 'tilt') - 0.06)).toBeLessThan(0.025);
  await expect(page.locator('#palette-name')).toHaveText('Golden hour');
  await expect(page.locator('#firmness')).toHaveValue('35');
  await expect(page.locator('#translucency')).toHaveValue('72');
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
  await expect.poll(() => stat(page, 'faceUpness'), { timeout: 25_000 }).toBeGreaterThan(0.95);
  await page.waitForTimeout(800);
  expect(await stat(page, 'faceUpness')).toBeGreaterThan(0.95);
  expect(await stat(page, 'clearance')).toBeGreaterThanOrEqual(0);
  expect(await stat(page, 'height')).toBeLessThan(0.02);
  await page.keyboard.press('u');
  await expect.poll(async () => Math.abs(await stat(page, 'tilt') - 0.06)).toBeLessThan(0.025);
  await expect.poll(async () => Math.abs(await stat(page, 'rotation') - 0.62)).toBeLessThan(0.025);
});

test('mouse and touch can lift, hold and drop the fruit without triggering a scripted flip', async ({ page }, testInfo) => {
  const canvas = (await page.locator('#scene canvas').boundingBox())!;
  const x = canvas.x + canvas.width * 0.5;
  const y = canvas.y + canvas.height * 0.5;
  const client = await page.context().newCDPSession(page);
  const touch = testInfo.project.name === 'mobile';
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
  }
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'true');
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - 145 }] });
  } else {
    await page.mouse.move(x, y - 145, { steps: 8 });
  }
  await expect.poll(() => stat(page, 'height')).toBeGreaterThan(0.15);
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'true');
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.up();
  }
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'false');
  await expect.poll(() => stat(page, 'landings'), { timeout: 25_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => stat(page, 'height')).toBeLessThan(0.02);
  await expect(page.locator('#scene')).toHaveAttribute('data-tosses', '0');
  expect(await stat(page, 'clearance')).toBeGreaterThanOrEqual(0);
});

test('small mouse and touch tugs jiggle the flesh while the slice stays on the table', async ({ page }, testInfo) => {
  const canvas = (await page.locator('#scene canvas').boundingBox())!;
  const x = canvas.x + canvas.width * 0.5;
  const y = canvas.y + canvas.height * 0.5;
  const touch = testInfo.project.name === 'mobile';
  const client = await page.context().newCDPSession(page);
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 22, y }] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 22, y, { steps: 5 });
  }
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'true');
  await expect.poll(() => stat(page, 'grip')).toBeGreaterThan(0.1);
  await expect(page.locator('#interaction-label')).toHaveText(/jiggle/);
  await expect(page.locator('.grip-marker')).toHaveClass(/active/);
  expect(await stat(page, 'height')).toBeLessThan(0.02);
  expect(Math.abs(await stat(page, 'x'))).toBeLessThan(0.02);
  expect(await stat(page, 'pickup')).toBeLessThan(0.01);
  if (touch) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.up();
  }
  await expect(page.locator('#scene')).toHaveAttribute('data-held', 'false');
  await expect(page.locator('.grip-marker')).not.toHaveClass(/active/);
  await expect.poll(() => energy(page)).toBeGreaterThan(0.001);
  await expect.poll(() => stat(page, 'stretch'), { timeout: 25_000 }).toBeLessThan(0.01);
  await expect(page.locator('#scene')).toHaveAttribute('data-tosses', '0');
});
