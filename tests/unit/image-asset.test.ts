import { describe, expect, it } from 'vitest';
import {
  IMAGE_MAX_BYTES,
  checkDecodedSize,
  computeImageDrawRect,
  extensionOf,
  fitRectToAspect,
  formatBytes,
  sniffImageType,
  validateImageFile,
  verifyImageSignature,
} from '@/lib/assets/validate';
import { ImageUploadError, loadImageFile } from '@/lib/assets/upload';
import { useEditorStore } from '@/store/editor';
import type { ImageAssetMeta } from '@/lib/types';
import { STAGE_PRESETS } from '@/lib/layout';

const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEAD = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const WEBP_HEAD = new Uint8Array([...Array.from('RIFF').map((c) => c.charCodeAt(0)), 0, 0, 0, 0, ...Array.from('WEBP').map((c) => c.charCodeAt(0))]);
const RANDOM_HEAD = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

describe('extensionOf', () => {
  it('reads the lower-case extension', () => {
    expect(extensionOf('Photo.PNG')).toBe('png');
    expect(extensionOf('a.b.jpeg')).toBe('jpeg');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});

describe('formatBytes', () => {
  it('formats B / KB / MB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
    expect(formatBytes(-10)).toBe('0 B');
  });
});

describe('validateImageFile', () => {
  it('accepts png / jpeg / jpg / webp', () => {
    expect(validateImageFile({ name: 'a.png', type: 'image/png', size: 1234 })).toEqual({
      ok: true,
      extension: 'png',
      mime: 'image/png',
    });
    expect(validateImageFile({ name: 'a.jpg', type: 'image/jpeg', size: 1234 }).ok).toBe(true);
    expect(validateImageFile({ name: 'a.jpeg', type: 'image/jpeg', size: 1234 }).ok).toBe(true);
    expect(validateImageFile({ name: 'a.webp', type: 'image/webp', size: 1234 }).ok).toBe(true);
  });

  it('normalises the legacy image/jpg mime', () => {
    const result = validateImageFile({ name: 'a.jpg', type: 'image/jpg', size: 10 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mime).toBe('image/jpeg');
  });

  it('rejects empty files', () => {
    const result = validateImageFile({ name: 'a.png', type: 'image/png', size: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('EMPTY');
      expect(result.message).toContain('文件为空');
    }
  });

  it('rejects unsupported extensions', () => {
    const result = validateImageFile({ name: 'anim.gif', type: 'image/gif', size: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('EXTENSION');
      expect(result.message).toContain('PNG / JPEG / WEBP');
    }
    expect(validateImageFile({ name: 'noext', type: 'image/png', size: 10 }).ok).toBe(false);
  });

  it('rejects unsupported mime types', () => {
    const result = validateImageFile({ name: 'a.png', type: 'application/octet-stream', size: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('MIME');
  });

  it('rejects extension / mime mismatches', () => {
    const result = validateImageFile({ name: 'a.png', type: 'image/jpeg', size: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('MIME');
      expect(result.message).toContain('不一致');
    }
  });

  it('rejects files above the limit (default 50MB)', () => {
    const result = validateImageFile({ name: 'big.png', type: 'image/png', size: IMAGE_MAX_BYTES + 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('TOO_LARGE');
      expect(result.message).toContain('50.0 MB');
    }
  });

  it('accepts a file exactly at the limit', () => {
    expect(validateImageFile({ name: 'edge.png', type: 'image/png', size: IMAGE_MAX_BYTES }).ok).toBe(true);
  });

  it('honours a custom limit', () => {
    const result = validateImageFile({ name: 'a.png', type: 'image/png', size: 2048 }, { maxBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('TOO_LARGE');
  });
});

describe('sniffImageType', () => {
  it('detects the three supported containers', () => {
    expect(sniffImageType(PNG_HEAD)).toBe('image/png');
    expect(sniffImageType(JPEG_HEAD)).toBe('image/jpeg');
    expect(sniffImageType(WEBP_HEAD)).toBe('image/webp');
  });

  it('returns null for arbitrary bytes', () => {
    expect(sniffImageType(RANDOM_HEAD)).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });
});

describe('verifyImageSignature', () => {
  it('accepts matching signatures', () => {
    expect(verifyImageSignature(PNG_HEAD, 'image/png').ok).toBe(true);
    expect(verifyImageSignature(WEBP_HEAD, 'image/webp').ok).toBe(true);
  });

  it('flags a renamed file', () => {
    const result = verifyImageSignature(JPEG_HEAD, 'image/png');
    expect(result.ok).toBe(false);
    expect(result.detected).toBe('image/jpeg');
    expect(result.message).toContain('不符');
  });

  it('flags corrupt content', () => {
    const result = verifyImageSignature(RANDOM_HEAD, 'image/png');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('损坏');
  });
});

describe('checkDecodedSize', () => {
  it('accepts normal dimensions', () => {
    expect(checkDecodedSize(1920, 1080)).toBeNull();
  });

  it('rejects zero and absurd dimensions', () => {
    expect(checkDecodedSize(0, 100)).toContain('尺寸为 0');
    expect(checkDecodedSize(20000, 100)).toContain('上限');
    expect(checkDecodedSize(Number.NaN, 100)).not.toBeNull();
  });
});

describe('fitRectToAspect', () => {
  it('keeps a square image square on a 9:16 stage', () => {
    const rect = fitRectToAspect(1, STAGE_PRESETS.portrait);
    const pixelW = rect.w * STAGE_PRESETS.portrait.width;
    const pixelH = rect.h * STAGE_PRESETS.portrait.height;
    expect(pixelW).toBeCloseTo(pixelH, 6);
    expect(rect.x + rect.w / 2).toBeCloseTo(0.5, 6);
    expect(rect.y + rect.h / 2).toBeCloseTo(0.5, 6);
  });

  it('keeps a landscape image at 2:1 on a 1:1 stage', () => {
    const rect = fitRectToAspect(2, STAGE_PRESETS.square);
    expect((rect.w * 1080) / (rect.h * 1080)).toBeCloseTo(2, 6);
    expect(rect.w).toBeLessThanOrEqual(0.62 + 1e-9);
  });

  it('fits a tall image by height when width would overflow', () => {
    const rect = fitRectToAspect(0.5, STAGE_PRESETS.portrait);
    expect(rect.h).toBeCloseTo(0.62, 6);
    expect((rect.w * 1080) / (rect.h * 1920)).toBeCloseTo(0.5, 6);
  });

  it('stays inside the stage for extreme aspects', () => {
    for (const aspect of [0.05, 20]) {
      const rect = fitRectToAspect(aspect, STAGE_PRESETS.portrait);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(rect.y + rect.h).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('falls back to 1:1 for invalid aspects', () => {
    const rect = fitRectToAspect(Number.NaN, STAGE_PRESETS.square);
    expect(rect.w).toBeCloseTo(rect.h, 6);
  });
});

describe('computeImageDrawRect', () => {
  it('crops the sides for cover (wide source)', () => {
    const draw = computeImageDrawRect({ width: 200, height: 100 }, { w: 100, h: 100 }, 'cover');
    expect(draw).toMatchObject({ sx: 50, sy: 0, sw: 100, sh: 100, dx: 0, dy: 0, dw: 100, dh: 100 });
  });

  it('crops top/bottom for cover (tall source)', () => {
    const draw = computeImageDrawRect({ width: 100, height: 200 }, { w: 100, h: 100 }, 'cover');
    expect(draw).toMatchObject({ sx: 0, sy: 50, sw: 100, sh: 100 });
  });

  it('letterboxes for contain (wide source)', () => {
    const draw = computeImageDrawRect({ width: 200, height: 100 }, { w: 100, h: 100 }, 'contain');
    expect(draw.dw).toBeCloseTo(100, 6);
    expect(draw.dh).toBeCloseTo(50, 6);
    expect(draw.dy).toBeCloseTo(25, 6);
    expect(draw.dx).toBe(0);
  });

  it('pillarboxes for contain (tall source)', () => {
    const draw = computeImageDrawRect({ width: 100, height: 200 }, { w: 100, h: 100 }, 'contain');
    expect(draw.dw).toBeCloseTo(50, 6);
    expect(draw.dh).toBeCloseTo(100, 6);
    expect(draw.dx).toBeCloseTo(25, 6);
  });
});

describe('editor store · image assets', () => {
  const meta = (over: Partial<ImageAssetMeta> = {}): ImageAssetMeta => ({
    id: 'img-test',
    name: 'product.png',
    mime: 'image/png',
    bytes: 2048,
    width: 1000,
    height: 1000,
    createdAt: 1,
    ...over,
  });

  it('adds an aspect-correct image layer and selects it', () => {
    const store = useEditorStore.getState();
    store.resetProject();
    store.addImageAsset(meta());
    const id = useEditorStore.getState().addImageLayer(meta());
    const state = useEditorStore.getState();
    const layer = state.config.layers.find((item) => item.id === id);
    expect(layer?.type).toBe('image');
    if (layer?.type === 'image') {
      expect(layer.assetId).toBe('img-test');
      expect(layer.name).toBe('product');
      expect(layer.fit).toBe('cover');
    }
    expect(state.selectedLayerId).toBe(id);
    expect(state.activeImageAssetId).toBe('img-test');
  });

  it('keeps the metadata JSON-serialisable', () => {
    const state = useEditorStore.getState();
    expect(JSON.parse(JSON.stringify(state.images))).toEqual(state.images);
    expect(JSON.stringify(state.images)).not.toContain('blob:');
  });

  it('re-points the selected image layer to another asset', () => {
    const store = useEditorStore.getState();
    store.resetProject();
    store.addImageAsset(meta({ id: 'img-a' }));
    const layerId = useEditorStore.getState().addImageLayer(meta({ id: 'img-a' }));
    useEditorStore.getState().setLayerImageAsset(layerId, 'img-b');
    const layer = useEditorStore.getState().config.layers.find((item) => item.id === layerId);
    expect(layer?.type === 'image' && layer.assetId).toBe('img-b');
  });

  it('drops metadata on remove / clear / reset', () => {
    const store = useEditorStore.getState();
    store.resetProject();
    store.addImageAsset(meta({ id: 'img-x' }));
    expect(Object.keys(useEditorStore.getState().images)).toHaveLength(1);
    useEditorStore.getState().removeImageAsset('img-x');
    expect(useEditorStore.getState().images).toEqual({});
    expect(useEditorStore.getState().activeImageAssetId).toBeNull();

    useEditorStore.getState().addImageAsset(meta({ id: 'img-y' }));
    useEditorStore.getState().clearImageAssets();
    expect(useEditorStore.getState().images).toEqual({});
  });
});

describe('loadImageFile · cancellation', () => {
  it('aborts before reading any bytes when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'a.png', {
      type: 'image/png',
    });
    await expect(loadImageFile(file, { signal: controller.signal })).rejects.toBeInstanceOf(ImageUploadError);
    await expect(loadImageFile(file, { signal: controller.signal })).rejects.toMatchObject({ reason: 'ABORTED' });
  });

  it('still validates before touching the signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const file = new File([new Uint8Array([1])], 'a.gif', { type: 'image/gif' });
    await expect(loadImageFile(file, { signal: controller.signal })).rejects.toMatchObject({ reason: 'EXTENSION' });
  });
});
