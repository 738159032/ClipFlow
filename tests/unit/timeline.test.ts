import { describe, expect, it } from 'vitest';
import {
  formatTimecode,
  frameTimestampUs,
  frameTimeMs,
  normalizeTime,
  sampleAnimation,
  totalFrames,
} from '@/lib/timeline';
import { PlaybackClock } from '@/lib/playback';

const turntable = { presetId: 'turntable' as const, durationMs: 5000 };

describe('normalizeTime', () => {
  it('wraps negative and overshooting times into [0,1)', () => {
    expect(normalizeTime(0, 5000)).toBe(0);
    expect(normalizeTime(2500, 5000)).toBe(0.5);
    expect(normalizeTime(6000, 5000)).toBeCloseTo(0.2, 6);
    expect(normalizeTime(-1000, 5000)).toBeCloseTo(0.8, 6);
  });

  it('is defensive about invalid durations', () => {
    expect(normalizeTime(1000, 0)).toBe(0);
    expect(normalizeTime(Number.NaN, 5000)).toBe(0);
  });
});

describe('sampleAnimation', () => {
  it('makes exactly one full turn at the end of a turntable loop', () => {
    const start = sampleAnimation(turntable, 0);
    const quarter = sampleAnimation(turntable, 1250);
    const half = sampleAnimation(turntable, 2500);
    expect(start.rotationY).toBeCloseTo(0, 6);
    expect(quarter.rotationY).toBeCloseTo(Math.PI / 2, 6);
    expect(half.rotationY).toBeCloseTo(Math.PI, 6);
  });

  it('is deterministic — preview and export see identical values', () => {
    for (const t of [0, 13.7, 999, 2500, 4999.9]) {
      expect(sampleAnimation(turntable, t)).toEqual(sampleAnimation(turntable, t));
    }
  });

  it('keeps the float preset bounded', () => {
    for (let t = 0; t <= 6000; t += 137) {
      const sample = sampleAnimation({ presetId: 'float', durationMs: 6000 }, t);
      expect(Math.abs(sample.positionY)).toBeLessThanOrEqual(0.0901);
      expect(sample.scale).toBeCloseTo(1, 6);
    }
  });

  it('starts the reveal preset small and settles at 1', () => {
    const first = sampleAnimation({ presetId: 'reveal', durationMs: 4000 }, 0);
    const settled = sampleAnimation({ presetId: 'reveal', durationMs: 4000 }, 2000);
    expect(first.scale).toBeCloseTo(0.82, 6);
    expect(settled.scale).toBeCloseTo(1, 6);
  });

  it('returns the identity for the none preset', () => {
    expect(sampleAnimation({ presetId: 'none', durationMs: 5000 }, 1234)).toEqual({
      rotationY: 0,
      positionY: 0,
      scale: 1,
    });
  });
});

describe('frame math', () => {
  it('computes total frames from fps and duration', () => {
    expect(totalFrames(30, 5000)).toBe(150);
    expect(totalFrames(24, 5000)).toBe(120);
    expect(totalFrames(60, 1000)).toBe(60);
    expect(totalFrames(0, 5000)).toBe(0);
  });

  it('produces strictly increasing, evenly spaced timestamps', () => {
    const fps = 30;
    let previous = -1;
    for (let i = 0; i < 150; i += 1) {
      const us = frameTimestampUs(i, fps);
      expect(us).toBeGreaterThan(previous);
      expect(us).toBe(Math.round((i * 1_000_000) / fps));
      previous = us;
    }
    // Last frame stays inside the requested duration.
    expect(frameTimestampUs(150, fps)).toBe(5_000_000);
  });

  it('maps frame index to milliseconds without drift', () => {
    expect(frameTimeMs(0, 30)).toBe(0);
    expect(frameTimeMs(30, 30)).toBe(1000);
    expect(frameTimeMs(149, 30)).toBeCloseTo(4966.67, 1);
  });

  it('formats timecode for the HUD', () => {
    expect(formatTimecode(0)).toBe('00:00.00');
    expect(formatTimecode(1234)).toBe('00:01.23');
    expect(formatTimecode(65_400)).toBe('01:05.40');
  });
});

describe('PlaybackClock', () => {
  it('advances only while playing and wraps at the duration', () => {
    const clock = new PlaybackClock(1000);
    clock.advance(500);
    expect(clock.timeMs).toBe(0);
    clock.play();
    clock.advance(1200);
    expect(clock.timeMs).toBeCloseTo(200, 6);
    clock.pause();
    clock.advance(200);
    expect(clock.timeMs).toBeCloseTo(200, 6);
  });

  it('clamps seeks and reports progress', () => {
    const clock = new PlaybackClock(2000);
    clock.seek(-50);
    expect(clock.timeMs).toBe(0);
    clock.seek(5000);
    expect(clock.timeMs).toBe(2000);
    clock.seek(1000);
    expect(clock.progress()).toBeCloseTo(0.5, 6);
  });
});
