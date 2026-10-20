import type { AnimationConfig, AnimationPresetId } from './types';

/**
 * A frame sample is the *only* thing the renderer needs in order to draw the
 * product at a given time. Preview and export both call `sampleAnimation`,
 * which is why the exported video cannot drift from what the user previewed.
 */
export interface FrameSample {
  /** Radians around Y. */
  rotationY: number;
  /** Stage units added to the product group Y. */
  positionY: number;
  /** Extra uniform scale multiplier. */
  scale: number;
}

export const IDENTITY_SAMPLE: FrameSample = { rotationY: 0, positionY: 0, scale: 1 };

export function normalizeTime(timeMs: number, durationMs: number): number {
  if (!Number.isFinite(timeMs) || durationMs <= 0) return 0;
  const wrapped = ((timeMs % durationMs) + durationMs) % durationMs;
  return wrapped / durationMs;
}

export function sampleAnimation(
  animation: Pick<AnimationConfig, 'presetId' | 'durationMs'>,
  timeMs: number,
): FrameSample {
  const preset: AnimationPresetId = animation.presetId;
  const p = normalizeTime(timeMs, animation.durationMs);
  const tau = Math.PI * 2;

  switch (preset) {
    case 'turntable':
      return { rotationY: p * tau, positionY: 0, scale: 1 };
    case 'float':
      return {
        rotationY: p * tau * 0.18,
        positionY: Math.sin(p * tau) * 0.09,
        scale: 1,
      };
    case 'reveal': {
      // 0 -> 1 ease-out over the first 40% then settle; slow spin afterwards.
      const t = Math.min(1, p / 0.4);
      const eased = 1 - Math.pow(1 - t, 3);
      return {
        rotationY: (1 - eased) * -0.6 + p * tau * 0.06,
        positionY: (1 - eased) * 0.35,
        scale: 0.82 + eased * 0.18,
      };
    }
    case 'none':
    default:
      return IDENTITY_SAMPLE;
  }
}

export function totalFrames(fps: number, durationMs: number): number {
  if (fps <= 0 || durationMs <= 0) return 0;
  return Math.max(1, Math.round((durationMs / 1000) * fps));
}

/** Timestamp (ms) of frame `index` — integer math avoids float drift. */
export function frameTimeMs(index: number, fps: number): number {
  return (index * 1000) / fps;
}

/** Microseconds, what VideoFrame.timestamp expects. */
export function frameTimestampUs(index: number, fps: number): number {
  return Math.round((index * 1_000_000) / fps);
}

/** "00:03.20" */
export function formatTimecode(ms: number): string {
  const safe = Math.max(0, ms);
  const totalSeconds = safe / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const centis = Math.floor((safe % 1000) / 10);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}
