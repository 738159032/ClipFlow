'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cameraPositionFrom } from '@/lib/scene/model';
import type { CameraConfig } from '@/lib/types';
import type { StageRuntime } from './runtime';

/**
 * Camera framing comes from config (so templates can reposition it), while
 * OrbitControls lets the user inspect the product.
 *
 * Uses the three.js addon directly instead of a wrapper library: it is ~40
 * lines, has no extra dependency and the lifecycle (dispose on unmount) is
 * explicit.
 */
export function CameraRig({ camera: config, runtime }: { camera: CameraConfig; runtime: StageRuntime }) {
  const camera = useThree((state) => state.camera);
  const domElement = useThree((state) => state.gl.domElement);
  const invalidate = useThree((state) => state.invalidate);
  const controlsRef = useRef<OrbitControls | null>(null);
  const position = useMemo(() => cameraPositionFrom(config), [config]);

  useEffect(() => {
    const controls = new OrbitControls(camera, domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.minDistance = 2.2;
    controls.maxDistance = 9;
    controls.minPolarAngle = 0.25;
    controls.maxPolarAngle = Math.PI / 1.85;
    controls.target.set(0, config.targetY, 0);
    controls.enabled = runtime.orbitEnabled;
    // The 2D editor flips this synchronously when a layer drag starts.
    runtime.setOrbitEnabled = (enabled: boolean) => {
      runtime.orbitEnabled = enabled;
      controls.enabled = enabled;
    };
    controls.update();
    controlsRef.current = controls;

    return () => {
      runtime.setOrbitEnabled = undefined;
      controls.dispose();
      controlsRef.current = null;
    };
    // Re-creating the controls on every config change would drop the pointer
    // capture mid-drag; the second effect below applies config updates instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera, domElement, runtime]);

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera;
    perspective.fov = config.fov;
    perspective.near = 0.05;
    perspective.far = 100;
    perspective.position.copy(position);
    perspective.updateProjectionMatrix();
    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(0, config.targetY, 0);
      controls.update();
    } else {
      perspective.lookAt(0, config.targetY, 0);
    }
    invalidate();
  }, [camera, config.fov, config.targetY, position, invalidate]);

  useFrame(() => {
    controlsRef.current?.update();
  });

  return null;
}
