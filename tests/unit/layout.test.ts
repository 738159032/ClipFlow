import { describe, expect, it } from 'vitest';
import { clamp01, designScale, fitStageBox, moveRect, rectToPixels, STAGE_PRESETS } from '@/lib/layout';

describe('designScale', () => {
  it('is 1 at the design width', () => {
    expect(designScale(1080)).toBe(1);
  });

  it('scales font sizes proportionally when the stage is wider', () => {
    expect(designScale(1920)).toBeCloseTo(1.7777, 3);
  });
});

describe('rectToPixels', () => {
  it('maps a normalised rect onto the stage', () => {
    expect(rectToPixels({ x: 0.5, y: 0.25, w: 0.5, h: 0.5 }, STAGE_PRESETS.portrait)).toEqual({
      x: 540,
      y: 480,
      w: 540,
      h: 960,
    });
  });

  it('keeps relative positions when switching between stage presets', () => {
    const rect = { x: 0.1, y: 0.8, w: 0.3, h: 0.05 };
    const portrait = rectToPixels(rect, STAGE_PRESETS.portrait);
    const landscape = rectToPixels(rect, STAGE_PRESETS.landscape);
    expect(portrait.x / STAGE_PRESETS.portrait.width).toBeCloseTo(0.1, 6);
    expect(landscape.x / STAGE_PRESETS.landscape.width).toBeCloseTo(0.1, 6);
    expect(portrait.y / STAGE_PRESETS.portrait.height).toBeCloseTo(0.8, 6);
    expect(landscape.y / STAGE_PRESETS.landscape.height).toBeCloseTo(0.8, 6);
    expect(portrait.w / STAGE_PRESETS.portrait.width).toBeCloseTo(0.3, 6);
    expect(landscape.h / STAGE_PRESETS.landscape.height).toBeCloseTo(0.05, 6);
  });
});

describe('fitStageBox', () => {
  it('letterboxes a portrait stage inside a wide container', () => {
    const box = fitStageBox({ width: 1000, height: 500 }, { width: 1080, height: 1920 });
    expect(box.height).toBe(500);
    expect(box.width).toBeCloseTo(281.25, 2);
  });

  it('pillarboxes a wide stage inside a tall container', () => {
    const box = fitStageBox({ width: 400, height: 800 }, { width: 1920, height: 1080 });
    expect(box.width).toBe(400);
    expect(box.height).toBeCloseTo(225, 2);
  });

  it('guards against zero-sized containers', () => {
    expect(fitStageBox({ width: 0, height: 0 }, { width: 1080, height: 1080 })).toEqual({ width: 0, height: 0 });
  });
});

describe('moveRect', () => {
  it('clamps inside the stage', () => {
    const moved = moveRect({ x: 0.9, y: 0.95, w: 0.2, h: 0.2 }, 0.5, 0.5);
    expect(moved.x).toBeCloseTo(0.8, 6);
    expect(moved.y).toBeCloseTo(0.8, 6);
  });

  it('clamps negative deltas', () => {
    const moved = moveRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, -0.5, -0.5);
    expect(moved).toMatchObject({ x: 0, y: 0 });
  });
});

describe('clamp01', () => {
  it('clamps to the unit interval', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.42)).toBe(0.42);
  });
});
