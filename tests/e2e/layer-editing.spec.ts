import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Layer editing (hit test / drag / resize / keyboard / touch).
 *
 * The assertions read the layer's *percentage* geometry from the DOM and the
 * pixels of the exported PNG, never absolute pixel coordinates — that is
 * exactly the contract the editor promises.
 */

const ARTIFACT_DIR = path.resolve(process.cwd(), '.verification');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
});

async function openLab(page: Page) {
  await page.goto('/lab');
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });
  await expect(page.getByTestId('stage-frame')).toBeVisible();
  // Let the first 3D frame + overlay paint settle.
  await page.waitForTimeout(400);
}

async function stageBox(page: Page) {
  const box = await page.getByTestId('stage-frame').boundingBox();
  if (!box) throw new Error('stage not laid out');
  return box;
}

/** Reads the normalised geometry back out of the a11y box (percent styles). */
async function rectPercent(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    return {
      left: Number.parseFloat(el.style.left),
      top: Number.parseFloat(el.style.top),
      width: Number.parseFloat(el.style.width),
      height: Number.parseFloat(el.style.height),
      pressed: el.getAttribute('aria-pressed'),
      label: el.getAttribute('aria-label'),
      tabIndex: el.getAttribute('tabindex'),
      shortcuts: el.getAttribute('aria-keyshortcuts'),
    };
  }, selector);
}

async function dragBy(page: Page, from: { x: number; y: number }, dx: number, dy: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function centerOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function downloadStill(page: Page, filename: string) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-still').click();
  const download = await downloadPromise;
  const target = path.join(ARTIFACT_DIR, filename);
  await download.saveAs(target);
  return fs.readFile(target);
}

/** Decodes two PNG buffers inside the browser and returns a pixel diff. */
async function pixelDiff(page: Page, a: Buffer, b: Buffer) {
  return page.evaluate(
    async ([left, right]) => {
      const decode = async (base64: string) => {
        const response = await fetch(`data:image/png;base64,${base64}`);
        const bitmap = await createImageBitmap(await response.blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        ctx.drawImage(bitmap, 0, 0);
        return { data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data, width: bitmap.width, height: bitmap.height };
      };
      const [da, db] = [await decode(left), await decode(right)];
      let changed = 0;
      let max = 0;
      for (let i = 0; i < da.data.length; i += 4) {
        const delta =
          Math.abs((da.data[i] ?? 0) - (db.data[i] ?? 0)) +
          Math.abs((da.data[i + 1] ?? 0) - (db.data[i + 1] ?? 0)) +
          Math.abs((da.data[i + 2] ?? 0) - (db.data[i + 2] ?? 0));
        if (delta > 0) changed += 1;
        if (delta > max) max = delta;
      }
      return { changed, max, total: da.data.length / 4, width: da.width, height: da.height };
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

/** Bounding box of dark pixels (the price tag) in a horizontal band, 0–1. */
async function darkBoxInBand(page: Page, png: Buffer, fromY: number, toY: number, threshold = 45) {
  return page.evaluate(
    async ([base64, y0, y1, limit]) => {
      const response = await fetch(`data:image/png;base64,${base64}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(bitmap, 0, 0);
      const top = Math.round(bitmap.height * y0);
      const bottom = Math.round(bitmap.height * y1);
      const band = ctx.getImageData(0, top, bitmap.width, bottom - top).data;
      const width = bitmap.width;
      let minX = width;
      let maxX = -1;
      let minY = bottom;
      let maxY = -1;
      for (let y = 0; y < bottom - top; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const i = (y * width + x) * 4;
          const lum = (band[i] ?? 0) * 0.299 + (band[i + 1] ?? 0) * 0.587 + (band[i + 2] ?? 0) * 0.114;
          if (lum < limit) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y + top < minY) minY = y + top;
            if (y + top > maxY) maxY = y + top;
          }
        }
      }
      if (maxX < 0) return null;
      return {
        left: minX / width,
        right: (maxX + 1) / width,
        top: minY / bitmap.height,
        bottom: (maxY + 1) / bitmap.height,
      };
    },
    [png.toString('base64'), fromY, toY, threshold],
  );
}

test('mouse: every layer type can be selected, dragged and resized', async ({ page }) => {
  test.setTimeout(120_000);
  await openLab(page);
  const stage = await stageBox(page);

  for (const [type, expectedLabel] of [
    ['text', '文字'],
    ['price', '价格标签'],
    ['watermark', '水印'],
  ] as const) {
    const selector = `[data-layer-type="${type}"]`;
    const before = await rectPercent(page, selector);
    expect(before).not.toBeNull();
    expect(before?.label).toContain(expectedLabel);
    expect(before?.tabIndex).toBe('0');
    expect(before?.shortcuts).toContain('ArrowRight');

    const centre = await centerOf(page, selector);
    await page.mouse.click(centre.x, centre.y);
    await page.waitForTimeout(150);

    const selected = await rectPercent(page, selector);
    expect(selected?.pressed).toBe('true');
    await expect(page.getByTestId('layer-chrome')).toBeVisible();
    await expect(page.getByTestId('layer-handle-se')).toBeVisible();

    // Drag 5% right and 3% down (in stage-relative units).
    await dragBy(page, centre, stage.width * 0.05, stage.height * 0.03);
    const moved = await rectPercent(page, selector);
    expect(moved!.left).toBeGreaterThan(before!.left + 4.2);
    expect(moved!.left).toBeLessThan(before!.left + 5.8);
    expect(moved!.top).toBeGreaterThan(before!.top + 2.2);
    expect(moved!.top).toBeLessThan(before!.top + 3.8);
    // Size must not change while moving.
    expect(moved!.width).toBeCloseTo(before!.width, 3);
    expect(moved!.height).toBeCloseTo(before!.height, 3);
  }

  // Corner resize on the price tag (bottom-right handle). Select it first —
  // the chrome always belongs to the currently selected layer.
  const priceSelector = '[data-layer-type="price"]';
  const priceCentre = await centerOf(page, priceSelector);
  await page.mouse.click(priceCentre.x, priceCentre.y);
  await page.waitForTimeout(150);
  const beforeResize = await rectPercent(page, priceSelector);
  expect(beforeResize?.pressed).toBe('true');
  const handle = await centerOf(page, '[data-testid="layer-handle-se"]');
  await dragBy(page, handle, stage.width * 0.04, stage.height * 0.02);
  const afterResize = await rectPercent(page, priceSelector);
  expect(afterResize!.width).toBeGreaterThan(beforeResize!.width + 3.2);
  expect(afterResize!.width).toBeLessThan(beforeResize!.width + 4.8);
  expect(afterResize!.height).toBeGreaterThan(beforeResize!.height + 1.5);
  // Top-left corner stays anchored while dragging the opposite corner.
  expect(afterResize!.left).toBeCloseTo(beforeResize!.left, 3);
  expect(afterResize!.top).toBeCloseTo(beforeResize!.top, 3);

  // Keyboard: focus + arrow moves, ctrl+arrow resizes.
  const watermark = '[data-layer-type="watermark"]';
  await page.locator(watermark).focus();
  const beforeKeys = await rectPercent(page, watermark);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  const afterMove = await rectPercent(page, watermark);
  expect(afterMove!.left).toBeCloseTo(beforeKeys!.left + 0.5, 1);

  await page.keyboard.press('Control+ArrowDown');
  await page.waitForTimeout(120);
  const afterGrow = await rectPercent(page, watermark);
  expect(afterGrow!.height).toBeCloseTo(afterMove!.height + 1, 1);

  // Escape clears the selection and removes the chrome.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('layer-chrome')).toHaveCount(0);
});

test('dragging a layer never rotates the product; empty areas still orbit', async ({ page }) => {
  test.setTimeout(120_000);
  await openLab(page);
  const stage = await stageBox(page);

  // Count pointer events that actually reach the WebGL canvas.
  await page.evaluate(() => {
    const canvas = document.querySelector('.stage-canvas-wrap canvas') as HTMLCanvasElement;
    (window as unknown as { __orbit: { down: number } }).__orbit = { down: 0 };
    canvas.addEventListener('pointerdown', () => {
      (window as unknown as { __orbit: { down: number } }).__orbit.down += 1;
    }, true);
  });

  const priceCentre = await centerOf(page, '[data-layer-type="price"]');
  await dragBy(page, priceCentre, stage.width * 0.1, -stage.height * 0.02);

  const duringLayerDrag = await page.evaluate(() => (window as unknown as { __orbit: { down: number } }).__orbit.down);
  expect(duringLayerDrag).toBe(0);

  await dragBy(page, { x: stage.x + stage.width * 0.86, y: stage.y + stage.height * 0.3 }, -stage.width * 0.12, 8);
  const afterEmptyDrag = await page.evaluate(() => (window as unknown as { __orbit: { down: number } }).__orbit.down);
  expect(afterEmptyDrag).toBe(1);
});

test('positions survive stage presets and a viewport resize', async ({ page }) => {
  test.setTimeout(120_000);
  await openLab(page);
  let stage = await stageBox(page);

  const price = '[data-layer-type="price"]';
  const start = await rectPercent(page, price);
  await dragBy(page, await centerOf(page, price), stage.width * 0.1, 0);
  const dragged = await rectPercent(page, price);
  expect(dragged!.left).toBeGreaterThan(start!.left + 9);

  for (const [label, size] of [
    ['方形', '1080 × 1080'],
    ['横屏', '1920 × 1080'],
    ['720p', '1280 × 720'],
    ['竖屏', '1080 × 1920'],
  ] as const) {
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByTestId('stage-size')).toHaveText(size);
    await page.waitForTimeout(250);
    const after = await rectPercent(page, price);
    // Normalised geometry is untouched by the stage change.
    expect(after!.left).toBeCloseTo(dragged!.left, 2);
    expect(after!.top).toBeCloseTo(dragged!.top, 2);
    expect(after!.width).toBeCloseTo(dragged!.width, 2);
  }

  // Window resize: same relative position, and hit testing still lands correctly.
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForTimeout(500);
  const afterResize = await rectPercent(page, price);
  expect(afterResize!.left).toBeCloseTo(dragged!.left, 2);

  stage = await stageBox(page);
  await dragBy(page, await centerOf(page, price), stage.width * 0.04, 0);
  const afterResizeDrag = await rectPercent(page, price);
  expect(afterResizeDrag!.left).toBeGreaterThan(dragged!.left + 3.2);
  expect(afterResizeDrag!.left).toBeLessThan(dragged!.left + 4.8);
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('a touch drag moves the layer and never scrolls the page', async ({ page }) => {
    test.setTimeout(120_000);
    await openLab(page);

    const touchAction = await page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="stage-frame"]') as HTMLElement).touchAction,
    );
    expect(touchAction).toBe('none');

    const price = '[data-layer-type="price"]';
    const before = await rectPercent(page, price);
    const stage = await stageBox(page);
    const centre = await centerOf(page, price);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: centre.x, y: centre.y, id: 1 }] });
    for (let step = 1; step <= 6; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: centre.x + (stage.width * 0.06 * step) / 6, y: centre.y - (stage.height * 0.02 * step) / 6, id: 1 }],
      });
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);

    const after = await rectPercent(page, price);
    expect(after!.left).toBeGreaterThan(before!.left + 5.2);
    expect(after!.left).toBeLessThan(before!.left + 6.8);
    expect(after!.pressed).toBe('true');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });
});

test('exported PNG matches the edited position and never contains the selection chrome', async ({ page }) => {
  test.setTimeout(180_000);
  await openLab(page);
  const stage = await stageBox(page);

  const price = '[data-layer-type="price"]';
  await dragBy(page, await centerOf(page, price), stage.width * 0.12, 0);
  await page.waitForTimeout(300);
  const edited = await rectPercent(page, price);
  expect(edited).not.toBeNull();

  // Snapshot A: with the layer selected (chrome visible in the editor only).
  await expect(page.getByTestId('layer-chrome')).toBeVisible();
  const withChrome = await downloadStill(page, 'edit-export-selected.png');

  // Snapshot B: nothing selected. Clicking empty stage area clears the
  // selection (a click, not a drag, so the camera does not move).
  await page.mouse.click(stage.x + stage.width * 0.9, stage.y + stage.height * 0.3);
  await expect(page.getByTestId('layer-chrome')).toHaveCount(0);
  await page.waitForTimeout(200);
  const withoutChrome = await downloadStill(page, 'edit-export-clean.png');

  const diff = await pixelDiff(page, withChrome, withoutChrome);
  expect(diff.width).toBe(1080);
  expect(diff.height).toBe(1920);
  // Selection outline/handles are DOM only — the frame is identical.
  expect(diff.changed).toBe(0);

  // The price tag in the PNG sits where the editor said it would.
  const box = await darkBoxInBand(page, withoutChrome, 0.7, 1, 45);
  expect(box).not.toBeNull();
  expect(box!.left).toBeGreaterThan(edited!.left / 100 - 0.02);
  expect(box!.left).toBeLessThan(edited!.left / 100 + 0.02);
});
