import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Template gallery + workflow state machine.
 *
 * The point of these tests is that the *visible* state machine drives the UI:
 * a button is disabled because the machine rejects the event, not because a
 * toast said so.
 */

const ARTIFACT_DIR = path.resolve(process.cwd(), '.verification');
const FIXTURE_DIR = path.join(ARTIFACT_DIR, 'fixtures');

test.describe.configure({ mode: 'serial' });

async function ensureFixture(page: Page) {
  await fs.mkdir(FIXTURE_DIR, { recursive: true });
  const target = path.join(FIXTURE_DIR, 'swatch.png');
  try {
    await fs.access(target);
    return target;
  } catch {
    // generate below
  }
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no ctx');
    ctx.fillStyle = '#2ec4b6';
    ctx.fillRect(0, 0, 400, 400);
    ctx.fillStyle = '#113a3a';
    ctx.fillRect(120, 120, 160, 160);
    return canvas.toDataURL('image/png');
  });
  await fs.writeFile(target, Buffer.from((dataUrl.split(',')[1] ?? ''), 'base64'));
  return target;
}

async function openLab(page: Page) {
  await page.goto('/lab');
  await expect(page.getByTestId('scene-model-status')).toContainText('ready', { timeout: 90_000 });
  await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'asset-ready', { timeout: 30_000 });
}

async function workflowState(page: Page): Promise<string | null> {
  return page.getByTestId('workflow-bar').getAttribute('data-state');
}

async function stageBackground(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.querySelector('[data-testid="stage-frame"]') as HTMLElement).backgroundImage,
  );
}

async function dragLayer(page: Page, selector: string, dx: number, dy: number) {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

test('template gallery shows 5+ distinguishable cards and only patches style', async ({ page }) => {
  test.setTimeout(120_000);
  await openLab(page);

  const cards = page.locator('[data-testid^="template-card-"]');
  await expect(cards).toHaveCount(6);

  // Each card carries a rendered thumbnail, name, background summary and chips.
  const first = page.getByTestId('template-card-clean-studio');
  await expect(first).toContainText('极简影棚');
  await expect(first).toContainText('浅灰渐变');
  await expect(first).toContainText('转台');
  await expect(first.locator('canvas')).toBeVisible();

  const backgroundBefore = await stageBackground(page);
  const layersBefore = await page.locator('[data-layer-type]').count();
  await expect(page.getByTestId('model-name')).toContainText('astronaut.glb');

  await first.click();
  await expect(first).toHaveAttribute('data-selected', 'true');
  await page.getByTestId('template-apply').click();

  await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'template-selected');
  await expect(first).toHaveAttribute('data-applied', 'true');
  await expect(page.getByTestId('template-applied-badge')).toBeVisible();

  // Style really changed…
  await expect.poll(() => stageBackground(page)).not.toBe(backgroundBefore);
  expect(await stageBackground(page)).toContain('247, 248, 251');
  // …while content did not.
  await expect(page.locator('[data-layer-type]')).toHaveCount(layersBefore);
  await expect(page.getByTestId('model-name')).toContainText('astronaut.glb');

  // A second template is visually distinct and replaces the applied badge.
  await page.getByTestId('template-card-rose-editorial').click();
  await page.getByTestId('template-apply').click();
  await expect.poll(() => stageBackground(page)).toContain('255, 240, 245');
  await expect(first).toHaveAttribute('data-applied', 'false');
  await expect(page.getByTestId('template-card-rose-editorial')).toHaveAttribute('data-applied', 'true');
});

test('buttons explain illegal jumps instead of pretending', async ({ page }) => {
  test.setTimeout(90_000);
  await openLab(page);

  await expect(page.getByTestId('export-start')).toBeDisabled();
  await expect(page.getByTestId('export-blocked-reason')).toContainText('请先生成预览');

  await expect(page.getByTestId('template-apply')).toBeDisabled();
  await expect(page.getByTestId('template-apply-reason')).toContainText('请先选择一个模板');

  await expect(page.getByTestId('template-restore')).toBeDisabled();
  await expect(page.getByTestId('template-restore-reason')).toContainText('应用模板后未做修改时');

  // Forcing the click must not move the machine.
  await page.getByTestId('export-start').click({ force: true });
  expect(await workflowState(page)).toBe('asset-ready');
});

test('restore rolls the style back to the pre-template state', async ({ page }) => {
  test.setTimeout(90_000);
  await openLab(page);
  const before = await stageBackground(page);

  await page.getByTestId('template-card-noir-metal').click();
  await page.getByTestId('template-apply').click();
  await expect.poll(() => stageBackground(page)).not.toBe(before);

  await page.getByTestId('template-restore').click();
  await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'editing');
  expect(await stageBackground(page)).toBe(before);
  await expect(page.getByTestId('template-applied-badge')).toHaveCount(0);
});

test('reset needs an explicit confirmation', async ({ page }) => {
  test.setTimeout(120_000);
  const fixture = await ensureFixture(page);
  await openLab(page);

  await page.getByTestId('image-file-input').setInputFiles(fixture);
  await expect(page.getByTestId('image-upload-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await page.getByTestId('image-add-layer').click();
  await expect(page.locator('[data-layer-type="image"]')).toHaveCount(1);

  await page.getByTestId('template-card-sunset-drop').click();
  await page.getByTestId('template-apply').click();
  await expect(page.getByTestId('template-applied-badge')).toBeVisible();

  await page.getByTestId('reset-start').click();
  await expect(page.getByTestId('reset-confirm')).toBeVisible();
  await page.getByTestId('reset-cancel').click();
  await expect(page.getByTestId('reset-confirm')).toHaveCount(0);
  // Cancelling must not touch anything.
  await expect(page.locator('[data-layer-type="image"]')).toHaveCount(1);
  await expect(page.getByTestId('template-applied-badge')).toBeVisible();

  await page.getByTestId('reset-start').click();
  await page.getByTestId('reset-confirm-button').click();
  await expect(page.locator('[data-layer-type="image"]')).toHaveCount(0);
  await expect(page.locator('[data-layer-type]')).toHaveCount(4);
  await expect(page.getByTestId('template-applied-badge')).toHaveCount(0);
  await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'asset-ready');
});

test('full flow: asset → template → edit → preview → export', async ({ page }) => {
  test.setTimeout(300_000);
  const fixture = await ensureFixture(page);
  await openLab(page);

  // 1. asset
  await page.getByTestId('image-file-input').setInputFiles(fixture);
  await expect(page.getByTestId('image-upload-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
  await page.getByTestId('image-add-layer').click();
  await expect(page.locator('[data-layer-type="image"]')).toHaveCount(1);
  // Adding a layer is a content edit, so the flow has already moved on.
  expect(await workflowState(page)).toBe('editing');

  // 2. template
  await page.getByTestId('template-card-mint-ceramic').click();
  await page.getByTestId('template-apply').click();
  await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'template-selected');

  // 3. edit — a content edit moves to editing but keeps the template applied
  await dragLayer(page, '[data-layer-type="image"]', 30, 10);
  await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'editing');
  await expect(page.getByTestId('template-card-mint-ceramic')).toHaveAttribute('data-applied', 'true');

  // 4. preview — the snapshot is observable and holds the composite
  await page.getByTestId('generate-preview').click();
  await expect(page.getByTestId('preview-card')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'preview-ready');
  await expect(page.getByTestId('preview-size')).toHaveText('1080 × 1920');
  await expect(page.getByTestId('workflow-preview-summary')).toContainText('1080×1920');
  await expect(page.getByTestId('workflow-preview-summary')).toContainText('5 图层');

  // 5. export
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'export-success', { timeout: 400_000 });
  await expect(page.getByTestId('export-result')).toBeVisible();

  const downloadPromise = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByTestId('export-download').click();
  const download = await downloadPromise;
  const target = path.join(ARTIFACT_DIR, 'template-flow.mp4');
  await download.saveAs(target);
  expect((await fs.stat(target)).size).toBeGreaterThan(50_000);

  // No business data may be written to localStorage.
  const storedKeys = await page.evaluate(() => Object.keys(window.localStorage));
  expect(storedKeys.filter((key) => key.toLowerCase().includes('clipflow'))).toEqual([]);
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('asset → template → edit → preview works on a phone viewport', async ({ page }) => {
    test.setTimeout(180_000);
    const fixture = await ensureFixture(page);
    await openLab(page);

    // Gallery is reachable and laid out in the narrow column.
    await expect(page.locator('[data-testid^="template-card-"]')).toHaveCount(6);
    await expect(page.getByTestId('template-card-cobalt-tech')).toBeVisible();

    await page.getByTestId('image-file-input').setInputFiles(fixture);
    await expect(page.getByTestId('image-upload-status')).toHaveAttribute('data-status', 'ready', { timeout: 30_000 });
    await page.getByTestId('image-add-layer').click();
    await expect(page.locator('[data-layer-type="image"]')).toHaveCount(1);

    await page.getByTestId('template-card-cobalt-tech').click();
    await page.getByTestId('template-apply').click();
    await expect(page.getByTestId('template-applied-badge')).toBeVisible();

    // Touch drag still works at this width. Scroll the stage into view first:
    // on a 390px page the editor is stacked and the stage may be below the fold.
    const layer = page.locator('[data-layer-type="image"]').first();
    await layer.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const box = await layer.boundingBox();
    if (!box) throw new Error('no layer box');
    const viewport = page.viewportSize();
    if (!viewport || box.y + box.height / 2 > viewport.height || box.y + box.height / 2 < 0) {
      throw new Error(`layer centre is outside the viewport: ${JSON.stringify(box)}`);
    }
    const cdp = await page.context().newCDPSession(page);
    const startX = box.x + box.width / 2;
    const startY = box.y + box.height / 2;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY, id: 1 }] });
    for (let step = 1; step <= 5; step += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: startX + step * 4, y: startY + step * 2, id: 1 }],
      });
      await page.waitForTimeout(25);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'editing');

    await page.getByTestId('generate-preview').click();
    await expect(page.getByTestId('preview-card')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('workflow-bar')).toHaveAttribute('data-state', 'preview-ready');
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'template-flow-mobile.png'), fullPage: true });
  });
});
