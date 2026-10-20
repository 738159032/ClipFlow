import type { Rect } from './types';

/** Layer geometry is authored against this width; all font sizes use it too. */
export const DESIGN_WIDTH = 1080;

export const STAGE_PRESETS = {
  portrait: { width: 1080, height: 1920, label: '竖屏 9:16 · 1080×1920' },
  square: { width: 1080, height: 1080, label: '方形 1:1 · 1080×1080' },
  landscape: { width: 1920, height: 1080, label: '横屏 16:9 · 1920×1080' },
  live: { width: 1280, height: 720, label: '720p 16:9 · 1280×720' },
} as const;

export type StagePresetKey = keyof typeof STAGE_PRESETS;

/**
 * Design-space scale factor. A font authored as 64 "design px" occupies
 * 64 * (stageWidth / 1080) real pixels, so layouts authored on portrait stay
 * visually consistent on square/landscape stages.
 */
export function designScale(stageWidth: number): number {
  return stageWidth / DESIGN_WIDTH;
}

/** Convert a normalised rect to stage pixels. */
export function rectToPixels(
  rect: Rect,
  stage: { width: number; height: number },
): { x: number; y: number; w: number; h: number } {
  return {
    x: rect.x * stage.width,
    y: rect.y * stage.height,
    w: rect.w * stage.width,
    h: rect.h * stage.height,
  };
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Move a normalised rect by a normalised delta, keeping it inside the stage. */
export function moveRect(rect: Rect, dx: number, dy: number): Rect {
  const x = clamp01(Math.min(rect.x + dx, 1 - rect.w));
  const y = clamp01(Math.min(rect.y + dy, 1 - rect.h));
  return { ...rect, x, y };
}

/**
 * Letterbox a stage inside a container: the CSS box that preserves aspect
 * ratio. Pure function so it can be unit tested without a DOM.
 */
export function fitStageBox(
  container: { width: number; height: number },
  stage: { width: number; height: number },
): { width: number; height: number } {
  if (container.width <= 0 || container.height <= 0) return { width: 0, height: 0 };
  const stageAspect = stage.width / stage.height;
  const containerAspect = container.width / container.height;
  if (containerAspect > stageAspect) {
    return { width: container.height * stageAspect, height: container.height };
  }
  return { width: container.width, height: container.width / stageAspect };
}

/** Device pixel ratio applied to a stage-sized canvas, capped for memory. */
export function canvasPixelRatio(available: number): number {
  return Math.min(3, Math.max(1, available));
}
