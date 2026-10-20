import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Image assets: upload → image layer → preview drag → real MP4, plus the
 * rejection and resource-lifecycle paths.
 *
 * Fixtures are generated in the browser (real encoders for PNG/JPEG/WEBP), so
 * the test exercises the same decode path a user would.
 */

const ARTIFACT_DIR = path.resolve(process.cwd(), '.verification');
const FIXTURE_DIR = path.join(ARTIFACT_DIR, 'fixtures');

test.describe.configure({ mode: 'serial' });

/** Instruments Object URLs and ImageBitmap.close before the app boots. */
const INSTRUMENT = () => {
  const state = { created: 0, revoked: 0, live: 0, closed: 0 };
  (window as unknown as { __img: typeof state }).__img = state;
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (blob: Blob) => {
    state.created += 1;
    state.live += 1;
    return create(blob);
  };
  URL.revokeObjectURL = (url: string) => {
    state.revoked += 1;
    state.live -= 1;
    return revoke(url);
  };
  const close = ImageBitmap.prototype.close;
  ImageBitmap.prototype.close = function patched(this: ImageBitmap) {
    state.closed += 1;
    return close.call(this);
  };
};

async function makeFixtures(page: Page) {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#ff00ff';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = '#00c000';
    ctx.fillRect(150, 150, 100, 100);
    return {
      png: canvas.toDataURL('image/png'),
      jpeg: canvas.toDataURL('image/jpeg', 0.92),
      webp: canvas.toDataURL('image/webp', 0.92),
    };
  });

  const write = async (name: string, dataUrl: string) => {
    const base64 = dataUrl.split(',')[1] ?? '';
    await fs.writeFile(path.join(FIXTURE_DIR, name), Buffer.from(base64, 'base64'));
  };
  await write('swatch.png', data.png);
  await write('swatch.jpg', data.jpeg);
  await write('swatch.webp', data.webp);

  await fs.writeFile(path.join(FIXTURE_DIR, 'broken.png'), Buffer.from('this is definitely not a png'));
  await fs.writeFile(path.join(FIXTURE_DIR, 'huge.png'), Buffer.alloc(51 * 1024 * 1024, 0x41));
}

async function openLab(page: Page) {
  await page.goto('/lab');
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });
  await expect(page.getByTestId('image-dropzone')).toBeVisible();
}

async function stageBox(page: Page) {
  const box = await page.getByTestId('stage-frame').boundingBox();
  if (!box) throw new Error('stage not laid out');
  return box;
}

async function upload(page: Page, file: string) {
  await page.getByTestId('image-file-input').setInputFiles(file);
}

async function waitReady(page: Page) {
  await expect(page.getByTestId('image-upload-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await expect(page.getByTestId('image-asset')).toBeVisible();
}

async function downloadStill(page: Page, filename: string) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-still').click();
  const download = await downloadPromise;
  const target = path.join(ARTIFACT_DIR, filename);
  await download.saveAs(target);
  return fs.readFile(target);
}

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
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const [da, db] = [await decode(left), await decode(right)];
      let changed = 0;
      let maxDelta = 0;
      let sumDelta = 0;
      for (let i = 0; i < da.length; i += 4) {
        const delta = Math.max(
          Math.abs(da[i] - db[i]),
          Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2]),
        );
        if (delta > 0) changed += 1;
        if (delta > maxDelta) maxDelta = delta;
        sumDelta += delta;
      }
      return { changed, maxDelta, meanDelta: sumDelta / (da.length / 4), total: da.length / 4 };
    },
    [a.toString('base64'), b.toString('base64')],
  );
}

async function layerRect(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('[data-layer-type="image"]') as HTMLElement | null;
    if (!el) return null;
    return {
      left: Number.parseFloat(el.style.left),
      top: Number.parseFloat(el.style.top),
      width: Number.parseFloat(el.style.width),
      height: Number.parseFloat(el.style.height),
      assetId: el.getAttribute('data-layer-asset'),
    };
  });
}

test.beforeAll(async ({ browser }) => {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
  const page = await browser.newPage();
  await page.goto('about:blank');
  await makeFixtures(page);
  await page.close();
});

for (const format of ['png', 'jpeg', 'webp'] as const) {
  test(`accepts a real ${format.toUpperCase()} and turns it into an image layer`, async ({ page }) => {
    test.setTimeout(120_000);
    await openLab(page);

    const file = path.join(FIXTURE_DIR, format === 'jpeg' ? 'swatch.jpg' : `swatch.${format}`);
    await upload(page, file);
    await waitReady(page);

    await expect(page.getByTestId('image-file-name')).toContainText(`swatch.${format === 'jpeg' ? 'jpg' : format}`);
    await expect(page.getByTestId('image-file-size')).not.toHaveText('0 B');
    await expect(page.getByTestId('image-usage')).toHaveText('0 个图层');

    await page.getByTestId('image-add-layer').click();
    await expect(page.locator('[data-layer-type="image"]')).toHaveCount(1);
    await expect(page.getByTestId('image-usage')).toHaveText('1 个图层');

    const rect = await layerRect(page);
    expect(rect).not.toBeNull();
    // Square source on a 9:16 stage → square on screen.
    const stage = await stageBox(page);
    expect((rect!.width * stage.width) / (rect!.height * stage.height)).toBeCloseTo(1, 1);
    expect(rect!.assetId).toMatch(/^img-/);

    // The layer can be selected and moved like any other layer.
    const box = await page.locator('[data-layer-type="image"]').boundingBox();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.getByTestId('layer-chrome')).toBeVisible();
    await expect(page.locator('[data-layer-type="image"]')).toHaveAttribute('aria-pressed', 'true');
  });
}

test('a corrupt PNG is rejected with a Chinese message', async ({ page }) => {
  test.setTimeout(90_000);
  await openLab(page);
  await upload(page, path.join(FIXTURE_DIR, 'broken.png'));
  await expect(page.getByTestId('image-upload-error')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('image-upload-error')).toContainText('损坏');
  await expect(page.getByTestId('image-asset')).toHaveCount(0);
});

test('a file above the 50MB limit is rejected before decoding', async ({ page }) => {
  test.setTimeout(120_000);
  await openLab(page);
  await upload(page, path.join(FIXTURE_DIR, 'huge.png'));
  await expect(page.getByTestId('image-upload-error')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('image-upload-error')).toContainText('超过 50.0 MB');
  await expect(page.getByTestId('image-asset')).toHaveCount(0);
});

test('drop-zone accepts a dragged file', async ({ page }) => {
  test.setTimeout(90_000);
  await openLab(page);
  const base64 = (await fs.readFile(path.join(FIXTURE_DIR, 'swatch.png'))).toString('base64');
  await page.evaluate((payload) => {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], 'dragged.png', { type: 'image/png' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const zone = document.querySelector('[data-testid="image-dropzone"]') as HTMLElement;
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, base64);

  await waitReady(page);
  await expect(page.getByTestId('image-file-name')).toHaveText('dragged.png');
});

test('the image layer is draggable and lands in the exported MP4', async ({ page }) => {
  test.setTimeout(240_000);
  await openLab(page);

  await upload(page, path.join(FIXTURE_DIR, 'swatch.png'));
  await waitReady(page);
  await page.getByTestId('image-add-layer').click();
  await expect(page.locator('[data-layer-type="image"]')).toHaveCount(1);

  // Move it 6% to the right so the position is clearly not the default.
  const stage = await stageBox(page);
  const box = await page.locator('[data-layer-type="image"]').boundingBox();
  const startX = box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + stage.width * 0.06, startY, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const rect = await layerRect(page);
  expect(rect!.left).toBeGreaterThan(10);

  // Preview first (workflow gate), then export a real MP4.
  await page.getByTestId('generate-preview').click();
  await expect(page.getByTestId('preview-card')).toBeVisible({ timeout: 60_000 });

  const downloadPromise = page.waitForEvent('download', { timeout: 400_000 });
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 400_000 });
  await page.getByTestId('export-download').click();
  const download = await downloadPromise;
  const target = path.join(ARTIFACT_DIR, 'image-layer.mp4');
  await download.saveAs(target);
  const buffer = await fs.readFile(target);
  expect(buffer.length).toBeGreaterThan(50_000);

  const frame = await page.evaluate(async (payload) => {
    const binary = atob(payload);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('decode failed'));
        window.setTimeout(() => reject(new Error('metadata timeout')), 15_000);
      });
      video.currentTime = 0.5;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        window.setTimeout(resolve, 5_000);
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no ctx');
      ctx.drawImage(video, 0, 0);
      const { data: pixels } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      let count = 0;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const i = (y * canvas.width + x) * 4;
          const r = pixels[i] ?? 0;
          const g = pixels[i + 1] ?? 0;
          const b = pixels[i + 2] ?? 0;
          if (r > 180 && b > 180 && g < 110) {
            count += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        count,
        box: count > 0 ? { left: minX / canvas.width, top: minY / canvas.height, right: (maxX + 1) / canvas.width, bottom: (maxY + 1) / canvas.height } : null,
      };
    } finally {
      video.remove();
      URL.revokeObjectURL(url);
    }
  }, buffer.toString('base64'));

  expect(frame.width).toBe(1080);
  expect(frame.height).toBe(1920);
  expect(frame.count).toBeGreaterThan(20_000);
  expect(frame.box).not.toBeNull();
  // Magenta block sits where the editor put it (2% tolerance on every edge).
  expect(frame.box!.left).toBeGreaterThan(rect!.left / 100 - 0.02);
  expect(frame.box!.left).toBeLessThan(rect!.left / 100 + 0.02);
  expect(frame.box!.right).toBeGreaterThan((rect!.left + rect!.width) / 100 - 0.03);
  expect(frame.box!.right).toBeLessThan((rect!.left + rect!.width) / 100 + 0.03);
  expect(frame.box!.top).toBeGreaterThan(rect!.top / 100 - 0.02);
  expect(frame.box!.top).toBeLessThan(rect!.top / 100 + 0.02);
});

test('replacing an upload revokes the old Object URL and closes the old bitmap', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(INSTRUMENT);
  await openLab(page);

  const stats = () => page.evaluate(() => (window as unknown as { __img: { created: number; revoked: number; live: number; closed: number } }).__img);

  await upload(page, path.join(FIXTURE_DIR, 'swatch.png'));
  await waitReady(page);
  const afterFirst = await stats();
  expect(afterFirst.live).toBe(1);

  // No layer uses the first asset, so the second upload may release it.
  await upload(page, path.join(FIXTURE_DIR, 'swatch.webp'));
  await waitReady(page);
  await page.waitForTimeout(300);

  const afterSecond = await stats();
  expect(afterSecond.created).toBeGreaterThanOrEqual(2);
  expect(afterSecond.revoked).toBeGreaterThanOrEqual(1);
  expect(afterSecond.live).toBe(1);
  expect(afterSecond.closed).toBeGreaterThanOrEqual(1);
});

test('leaving the editor releases every image resource', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(INSTRUMENT);
  await openLab(page);

  await upload(page, path.join(FIXTURE_DIR, 'swatch.png'));
  await waitReady(page);
  await page.getByTestId('image-add-layer').click();
  await expect(page.locator('[data-layer-type="image"]')).toHaveCount(1);

  const before = await page.evaluate(() => (window as unknown as { __img: { live: number } }).__img.live);
  expect(before).toBe(1);

  // Client-side navigation unmounts LabShell → cleanup must release the asset.
  await page.getByTestId('lab-back').click();
  await expect(page).toHaveURL(/\/$/);
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => (window as unknown as { __img: { live: number; revoked: number; closed: number } }).__img);
  expect(after.live).toBe(0);
  expect(after.revoked).toBeGreaterThanOrEqual(1);
  expect(after.closed).toBeGreaterThanOrEqual(1);
});

test('an uploaded image can become the product texture and be restored', async ({ page }) => {
  test.setTimeout(240_000);
  await openLab(page);
  await upload(page, path.join(FIXTURE_DIR, 'swatch.png'));
  await waitReady(page);

  const before = await downloadStill(page, 'texture-before.png');
  await expect(page.getByTestId('material-map-status')).toHaveText('模型自带贴图');

  await page.getByTestId('material-map-apply').click();
  await expect(page.getByTestId('material-map-status')).toHaveText('swatch.png');
  await expect(page.getByTestId('image-usage')).toContainText('商品贴图');
  await page.waitForTimeout(800);

  const applied = await downloadStill(page, 'texture-applied.png');
  const changed = await pixelDiff(page, before, applied);
  // The model occupies a large part of the frame; a magenta base-colour map
  // must visibly repaint it.
  expect(changed.changed).toBeGreaterThan(changed.total * 0.02);
  expect(changed.maxDelta).toBeGreaterThan(40);

  await page.getByTestId('material-map-clear').click();
  await expect(page.getByTestId('material-map-status')).toHaveText('模型自带贴图');
  await page.waitForTimeout(800);

  const restored = await downloadStill(page, 'texture-restored.png');
  const back = await pixelDiff(page, before, restored);
  // Restoring puts the GLB's own map back. A material update re-compiles the
  // shader, so 8-bit rounding can move by ±1..2 — the frame must still be
  // visually identical (no magenta left, no missing texture).
  expect(back.maxDelta).toBeLessThanOrEqual(2);
  expect(back.meanDelta).toBeLessThan(0.2);
});

test('an asset used as the product texture cannot be removed silently', async ({ page }) => {
  test.setTimeout(120_000);
  await openLab(page);
  await upload(page, path.join(FIXTURE_DIR, 'swatch.png'));
  await waitReady(page);
  await page.getByTestId('material-map-apply').click();
  await expect(page.getByTestId('image-usage')).toContainText('商品贴图');

  await page.getByTestId('image-remove').click();
  await expect(page.getByTestId('image-upload-error')).toBeVisible();
  await expect(page.getByTestId('image-upload-error')).toContainText('商品贴图');
  // The asset is still there, so the texture keeps rendering.
  await expect(page.getByTestId('image-asset')).toBeVisible();

  // After restoring the model texture the asset can be removed.
  await page.getByTestId('material-map-clear').click();
  await page.getByTestId('image-remove').click();
  await expect(page.getByTestId('image-asset')).toHaveCount(0);
});
