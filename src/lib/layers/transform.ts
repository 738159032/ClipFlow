import { rectToPixels } from '../layout';
import type { Layer, Rect, StageSize } from '../types';

/**
 * Pure geometry for layer editing.
 *
 * Every function speaks *normalised* coordinates (0–1 of the stage), never
 * screen pixels. Pointer maths is converted once, at the DOM boundary, by
 * `toNormalizedPoint`, which is why CSS scaling, device pixel ratio and window
 * resizes cannot make a layer drift.
 */

/** Smallest allowed layer size, in normalised units (≈ 1% of the stage). */
export const MIN_LAYER_SIZE = 0.01;

export const RESIZE_CORNERS = ['nw', 'ne', 'sw', 'se'] as const;
export type ResizeCorner = (typeof RESIZE_CORNERS)[number];

export interface Point {
  x: number;
  y: number;
}

/** The subset of DOMRect the pointer maths needs (keeps this file DOM-free). */
export interface BoxLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Convert a viewport point to normalised stage coordinates.
 *
 * Reads the *live* element box, so the result stays correct after CSS scaling,
 * zooming (device pixel ratio) and window resizes. Deliberately not clamped:
 * drags may leave the stage and are clamped by the rect operations instead.
 */
export function toNormalizedPoint(clientX: number, clientY: number, box: BoxLike): Point {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0 };
  return {
    x: (clientX - box.left) / box.width,
    y: (clientY - box.top) / box.height,
  };
}

/**
 * Point-in-rect test that honours the layer rotation used by the rasteriser.
 *
 * The rotation happens in *stage pixel* space (square pixels), so a 30° layer
 * is not 30° in normalised space when the stage is not square. We therefore
 * measure in pixels, mirroring `drawLayers()` exactly.
 */
export function rotatedRectContains(rect: Rect, rotationDeg: number, point: Point, stage: StageSize): boolean {
  const box = rectToPixels(rect, stage);
  if (box.w <= 0 || box.h <= 0) return false;
  const px = point.x * stage.width;
  const py = point.y * stage.height;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  if (!rotationDeg) {
    return Math.abs(px - cx) <= box.w / 2 && Math.abs(py - cy) <= box.h / 2;
  }

  const rad = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = px - cx;
  const dy = py - cy;
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  return Math.abs(localX) <= box.w / 2 && Math.abs(localY) <= box.h / 2;
}

export interface HitTestOptions {
  /** Locked layers are skipped by default; the panel still lists them. */
  ignoreLocked?: boolean;
}

/** Topmost visible layer under a normalised point, or null. */
export function hitTestLayers(
  layers: readonly Layer[],
  point: Point,
  stage: StageSize,
  options: HitTestOptions = {},
): Layer | null {
  const ignoreLocked = options.ignoreLocked ?? true;
  const ordered = [...layers].filter((layer) => layer.visible && (!ignoreLocked || !layer.locked)).sort(
    (a, b) => b.zIndex - a.zIndex,
  );
  for (const layer of ordered) {
    if (rotatedRectContains(layer.rect, layer.rotation, point, stage)) return layer;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Resize by dragging one corner. `dx`/`dy` are normalised deltas since the
 * pointer went down; the opposite corner stays anchored and the rect is kept
 * inside the stage with a minimum size.
 */
export function resizeRectFromCorner(
  rect: Rect,
  corner: ResizeCorner,
  dx: number,
  dy: number,
  minSize = MIN_LAYER_SIZE,
): Rect {
  const left0 = rect.x;
  const top0 = rect.y;
  const right0 = rect.x + rect.w;
  const bottom0 = rect.y + rect.h;
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';

  let left = left0;
  let right = right0;
  let top = top0;
  let bottom = bottom0;

  if (west) {
    left = clamp(left0 + dx, 0, Math.max(0, right0 - minSize));
  } else {
    right = clamp(right0 + dx, Math.min(1, left0 + minSize), 1);
  }

  if (north) {
    top = clamp(top0 + dy, 0, Math.max(0, bottom0 - minSize));
  } else {
    bottom = clamp(bottom0 + dy, Math.min(1, top0 + minSize), 1);
  }

  return {
    x: left,
    y: top,
    w: Math.max(minSize, right - left),
    h: Math.max(minSize, bottom - top),
  };
}

/** Move with the same clamping rules used by the pointer drag. */
export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  const x = clamp(rect.x + dx, 0, Math.max(0, 1 - rect.w));
  const y = clamp(rect.y + dy, 0, Math.max(0, 1 - rect.h));
  return { ...rect, x, y };
}

/**
 * Keyboard resize: grow/shrink the bottom-right corner by (dw, dh) while the
 * top-left corner stays put. Keeps keyboard editing on the same code path as
 * pointer resizing.
 */
export function resizeRectBy(rect: Rect, dw: number, dh: number): Rect {
  const maxW = 1 - rect.x;
  const maxH = 1 - rect.y;
  return {
    ...rect,
    w: clamp(rect.w + dw, Math.min(MIN_LAYER_SIZE, maxW), maxW),
    h: clamp(rect.h + dh, Math.min(MIN_LAYER_SIZE, maxH), maxH),
  };
}

export function rectEquals(a: Rect, b: Rect, epsilon = 1e-6): boolean {
  return (
    Math.abs(a.x - b.x) <= epsilon &&
    Math.abs(a.y - b.y) <= epsilon &&
    Math.abs(a.w - b.w) <= epsilon &&
    Math.abs(a.h - b.h) <= epsilon
  );
}

/** Percentage style for a DOM box mirroring the rasterised layer. */
export function rectToPercentStyle(rect: Rect): { left: string; top: string; width: string; height: string } {
  return {
    left: `${rect.x * 100}%`,
    top: `${rect.y * 100}%`,
    width: `${rect.w * 100}%`,
    height: `${rect.h * 100}%`,
  };
}
