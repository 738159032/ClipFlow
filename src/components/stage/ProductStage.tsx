'use client';

import { Canvas } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import type { PlaybackClock } from '@/lib/playback';
import type { ModelMetrics, StageRuntime } from '@/components/scene/runtime';
import { AnimationDriver } from '@/components/scene/AnimationDriver';
import { CameraRig } from '@/components/scene/CameraRig';
import { ProductModel } from '@/components/scene/ProductModel';
import { RendererBridge, type RendererHandle } from '@/components/scene/RendererBridge';
import { SceneErrorBoundary } from '@/components/scene/SceneErrorBoundary';
import { SceneLights } from '@/components/scene/SceneLights';
import { StageEnvironment } from '@/components/scene/StageEnvironment';
import type { ProjectConfig } from '@/lib/types';

export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProductStageProps {
  config: ProjectConfig;
  clock: PlaybackClock;
  runtime: StageRuntime;
  onModelStatus: (status: ModelStatus, payload?: { metrics?: ModelMetrics; error?: string }) => void;
  onRendererReady: (handle: RendererHandle | null) => void;
  onModelDisposed?: (stats: { geometries: number; materials: number; textures: number }) => void;
  /** Increment to force a remount of the scene tree (error recovery / leak test). */
  resetKey?: number;
}

function supportsWebGL(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function ProductStage({
  config,
  clock,
  runtime,
  onModelStatus,
  onRendererReady,
  onModelDisposed,
  resetKey = 0,
}: ProductStageProps) {
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [groundY, setGroundY] = useState(-1.2);
  const [sceneError, setSceneError] = useState<string | null>(null);

  useEffect(() => {
    setWebglOk(supportsWebGL());
  }, []);

  const handleLoad = useCallback(
    (metrics: ModelMetrics) => {
      setGroundY(metrics.groundY);
      setSceneError(null);
      onModelStatus('ready', { metrics });
    },
    [onModelStatus],
  );

  const handleModelError = useCallback(
    (message: string) => {
      setSceneError(message);
      onModelStatus('error', { error: message });
    },
    [onModelStatus],
  );

  const initialCamera = useMemo(() => {
    const { fov, distance, azimuthDeg, polarDeg, targetY } = config.camera;
    const polar = THREE.MathUtils.degToRad(polarDeg);
    const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
    return {
      fov,
      position: [
        distance * Math.sin(polar) * Math.sin(azimuth),
        distance * Math.cos(polar) + targetY,
        distance * Math.sin(polar) * Math.cos(azimuth),
      ] as [number, number, number],
    };
    // Only used for the very first mount; CameraRig owns later updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (webglOk === false) {
    return (
      <div className="stage-fallback" role="alert">
        <strong>无法创建 WebGL 上下文</strong>
        <p>当前浏览器或显卡驱动不支持 WebGL2，3D 预览不可用。请更换浏览器或启用硬件加速。</p>
      </div>
    );
  }

  return (
    <div className="stage-canvas-wrap">
      <SceneErrorBoundary
        onError={(error) => setSceneError(error.message)}
        fallback={(error, reset) => (
          <div className="stage-fallback" role="alert">
            <strong>3D 场景渲染失败</strong>
            <p>{error.message}</p>
            <button type="button" onClick={reset}>
              重试
            </button>
          </div>
        )}
      >
        <Canvas
          key={resetKey}
          dpr={[1, 2]}
          camera={{ fov: initialCamera.fov, position: initialCamera.position, near: 0.05, far: 100 }}
          gl={{ antialias: true, alpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }}
          frameloop="always"
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1;
          }}
        >
          <StageEnvironment envIntensity={config.lighting.envIntensity} />
          <SceneLights lighting={config.lighting} />

          <group
            ref={(node) => {
              runtime.pivot = node;
            }}
          >
            <group
              scale={config.product.scale}
              position={config.product.offset}
              rotation={[
                THREE.MathUtils.degToRad(config.product.rotationDeg[0]),
                THREE.MathUtils.degToRad(config.product.rotationDeg[1]),
                THREE.MathUtils.degToRad(config.product.rotationDeg[2]),
              ]}
            >
              <ProductModel
                sourceUrl={config.product.sourceUrl}
                material={config.material}
                envIntensity={config.lighting.envIntensity}
                runtime={runtime}
                onLoad={handleLoad}
                onError={handleModelError}
                onDispose={onModelDisposed}
              />
            </group>
          </group>

          {/* Shadow catcher: only the shadow is painted, the canvas stays
              transparent so the 2D background shows through. */}
          <mesh receiveShadow position={[0, groundY + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[24, 24]} />
            <shadowMaterial transparent opacity={0.34} />
          </mesh>

          <CameraRig camera={config.camera} runtime={runtime} />
          <AnimationDriver clock={clock} animation={config.animation} runtime={runtime} />
          <RendererBridge runtime={runtime} animation={config.animation} onReady={onRendererReady} />
        </Canvas>
      </SceneErrorBoundary>

      {sceneError ? (
        <div className="stage-canvas-error" role="alert">
          <span>模型/渲染错误：{sceneError}</span>
        </div>
      ) : null}
    </div>
  );
}
