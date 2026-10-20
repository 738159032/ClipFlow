'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { LIGHTING_PRESETS } from '@/lib/presets';
import type { LightingConfig } from '@/lib/types';

const FALLBACK_PRESET = {
  label: '影棚白',
  key: 2.6,
  fill: 1.1,
  ambient: 0.5,
  env: 1,
  keyColor: '#ffffff',
  fillColor: '#dfe8ff',
};

/** Three-point rig with preset-driven intensities and colours. */
export function SceneLights({ lighting }: { lighting: LightingConfig }) {
  const preset = LIGHTING_PRESETS[lighting.presetId] ?? FALLBACK_PRESET;
  const scene = useThree((state) => state.scene);

  useEffect(() => {
    scene.background = null;
  }, [scene]);

  return (
    <>
      <ambientLight intensity={lighting.ambientIntensity} />
      <directionalLight
        position={[3.4, 4.6, 3.2]}
        intensity={lighting.keyIntensity}
        color={preset.keyColor}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-bias={-0.0008}
        shadow-camera-near={0.5}
        shadow-camera-far={18}
        shadow-camera-left={-3.2}
        shadow-camera-right={3.2}
        shadow-camera-top={3.2}
        shadow-camera-bottom={-3.2}
      />
      <directionalLight position={[-3.8, 2.2, -1.6]} intensity={lighting.fillIntensity} color={preset.fillColor} />
      <spotLight position={[0, 4.2, -3.4]} angle={0.7} penumbra={1} intensity={lighting.keyIntensity * 0.35} color={preset.keyColor} />
      {/* Warm bounce from below keeps the underside of the product readable. */}
      <pointLight position={[0, -1.6, 2.4]} intensity={lighting.fillIntensity * 0.25} color={preset.fillColor} />
    </>
  );
}
