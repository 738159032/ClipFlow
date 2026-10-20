'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Offline (no network) PBR environment. RoomEnvironment is generated in code,
 * so a product preview never blocks on an HDR download.
 */
export function StageEnvironment({ envIntensity }: { envIntensity: number }) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    // Older three builds accepted the renderer here; newer ones ignore args.
    const RoomEnvCtor = RoomEnvironment as unknown as new (renderer?: THREE.WebGLRenderer) => THREE.Scene;
    const room = new RoomEnvCtor(gl);
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = envIntensity;

    return () => {
      scene.environment = null;
      scene.environmentIntensity = 1;
      target.dispose();
      pmrem.dispose();
      room.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach((m) => m.dispose());
        else material?.dispose();
      });
    };
    // `envIntensity` is applied by the effect below; re-generating the PMREM
    // on every slider tick would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene]);

  useEffect(() => {
    scene.environmentIntensity = envIntensity;
  }, [scene, envIntensity]);

  return null;
}
