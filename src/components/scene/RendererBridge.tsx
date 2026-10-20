'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import type * as THREE from 'three';
import { sampleAnimation } from '@/lib/timeline';
import type { AnimationConfig } from '@/lib/types';
import type { StageRuntime } from './runtime';

export interface RendererHandle {
  /** Switch the live renderer to the export resolution (and pause nothing). */
  begin: (width: number, height: number) => Promise<void>;
  /** Render one frame at `timeMs` and return the canvas holding it. */
  renderAt: (timeMs: number) => HTMLCanvasElement;
  /** Restore the preview resolution. */
  end: () => void;
  getSize: () => { width: number; height: number };
  /** Force a repaint (used when the timeline is scrubbed while paused). */
  requestRender: () => void;
}

/**
 * Bridges the R3F renderer to the exporter.
 *
 * This is the reason the exported video matches the preview: the exporter does
 * not build a second scene, it drives *this* renderer, with the same camera,
 * lights, materials and the same `sampleAnimation` timeline.
 */
export function RendererBridge({
  runtime,
  animation,
  onReady,
}: {
  runtime: StageRuntime;
  animation: AnimationConfig;
  onReady: (handle: RendererHandle | null) => void;
}) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const handle: RendererHandle = {
      async begin(width, height) {
        gl.setPixelRatio(1);
        gl.setSize(width, height, false);
        const perspective = camera as THREE.PerspectiveCamera;
        perspective.aspect = width / height;
        perspective.updateProjectionMatrix();
        gl.render(scene, camera);
      },
      renderAt(timeMs) {
        const pivot = runtime.pivot;
        if (pivot) {
          const sample = sampleAnimation(animation, timeMs);
          pivot.rotation.y = sample.rotationY;
          pivot.position.y = sample.positionY;
          pivot.scale.setScalar(sample.scale);
        }
        gl.render(scene, camera);
        return gl.domElement;
      },
      end() {
        const parent = gl.domElement.parentElement;
        const width = parent?.clientWidth ?? gl.domElement.clientWidth;
        const height = parent?.clientHeight ?? gl.domElement.clientHeight;
        gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        gl.setSize(Math.max(1, width), Math.max(1, height), false);
        const perspective = camera as THREE.PerspectiveCamera;
        perspective.aspect = Math.max(1, width) / Math.max(1, height);
        perspective.updateProjectionMatrix();
        invalidate();
      },
      getSize() {
        return { width: gl.domElement.width, height: gl.domElement.height };
      },
      requestRender() {
        gl.render(scene, camera);
        invalidate();
      },
    };

    onReady(handle);
    return () => onReady(null);
  }, [gl, scene, camera, runtime, animation, invalidate, onReady]);

  return null;
}
