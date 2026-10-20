'use client';

import { useFrame } from '@react-three/fiber';
import { useEffect } from 'react';
import { sampleAnimation } from '@/lib/timeline';
import type { AnimationConfig } from '@/lib/types';
import { PlaybackClock } from '@/lib/playback';
import type { StageRuntime } from './runtime';

/**
 * Advances the playback clock and writes the sampled transform onto the pivot.
 * The exporter writes the exact same values through the same `sampleAnimation`
 * function, frame by frame, while paused — see RendererBridge.
 */
export function AnimationDriver({
  clock,
  animation,
  runtime,
}: {
  clock: PlaybackClock;
  animation: AnimationConfig;
  runtime: StageRuntime;
}) {
  useEffect(() => {
    clock.setDuration(animation.durationMs);
  }, [clock, animation.durationMs]);

  useFrame((_, delta) => {
    const pivot = runtime.pivot;
    if (!pivot) return;
    // Clamp delta so tab-switch spikes do not jump the timeline.
    clock.advance(Math.min(delta, 0.1) * 1000);
    const sample = sampleAnimation(animation, clock.timeMs);
    pivot.rotation.y = sample.rotationY;
    pivot.position.y = sample.positionY;
    pivot.scale.setScalar(sample.scale);
  });

  return null;
}
