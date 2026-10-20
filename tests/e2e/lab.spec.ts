import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { inspectMp4, looksLikeWebm } from '../../src/lib/export/mp4-validate';

const ARTIFACT_DIR = path.resolve(process.cwd(), '.verification');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
});

test('lab boots, renders the model and reports a supported H.264 codec', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/lab');
  await expect(page.getByRole('heading', { name: /ClipFlow/ })).toBeVisible();

  await expect(page.getByTestId('renderer-status')).toContainText('就绪', { timeout: 45_000 });
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });
  await expect(page.getByTestId('selected-codec')).toContainText('avc1', { timeout: 30_000 });

  // The 2D overlay canvas must have been painted (title text exists).
  const overlayPainted = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.layer-overlay') as HTMLCanvasElement | null;
    if (!canvas) return { found: false, nonEmpty: false };
    const ctx = canvas.getContext('2d');
    if (!ctx) return { found: true, nonEmpty: false };
    const data = ctx.getImageData(0, 0, canvas.width, Math.min(canvas.height, 400)).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted += 1;
    return { found: true, nonEmpty: painted > 100 };
  });
  expect(overlayPainted.found).toBe(true);
  expect(overlayPainted.nonEmpty).toBe(true);

  const relevantErrors = consoleErrors.filter(
    (text) => !text.includes('favicon') && !text.includes('Failed to load resource'),
  );
  expect(relevantErrors).toEqual([]);
});

test('layer geometry survives a stage size change', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });

  const readRect = async () =>
    page.evaluate(() => {
      const canvas = document.querySelector('canvas.layer-overlay') as HTMLCanvasElement;
      return { width: canvas.width, height: canvas.height };
    });

  const portrait = await readRect();
  expect(portrait).toEqual({ width: 1080, height: 1920 });

  await page.getByRole('button', { name: '方形' }).click();
  await expect(page.getByTestId('stage-size')).toHaveText('1080 × 1080');
  const square = await readRect();
  expect(square).toEqual({ width: 1080, height: 1080 });

  // Title layer was authored at y=0.075 — it must stay at the same relative
  // position, which means the y pixel value shrinks proportionally.
  const positions = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.layer-overlay') as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let firstRow = -1;
    for (let y = 0; y < canvas.height && firstRow < 0; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const alpha = data[(y * canvas.width + x) * 4 + 3] ?? 0;
        if (alpha > 0) {
          firstRow = y;
          break;
        }
      }
    }
    return { firstRow, height: canvas.height };
  });
  expect(positions.firstRow).toBeGreaterThan(0);
  const relative = positions.firstRow / positions.height;
  expect(relative).toBeGreaterThan(0.06);
  expect(relative).toBeLessThan(0.10);
});

test('composed still frame is a real PNG', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-still').click();
  const download = await downloadPromise;
  const target = path.join(ARTIFACT_DIR, 'still.png');
  await download.saveAs(target);

  const bytes = await fs.readFile(target);
  expect(bytes.length).toBeGreaterThan(10_000);
  // PNG magic
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // Reported size in the IHDR chunk
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect(width).toBe(1080);
  expect(height).toBe(1920);
});

test('exports a real playable MP4 with baked 2D text', async ({ page }) => {
  test.setTimeout(420_000);

  await page.goto('/lab');
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });
  await expect(page.getByTestId('selected-codec')).toContainText('avc1', { timeout: 30_000 });
  await expect(page.getByTestId('export-resolution')).toHaveText('1080 × 1920');

  // The workflow requires a composited preview snapshot before exporting.
  await page.getByTestId('generate-preview').click();
  await expect(page.getByTestId('preview-card')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('export-start').click();

  const downloadPromise = page.waitForEvent('download', { timeout: 400_000 });
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 400_000 });
  const resultSummary = (await page.getByTestId('export-result').locator('p').first().innerText()).trim();
  const logText = (await page.getByTestId('export-log').innerText()).trim();
  await page.getByTestId('export-download').click();
  const download = await downloadPromise;

  const target = path.join(ARTIFACT_DIR, 'export.mp4');
  await download.saveAs(target);

  const buffer = await fs.readFile(target);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const bytes = new Uint8Array(arrayBuffer);

  // 1. Container must be ISO-BMFF, not a renamed WebM.
  expect(looksLikeWebm(bytes)).toBe(false);
  const inspection = inspectMp4(arrayBuffer);
  expect(inspection.errors).toEqual([]);
  expect(inspection.valid).toBe(true);
  expect(inspection.hasMoov).toBe(true);
  expect(inspection.hasMdat).toBe(true);
  expect(inspection.width).toBe(1080);
  expect(inspection.height).toBe(1920);
  expect(inspection.durationSec).toBeGreaterThan(4.5);
  expect(inspection.durationSec).toBeLessThan(5.6);
  expect(inspection.videoCodec).toBe('avc1');
  // File must carry real media payload, not just headers.
  expect(buffer.length).toBeGreaterThan(100_000);

  // 2. The browser must be able to decode and seek it.
  const base64 = buffer.toString('base64');
  const decoded = await page.evaluate(async (payload) => {
    const binary = atob(payload);
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i);
    const blob = new Blob([data], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.style.position = 'fixed';
    video.style.opacity = '0';
    document.body.appendChild(video);

    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error(`video error: ${video.error?.message ?? 'unknown'}`));
        window.setTimeout(() => reject(new Error('metadata timeout')), 20_000);
      });

      await video.play().catch(() => undefined);
      video.currentTime = 2;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        window.setTimeout(() => resolve(), 8_000);
      });

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);

      // Sample the title band (y 6%..18%) and count dark text pixels.
      const band = ctx.getImageData(0, Math.round(canvas.height * 0.06), canvas.width, Math.round(canvas.height * 0.12));
      let dark = 0;
      for (let i = 0; i < band.data.length; i += 4) {
        const r = band.data[i] ?? 0;
        const g = band.data[i + 1] ?? 0;
        const b = band.data[i + 2] ?? 0;
        if (r * 0.299 + g * 0.587 + b * 0.114 < 90) dark += 1;
      }
      const totalPixels = band.data.length / 4;

      // Verify the 3D product is present: the central region must contain a
      // wide luminance range (white suit, black visor, red stripes) instead of
      // the smooth background gradient.
      const region = ctx.getImageData(
        Math.round(canvas.width * 0.15),
        Math.round(canvas.height * 0.2),
        Math.round(canvas.width * 0.7),
        Math.round(canvas.height * 0.6),
      ).data;
      let minLum = 255;
      let maxLum = 0;
      let sum = 0;
      let sumSq = 0;
      let samples = 0;
      for (let i = 0; i < region.length; i += 4) {
        const lum = (region[i] ?? 0) * 0.299 + (region[i + 1] ?? 0) * 0.587 + (region[i + 2] ?? 0) * 0.114;
        if (lum < minLum) minLum = lum;
        if (lum > maxLum) maxLum = lum;
        sum += lum;
        sumSq += lum * lum;
        samples += 1;
      }
      const mean = sum / Math.max(1, samples);
      const stdev = Math.sqrt(Math.max(0, sumSq / Math.max(1, samples) - mean * mean));

      return {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        readyState: video.readyState,
        currentTime: video.currentTime,
        darkRatio: dark / totalPixels,
        luminanceRange: maxLum - minLum,
        luminanceStdev: stdev,
        framePng: canvas.toDataURL('image/png'),
      };
    } finally {
      video.remove();
      URL.revokeObjectURL(url);
    }
  }, base64);

  const { framePng, ...playback } = decoded;
  await fs.writeFile(path.join(ARTIFACT_DIR, 'mp4-frame.png'), Buffer.from(framePng.split(',')[1] ?? '', 'base64'));

  expect(playback.width).toBe(1080);
  expect(playback.height).toBe(1920);
  expect(playback.duration).toBeGreaterThan(4.5);
  expect(playback.duration).toBeLessThan(5.6);
  expect(playback.currentTime).toBeGreaterThan(1.5);
  // 2D text baked into the video (title band contains dark glyph pixels).
  expect(playback.darkRatio).toBeGreaterThan(0.002);
  // 3D product visible: high contrast inside the product area.
  expect(playback.luminanceRange).toBeGreaterThan(60);
  expect(playback.luminanceStdev).toBeGreaterThan(10);

  await fs.writeFile(
    path.join(ARTIFACT_DIR, 'export-report.json'),
    JSON.stringify({ inspection, playback, bytes: buffer.length, resultSummary, logText }, null, 2),
    'utf8',
  );
});

test('model errors and disposal are surfaced, not swallowed', async ({ page }) => {
  await page.goto('/lab');
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });

  await page.getByTestId('inject-broken').click();
  await expect(page.getByTestId('scene-model-status')).toContainText('error', { timeout: 45_000 });
  await expect(page.getByTestId('export-log')).toBeVisible();

  await page.getByRole('button', { name: '重新加载内置模型' }).click();
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });

  await page.getByTestId('unload-model').click();
  await expect(page.getByTestId('dispose-stats')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('dispose-stats')).toContainText('贴图');
});

test('cancelling mid-export releases the encoder and the app stays usable', async ({ page }) => {
  test.setTimeout(240_000);

  await page.goto('/lab');
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });

  await page.getByTestId('generate-preview').click();
  await expect(page.getByTestId('preview-card')).toBeVisible({ timeout: 60_000 });

  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-progress')).toContainText('encoding', { timeout: 60_000 });
  await page.getByTestId('export-cancel').click();

  // The exporter must leave the busy state instead of hanging on a closed encoder.
  await expect(page.getByTestId('export-cancel')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByTestId('export-log')).toContainText('导出已取消', { timeout: 30_000 });

  // The renderer size must have been restored: a second export has to succeed.
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 180_000 });
  await expect(page.getByTestId('export-video')).toBeVisible();
});
