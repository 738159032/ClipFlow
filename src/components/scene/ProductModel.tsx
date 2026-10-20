'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { imageRegistry } from '@/lib/assets/registry';
import {
  applyMaterialConfig,
  applyMaterialTexture,
  createTextureFromSource,
  disposeObject3D,
  normalizeObject,
} from '@/lib/scene/model';
import type { MaterialConfig } from '@/lib/types';
import { countTriangles, type ModelMetrics, type StageRuntime } from './runtime';

export interface ProductModelProps {
  sourceUrl: string;
  material: MaterialConfig;
  envIntensity: number;
  runtime: StageRuntime;
  onLoad: (metrics: ModelMetrics) => void;
  onError: (message: string) => void;
  /** Reports what the cleanup actually released (resource lifecycle proof). */
  onDispose?: (stats: { geometries: number; materials: number; textures: number }) => void;
}

/**
 * Imperative GLB loader.
 *
 * Why not `useGLTF`: the loader cache keeps assets alive forever, which makes
 * "replace the model" leak until a full reload. Here the load/unload boundary
 * is explicit: one effect owns one GLTF, its cleanup disposes geometry,
 * materials and textures.
 */
export function ProductModel({
  sourceUrl,
  material,
  envIntensity,
  runtime,
  onLoad,
  onError,
  onDispose,
}: ProductModelProps) {
  const [root, setRoot] = useState<THREE.Object3D | null>(null);
  const disposeRef = useRef(onDispose);
  disposeRef.current = onDispose;

  useEffect(() => {
    if (!sourceUrl) {
      setRoot(null);
      runtime.modelRoot = null;
      runtime.metrics = null;
      return;
    }
    let cancelled = false;
    let loadedRoot: THREE.Object3D | null = null;
    const loader = new GLTFLoader();

    setRoot(null);
    runtime.modelRoot = null;

    loader.load(
      sourceUrl,
      (gltf) => {
        if (cancelled) {
          disposeObject3D(gltf.scene);
          return;
        }
        const scene = gltf.scene;
        const normalized = normalizeObject(scene, 2.4);
        scene.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.frustumCulled = true;
          }
        });
        const report = applyMaterialConfig(scene, material, envIntensity);
        loadedRoot = scene;
        runtime.modelRoot = scene;
        setRoot(scene);

        const metrics: ModelMetrics = {
          size: { x: normalized.size.x, y: normalized.size.y, z: normalized.size.z },
          appliedScale: normalized.appliedScale,
          groundY: -normalized.size.y / 2,
          triangles: countTriangles(scene),
          meshes: report.meshes,
          texturedMaterials: report.texturedKept,
        };
        runtime.metrics = metrics;
        onLoad(metrics);
      },
      undefined,
      (error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        onError(message || '模型加载失败');
      },
    );

    return () => {
      cancelled = true;
      if (loadedRoot) {
        const stats = disposeObject3D(loadedRoot);
        disposeRef.current?.(stats);
        if (runtime.modelRoot === loadedRoot) runtime.modelRoot = null;
        runtime.metrics = null;
      }
    };
    // `material` and `envIntensity` are applied by the effect below so that
    // tweaking the material never re-downloads or re-parses the GLB.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceUrl]);

  useEffect(() => {
    if (!root) return;
    applyMaterialConfig(root, material, envIntensity);
  }, [root, material, envIntensity]);

  /**
   * Base-colour texture from an uploaded image asset.
   *
   * Ownership: this effect creates the THREE.Texture, so it also disposes it.
   * `disposeObject3D` skips external textures and instead disposes the GLB's
   * original map that we parked in `userData` while the swap was active.
   */
  useEffect(() => {
    if (!root) return;
    const assetId = material.mapAssetId;
    const source = assetId ? imageRegistry.source(assetId) : null;

    if (!assetId || !source) {
      applyMaterialTexture(root, null);
      return;
    }

    const texture = createTextureFromSource(source);
    applyMaterialTexture(root, texture);

    return () => {
      applyMaterialTexture(root, null);
      texture.dispose();
    };
  }, [root, material.mapAssetId]);

  if (!root) return null;
  return <primitive object={root} />;
}
