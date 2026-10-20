import { describe, expect, it } from 'vitest';
import { rectToPixels, STAGE_PRESETS } from '@/lib/layout';
import {
  MIN_LAYER_SIZE,
  hitTestLayers,
  rectEquals,
  rectToPercentStyle,
  resizeRectBy,
  resizeRectFromCorner,
  rotatedRectContains,
  toNormalizedPoint,
  translateRect,
} from '@/lib/layers/transform';
import type { Layer, TextLayer } from '@/lib/types';

const PORTRAIT = STAGE_PRESETS.portrait;

function text(id: string, over: Partial<TextLayer> = {}): TextLayer {
  return {
    id,
    name: id,
    type: 'text',
    visible: true,
    locked: false,
    rect: { x: 0.1, y: 0.2, w: 0.4, h: 0.1 },
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    text: 'hello',
    fontSize: 40,
    fontFamily: 'sans-serif',
    fontWeight: 400,
    color: '#000',
    align: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    shadow: false,
    ...over,
  };
}

describe('toNormalizedPoint', () => {
  it('maps a viewport point into 0–1 stage space', () => {
    const box = { left: 100, top: 50, width: 400, height: 800 };
    expect(toNormalizedPoint(300, 450, box)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('gives the same normalised point after the stage is CSS-scaled down', () => {
    // 1080×1920 stage displayed at 270×480 (a quarter), offset by a panel.
    const big = { left: 0, top: 0, width: 1080, height: 1920 };
    const small = { left: 320, top: 64, width: 270, height: 480 };
    const inBig = toNormalizedPoint(0.25 * 1080, 0.75 * 1920, big);
    const inSmall = toNormalizedPoint(320 + 0.25 * 270, 64 + 0.75 * 480, small);
    expect(inSmall.x).toBeCloseTo(inBig.x, 10);
    expect(inSmall.y).toBeCloseTo(inBig.y, 10);
  });

  it('does not divide by zero before layout', () => {
    expect(toNormalizedPoint(10, 10, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('keeps points outside the stage outside 0–1 (drag continues off-canvas)', () => {
    const box = { left: 100, top: 100, width: 200, height: 400 };
    const point = toNormalizedPoint(50, 600, box);
    expect(point.x).toBeLessThan(0);
    expect(point.y).toBeGreaterThan(1);
  });
});

describe('rotatedRectContains', () => {
  const rect = { x: 0.4, y: 0.4, w: 0.2, h: 0.1 };

  it('contains the centre and rejects far points', () => {
    expect(rotatedRectContains(rect, 0, { x: 0.5, y: 0.45 }, PORTRAIT)).toBe(true);
    expect(rotatedRectContains(rect, 0, { x: 0.1, y: 0.1 }, PORTRAIT)).toBe(false);
  });

  it('treats edges as inside', () => {
    expect(rotatedRectContains(rect, 0, { x: 0.4, y: 0.4 }, PORTRAIT)).toBe(true);
    expect(rotatedRectContains(rect, 0, { x: 0.6, y: 0.5 }, PORTRAIT)).toBe(true);
  });

  it('swaps axes for a 90° rotation on a non-square stage (pixel-space rotation)', () => {
    // 0.2 × 0.1 of 1080×1920 = 216 × 192 px — nearly square, so use a clearer
    // rect: 0.5 wide × 0.05 tall = 540 × 96 px.
    const wide = { x: 0.25, y: 0.45, w: 0.5, h: 0.05 };
    const centre = { x: 0.5, y: 0.475 };
    // 100 px to the right of centre is inside the unrotated rect…
    expect(rotatedRectContains(wide, 0, { x: centre.x + 100 / 1080, y: centre.y }, PORTRAIT)).toBe(true);
    // …but outside once it is rotated 90° (now 96 px wide there).
    expect(rotatedRectContains(wide, 90, { x: centre.x + 100 / 1080, y: centre.y }, PORTRAIT)).toBe(false);
    // A point 150 px above the centre is outside unrotated, inside rotated.
    expect(rotatedRectContains(wide, 0, { x: centre.x, y: centre.y - 150 / 1920 }, PORTRAIT)).toBe(false);
    expect(rotatedRectContains(wide, 90, { x: centre.x, y: centre.y - 150 / 1920 }, PORTRAIT)).toBe(true);
  });

  it('honours negative rotation', () => {
    const wide = { x: 0.25, y: 0.45, w: 0.5, h: 0.05 };
    const centre = { x: 0.5, y: 0.475 };
    expect(rotatedRectContains(wide, -90, { x: centre.x, y: centre.y + 150 / 1920 }, PORTRAIT)).toBe(true);
  });

  it('rejects degenerate rects', () => {
    expect(rotatedRectContains({ x: 0.5, y: 0.5, w: 0, h: 0 }, 0, { x: 0.5, y: 0.5 }, PORTRAIT)).toBe(false);
  });
});

describe('hitTestLayers', () => {
  const layers: Layer[] = [
    text('bottom', { rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, zIndex: 1 }),
    text('top', { rect: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, zIndex: 5 }),
    text('hidden', { rect: { x: 0, y: 0, w: 1, h: 1 }, zIndex: 9, visible: false }),
    text('locked', { rect: { x: 0.7, y: 0.7, w: 0.3, h: 0.3 }, zIndex: 9, locked: true }),
  ];

  it('returns the topmost visible layer under the point', () => {
    expect(hitTestLayers(layers, { x: 0.3, y: 0.3 }, PORTRAIT)?.id).toBe('top');
  });

  it('falls through to a lower layer outside the top rect', () => {
    expect(hitTestLayers(layers, { x: 0.05, y: 0.05 }, PORTRAIT)?.id).toBe('bottom');
  });

  it('ignores hidden layers', () => {
    expect(hitTestLayers(layers, { x: 0.95, y: 0.05 }, PORTRAIT)).toBeNull();
  });

  it('skips locked layers by default but can include them', () => {
    expect(hitTestLayers(layers, { x: 0.8, y: 0.8 }, PORTRAIT)).toBeNull();
    expect(hitTestLayers(layers, { x: 0.8, y: 0.8 }, PORTRAIT, { ignoreLocked: false })?.id).toBe('locked');
  });

  it('respects rotation when the stage is not square', () => {
    const wide = text('wide', { rect: { x: 0.25, y: 0.45, w: 0.5, h: 0.05 }, rotation: 90 });
    // 150px above the centre: outside while unrotated, inside after rotating.
    expect(hitTestLayers([{ ...wide, rotation: 0 }], { x: 0.5, y: 0.4 }, PORTRAIT)).toBeNull();
    expect(hitTestLayers([wide], { x: 0.5, y: 0.4 }, PORTRAIT)?.id).toBe('wide');
  });

  it('works for every stage preset', () => {
    for (const preset of Object.values(STAGE_PRESETS)) {
      expect(hitTestLayers(layers, { x: 0.3, y: 0.3 }, preset)?.id).toBe('top');
    }
  });
});

describe('translateRect', () => {
  it('keeps the layer fully inside the stage', () => {
    const moved = translateRect({ x: 0.9, y: 0.95, w: 0.2, h: 0.2 }, 0.5, 0.5);
    expect(moved.x).toBeCloseTo(0.8, 6);
    expect(moved.y).toBeCloseTo(0.8, 6);
  });

  it('clamps negative deltas at the origin', () => {
    expect(translateRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, -0.5, -0.5)).toMatchObject({ x: 0, y: 0 });
  });

  it('preserves size', () => {
    const moved = translateRect({ x: 0.1, y: 0.1, w: 0.3, h: 0.1 }, 0.05, 0.02);
    expect(moved.w).toBeCloseTo(0.3, 6);
    expect(moved.h).toBeCloseTo(0.1, 6);
  });
});

describe('resizeRectFromCorner', () => {
  const base = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };

  it('grows the se corner without moving the origin', () => {
    const rect = resizeRectFromCorner(base, 'se', 0.1, 0.05);
    expect(rect).toMatchObject({ x: 0.2, y: 0.3 });
    expect(rect.w).toBeCloseTo(0.5, 6);
    expect(rect.h).toBeCloseTo(0.25, 6);
  });

  it('moves the origin when dragging nw, keeping the opposite corner fixed', () => {
    const rect = resizeRectFromCorner(base, 'nw', 0.1, 0.05);
    expect(rect.x).toBeCloseTo(0.3, 6);
    expect(rect.y).toBeCloseTo(0.35, 6);
    expect(rect.x + rect.w).toBeCloseTo(0.6, 6);
    expect(rect.y + rect.h).toBeCloseTo(0.5, 6);
  });

  it('never goes below the minimum size', () => {
    const rect = resizeRectFromCorner(base, 'se', -10, -10);
    expect(rect.w).toBeCloseTo(MIN_LAYER_SIZE, 6);
    expect(rect.h).toBeCloseTo(MIN_LAYER_SIZE, 6);
  });

  it('stops at the stage edges instead of overflowing', () => {
    const rect = resizeRectFromCorner(base, 'se', 5, 5);
    expect(rect.x + rect.w).toBeCloseTo(1, 6);
    expect(rect.y + rect.h).toBeCloseTo(1, 6);

    const nw = resizeRectFromCorner(base, 'nw', -5, -5);
    expect(nw.x).toBe(0);
    expect(nw.y).toBe(0);
  });

  it('handles ne and sw symmetrically', () => {
    const ne = resizeRectFromCorner(base, 'ne', 0.1, -0.05);
    expect(ne.x).toBeCloseTo(0.2, 6);
    expect(ne.w).toBeCloseTo(0.5, 6);
    expect(ne.y).toBeCloseTo(0.25, 6);
    expect(ne.h).toBeCloseTo(0.25, 6);

    const sw = resizeRectFromCorner(base, 'sw', -0.1, 0.05);
    expect(sw.x).toBeCloseTo(0.1, 6);
    expect(sw.w).toBeCloseTo(0.5, 6);
    expect(sw.h).toBeCloseTo(0.25, 6);
  });
});

describe('resizeRectBy (keyboard)', () => {
  it('grows and shrinks from the bottom-right', () => {
    const grown = resizeRectBy({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, 0.1, 0.05);
    expect(grown).toMatchObject({ x: 0.2, y: 0.3 });
    expect(grown.w).toBeCloseTo(0.5, 6);
    expect(grown.h).toBeCloseTo(0.25, 6);
  });

  it('clamps at the minimum size and at the stage edge', () => {
    const tiny = resizeRectBy({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 }, -10, -10);
    expect(tiny.w).toBeCloseTo(MIN_LAYER_SIZE, 6);
    expect(tiny.h).toBeCloseTo(MIN_LAYER_SIZE, 6);

    const wide = resizeRectBy({ x: 0.5, y: 0.5, w: 0.3, h: 0.3 }, 10, 10);
    expect(wide.x + wide.w).toBeCloseTo(1, 6);
    expect(wide.y + wide.h).toBeCloseTo(1, 6);
  });
});

describe('stage-independence', () => {
  it('keeps the same relative position on 9:16, 1:1 and 16:9', () => {
    const rect = { x: 0.13, y: 0.71, w: 0.42, h: 0.08 };
    for (const preset of Object.values(STAGE_PRESETS)) {
      const px = rectToPixels(rect, preset);
      expect(px.x / preset.width).toBeCloseTo(rect.x, 10);
      expect(px.y / preset.height).toBeCloseTo(rect.y, 10);
      expect(px.w / preset.width).toBeCloseTo(rect.w, 10);
      expect(px.h / preset.height).toBeCloseTo(rect.h, 10);
    }
  });

  it('a pointer delta converts back to the same normalised delta on any stage size', () => {
    // 37px and 41px of travel on a 270×480 preview.
    const box = { left: 0, top: 0, width: 270, height: 480 };
    const start = toNormalizedPoint(10, 10, box);
    const end = toNormalizedPoint(47, 51, box);
    const moved = translateRect({ x: 0.2, y: 0.2, w: 0.2, h: 0.1 }, end.x - start.x, end.y - start.y);
    expect(moved.x).toBeCloseTo(0.2 + 37 / 270, 10);
    expect(moved.y).toBeCloseTo(0.2 + 41 / 480, 10);
  });
});

describe('helpers', () => {
  it('compares rects with an epsilon', () => {
    expect(rectEquals({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe(true);
    expect(rectEquals({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, { x: 0.1, y: 0.2, w: 0.3, h: 0.401 })).toBe(false);
    expect(rectEquals({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, { x: 0.1, y: 0.2, w: 0.3, h: 0.400000001 })).toBe(true);
  });

  it('renders rects as percentage styles (no pixels anywhere)', () => {
    expect(rectToPercentStyle({ x: 0.125, y: 0.5, w: 0.25, h: 0.125 })).toEqual({
      left: '12.5%',
      top: '50%',
      width: '25%',
      height: '12.5%',
    });
  });
});
