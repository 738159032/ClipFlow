import * as THREE from 'three';
import type { MaterialConfig } from '../types';

export interface NormalizeResult {
  /** Bounding box size after normalisation, in world units. */
  size: THREE.Vector3;
  /** Uniform scale that was applied to the object. */
  appliedScale: number;
  /** Original centre, in the model's own units. */
  originalCenter: THREE.Vector3;
}

/**
 * Auto-frame a GLB: recentre on the origin and scale so the largest dimension
 * equals `targetSize`. Every uploaded model therefore sits in the same camera
 * framing without per-asset tuning.
 *
 * Mutates the object (position/scale) and returns the resulting metrics.
 */
export function normalizeObject(object: THREE.Object3D, targetSize = 2.4): NormalizeResult {
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxAxis = Math.max(size.x, size.y, size.z);

  if (!Number.isFinite(maxAxis) || maxAxis <= 0) {
    // Degenerate/empty model: leave it untouched but report zero size.
    return { size, appliedScale: 1, originalCenter: center };
  }

  const appliedScale = targetSize / maxAxis;
  object.scale.multiplyScalar(appliedScale);
  object.updateMatrixWorld(true);

  // Re-measure after scaling and shift so the *actual* centre lands on the
  // origin. Doing it against the pre-scale centre would introduce an error
  // proportional to any pre-existing offset on the object.
  const scaledCenter = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3());
  object.position.sub(scaledCenter);
  object.updateMatrixWorld(true);

  return {
    size: size.multiplyScalar(appliedScale),
    appliedScale,
    originalCenter: center,
  };
}

export interface MaterialApplyReport {
  meshes: number;
  materials: number;
  /** Materials whose base colour was left alone because they use a texture. */
  texturedKept: number;
}

/**
 * Apply the material preset to every mesh material.
 *
 * Textured materials keep their map — replacing the base colour of a textured
 * PBR asset destroys its identity, so only roughness/metalness env response is
 * overridden in that case.
 */
/**
 * Creates a base-colour texture from a decoded image asset.
 *
 * The texture is flagged as *external*: it is owned by the caller (the texture
 * effect in `ProductModel`) and must NOT be disposed by `disposeObject3D`,
 * which only owns textures that came from the GLB.
 */
export function createTextureFromSource(source: CanvasImageSource): THREE.Texture {
  const texture = new THREE.Texture(source as unknown as HTMLImageElement);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  texture.userData.external = true;
  texture.needsUpdate = true;
  return texture;
}

export function isExternalTexture(texture: THREE.Texture): boolean {
  return Boolean((texture.userData as Record<string, unknown> | undefined)?.external);
}

interface TextureSwapData {
  __originalMap?: THREE.Texture | null;
  /** Base colour while the external map is active (textures are not tinted). */
  __originalColor?: string;
  __textureApplied?: boolean;
}

export interface TextureApplyReport {
  meshes: number;
  /** Materials whose map was actually swapped/restored. */
  replaced: number;
}

/**
 * Swaps every mesh's base-colour map for `texture`, remembering the original so
 * `applyMaterialTexture(root, null)` can put it back. Passing null restores.
 *
 * The GLB's own UV layout is used as-is — there is no projection/UV editing
 * (see DECISIONS D13).
 */
export function applyMaterialTexture(root: THREE.Object3D, texture: THREE.Texture | null): TextureApplyReport {
  const report: TextureApplyReport = { meshes: 0, replaced: 0 };

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    report.meshes += 1;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (const material of materials) {
      if (!material) continue;
      const standard = material as THREE.MeshStandardMaterial;
      if (!('map' in standard)) continue;
      const data = standard.userData as TextureSwapData;
      const hadMap = Boolean(standard.map);

      if (texture) {
        if (!data.__textureApplied) {
          data.__originalMap = standard.map ?? null;
          data.__originalColor = `#${standard.color?.getHexString() ?? 'ffffff'}`;
          data.__textureApplied = true;
        }
        standard.map = texture;
        // The base colour multiplies the map; a leftover tint would darken it.
        standard.color?.set('#ffffff');
      } else if (data.__textureApplied) {
        standard.map = data.__originalMap ?? null;
        if (data.__originalColor) standard.color?.set(data.__originalColor);
        data.__originalMap = undefined;
        data.__originalColor = undefined;
        data.__textureApplied = undefined;
      } else {
        continue;
      }
      // Recompiling the shader is only required when the *presence* of a base
      // colour map changes (USE_MAP define). Swapping one map for another does
      // not need it — and skipping it keeps restored frames bit-identical.
      if (hadMap !== Boolean(standard.map)) standard.needsUpdate = true;
      report.replaced += 1;
    }
  });

  return report;
}

export function applyMaterialConfig(
  root: THREE.Object3D,
  config: MaterialConfig,
  envIntensity = 1,
): MaterialApplyReport {
  const report: MaterialApplyReport = { meshes: 0, materials: 0, texturedKept: 0 };
  const color = new THREE.Color(config.color);

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    report.meshes += 1;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

    for (const material of materials) {
      if (!material) continue;
      const standard = material as THREE.MeshStandardMaterial;
      if ('metalness' in standard) standard.metalness = config.metalness;
      if ('roughness' in standard) standard.roughness = config.roughness;
      if ('envMapIntensity' in standard) standard.envMapIntensity = envIntensity;
      const hasMap = Boolean(standard.map);
      if (hasMap) {
        report.texturedKept += 1;
      } else if (standard.color) {
        standard.color.copy(color);
      }
      standard.needsUpdate = true;
      report.materials += 1;
    }
  });

  return report;
}

/** Recursively dispose geometries, materials and their textures. */
export function disposeObject3D(root: THREE.Object3D): { geometries: number; materials: number; textures: number } {
  const stats = { geometries: 0, materials: 0, textures: 0 };
  const disposedMaterials = new Set<THREE.Material>();
  const disposedTextures = new Set<THREE.Texture>();

  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) {
      mesh.geometry.dispose();
      stats.geometries += 1;
    }
    if (!mesh.material) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (!material || disposedMaterials.has(material)) continue;
      disposedMaterials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value && (value as THREE.Texture).isTexture) {
          const texture = value as THREE.Texture;
          // External textures belong to the caller (image asset → material map),
          // never to the GLB. Disposing them here would break a live asset.
          if (isExternalTexture(texture)) continue;
          if (!disposedTextures.has(texture)) {
            texture.dispose();
            disposedTextures.add(texture);
            stats.textures += 1;
          }
        }
      }
      // While an external map is applied, the GLB's original map is parked in
      // userData and is no longer reachable via `material.map` — dispose it
      // explicitly so replacing a model mid-texture cannot leak it.
      const parked = (material.userData as TextureSwapData | undefined)?.__originalMap;
      if (parked && parked.isTexture && !isExternalTexture(parked) && !disposedTextures.has(parked)) {
        parked.dispose();
        disposedTextures.add(parked);
        stats.textures += 1;
      }
      material.dispose();
      stats.materials += 1;
    }
  });

  return stats;
}

/** Camera placement from the spherical config, shared by preset changes. */
export function cameraPositionFrom(config: {
  distance: number;
  azimuthDeg: number;
  polarDeg: number;
  targetY: number;
}): THREE.Vector3 {
  const polar = THREE.MathUtils.degToRad(Math.min(179.5, Math.max(0.5, config.polarDeg)));
  const azimuth = THREE.MathUtils.degToRad(config.azimuthDeg);
  const sinPolar = Math.sin(polar);
  return new THREE.Vector3(
    config.distance * sinPolar * Math.sin(azimuth),
    config.distance * Math.cos(polar) + config.targetY,
    config.distance * sinPolar * Math.cos(azimuth),
  );
}
