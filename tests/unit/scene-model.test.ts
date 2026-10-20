import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  applyMaterialConfig,
  applyMaterialTexture,
  cameraPositionFrom,
  createTextureFromSource,
  disposeObject3D,
  isExternalTexture,
  normalizeObject,
} from '@/lib/scene/model';

function boxMesh(size: [number, number, number] = [2, 4, 6]): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(...size);
  const material = new THREE.MeshStandardMaterial();
  return new THREE.Mesh(geometry, material);
}

describe('normalizeObject', () => {
  it('scales the largest dimension to the target size', () => {
    const mesh = boxMesh([2, 4, 6]);
    const result = normalizeObject(mesh, 2.4);
    expect(result.appliedScale).toBeCloseTo(0.4, 6);
    expect(result.size.z).toBeCloseTo(2.4, 5);
    expect(result.size.x).toBeCloseTo(0.8, 5);
    expect(result.size.y).toBeCloseTo(1.6, 5);
  });

  it('centres the object on the origin', () => {
    const mesh = boxMesh([2, 4, 6]);
    mesh.position.set(10, -5, 3);
    normalizeObject(mesh, 2.4);
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const center = box.getCenter(new THREE.Vector3());
    expect(center.x).toBeCloseTo(0, 5);
    expect(center.y).toBeCloseTo(0, 5);
    expect(center.z).toBeCloseTo(0, 5);
  });

  it('frames any model to the same max dimension regardless of source units', () => {
    const small = normalizeObject(boxMesh([0.1, 0.2, 0.3]), 2.4);
    const large = normalizeObject(boxMesh([100, 200, 300]), 2.4);
    expect(small.size.z).toBeCloseTo(2.4, 4);
    expect(large.size.z).toBeCloseTo(2.4, 4);
  });

  it('does not explode on an empty object', () => {
    const empty = new THREE.Object3D();
    const result = normalizeObject(empty, 2.4);
    expect(result.appliedScale).toBe(1);
    expect(Number.isFinite(result.size.x)).toBe(true);
  });
});

describe('applyMaterialConfig', () => {
  it('writes metalness/roughness onto untextured materials', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.MeshStandardMaterial;
    const report = applyMaterialConfig(mesh, { presetId: 'metal', color: '#aabbcc', metalness: 0.9, roughness: 0.2, mapAssetId: null }, 1.2);
    expect(report.meshes).toBe(1);
    expect(report.texturedKept).toBe(0);
    expect(material.metalness).toBeCloseTo(0.9, 6);
    expect(material.roughness).toBeCloseTo(0.2, 6);
    expect(material.envMapIntensity).toBeCloseTo(1.2, 6);
    expect(`#${material.color.getHexString()}`).toBe('#aabbcc');
  });

  it('keeps the texture and the base colour of textured materials', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.map = new THREE.DataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1);
    material.color.set('#123456');
    const report = applyMaterialConfig(mesh, { presetId: 'matte', color: '#ffffff', metalness: 0, roughness: 1, mapAssetId: null });
    expect(report.texturedKept).toBe(1);
    expect(`#${material.color.getHexString()}`).toBe('#123456');
    expect(material.roughness).toBeCloseTo(1, 6);
  });

  it('handles material arrays', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      [new THREE.MeshStandardMaterial(), new THREE.MeshStandardMaterial()],
    );
    const report = applyMaterialConfig(mesh, { presetId: 'gloss', color: '#ffffff', metalness: 0.1, roughness: 0.1, mapAssetId: null });
    expect(report.materials).toBe(2);
  });
});

describe('disposeObject3D', () => {
  it('disposes geometry, materials and textures', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.map = new THREE.DataTexture(new Uint8Array([1, 2, 3, 4]), 1, 1);
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose');
    const materialSpy = vi.spyOn(material, 'dispose');
    const textureSpy = vi.spyOn(material.map, 'dispose');

    const stats = disposeObject3D(mesh);

    expect(stats).toEqual({ geometries: 1, materials: 1, textures: 1 });
    expect(geometrySpy).toHaveBeenCalledOnce();
    expect(materialSpy).toHaveBeenCalledOnce();
    expect(textureSpy).toHaveBeenCalledOnce();
  });

  it('does not double-dispose shared materials', () => {
    const shared = new THREE.MeshStandardMaterial();
    const root = new THREE.Group();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), shared));
    root.add(new THREE.Mesh(new THREE.SphereGeometry(), shared));
    const spy = vi.spyOn(shared, 'dispose');
    const stats = disposeObject3D(root);
    expect(stats.materials).toBe(1);
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('cameraPositionFrom', () => {
  it('places the camera at the requested distance from the orbit target', () => {
    const target = new THREE.Vector3(0, 1, 0);
    const position = cameraPositionFrom({ distance: 5, azimuthDeg: 0, polarDeg: 90, targetY: 1 });
    expect(position.clone().sub(target).length()).toBeCloseTo(5, 5);
    expect(position.y).toBeCloseTo(1, 5);
    expect(position.z).toBeCloseTo(5, 5);
  });

  it('keeps the camera above the target when polar is small', () => {
    const position = cameraPositionFrom({ distance: 5, azimuthDeg: 0, polarDeg: 30, targetY: 0 });
    expect(position.y).toBeGreaterThan(3);
  });
});

describe('applyMaterialTexture', () => {
  it('swaps the map, remembers the original and restores it', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.MeshStandardMaterial;
    const original = new THREE.DataTexture(new Uint8Array([9, 9, 9, 255]), 1, 1);
    material.map = original;

    const external = createTextureFromSource({} as unknown as CanvasImageSource);
    const applied = applyMaterialTexture(mesh, external);
    expect(applied.replaced).toBe(1);
    expect(material.map).toBe(external);
    expect(material.userData.__originalMap).toBe(original);
    expect(isExternalTexture(external)).toBe(true);

    // Base colour is neutralised while the external map is active.
    expect(`#${material.color.getHexString()}`).toBe('#ffffff');

    applyMaterialTexture(mesh, null);
    expect(material.map).toBe(original);
    expect(material.userData.__textureApplied).toBeUndefined();
    expect(`#${material.color.getHexString()}`).toBe('#ffffff');
  });

  it('restores a tinted base colour after removing the external map', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.color.set('#123456');
    applyMaterialTexture(mesh, createTextureFromSource({} as unknown as CanvasImageSource));
    expect(`#${material.color.getHexString()}`).toBe('#ffffff');
    applyMaterialTexture(mesh, null);
    expect(`#${material.color.getHexString()}`).toBe('#123456');
  });

  it('restores "no map" for models that had no texture', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.MeshStandardMaterial;
    material.map = null;
    applyMaterialTexture(mesh, createTextureFromSource({} as unknown as CanvasImageSource));
    applyMaterialTexture(mesh, null);
    expect(material.map).toBeNull();
  });

  it('is idempotent: applying twice still restores the true original', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.MeshStandardMaterial;
    const original = new THREE.DataTexture(new Uint8Array([1, 1, 1, 255]), 1, 1);
    material.map = original;
    const external = createTextureFromSource({} as unknown as CanvasImageSource);
    applyMaterialTexture(mesh, external);
    applyMaterialTexture(mesh, external);
    expect(material.userData.__originalMap).toBe(original);
    applyMaterialTexture(mesh, null);
    expect(material.map).toBe(original);
  });
});

describe('disposeObject3D · external textures', () => {
  it('never disposes a texture owned by an image asset', () => {
    const mesh = boxMesh();
    const material = mesh.material as THREE.MeshStandardMaterial;
    const original = new THREE.DataTexture(new Uint8Array([5, 5, 5, 255]), 1, 1);
    material.map = original;
    const external = createTextureFromSource({} as unknown as CanvasImageSource);
    const externalSpy = vi.spyOn(external, 'dispose');
    const originalSpy = vi.spyOn(original, 'dispose');

    applyMaterialTexture(mesh, external);
    const stats = disposeObject3D(mesh);

    expect(externalSpy).not.toHaveBeenCalled();
    // The parked GLB map is disposed even though it is not on the material.
    expect(originalSpy).toHaveBeenCalledOnce();
    expect(stats.textures).toBe(1);
  });
});
