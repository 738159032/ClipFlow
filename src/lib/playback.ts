import type { AnimationConfig } from './types';

/**
 * Mutable playback clock shared by the 3D driver and the 2D overlay.
 *
 * Kept outside React state on purpose: at 60fps a setState per frame would
 * re-render the whole editor. The HUD samples it on a slow interval instead.
 */
export class PlaybackClock {
  timeMs = 0;
  playing = false;
  durationMs: number;

  constructor(durationMs: number) {
    this.durationMs = Math.max(1, durationMs);
  }

  setDuration(durationMs: number): void {
    this.durationMs = Math.max(1, durationMs);
    if (this.timeMs > this.durationMs) this.timeMs = 0;
  }

  advance(deltaMs: number): void {
    if (!this.playing) return;
    this.timeMs = (this.timeMs + deltaMs) % this.durationMs;
  }

  seek(ms: number): void {
    const clamped = Math.min(this.durationMs, Math.max(0, ms));
    this.timeMs = clamped;
  }

  progress(): number {
    return this.timeMs / this.durationMs;
  }

  play(): void {
    if (this.timeMs >= this.durationMs - 1) this.timeMs = 0;
    this.playing = true;
  }

  pause(): void {
    this.playing = false;
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }
}

export function createPlaybackClock(animation: AnimationConfig): PlaybackClock {
  return new PlaybackClock(animation.durationMs);
}
