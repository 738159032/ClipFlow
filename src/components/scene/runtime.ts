import * as THREE from 'three';

export interface ModelMetrics {
  /** Size of the auto-framed model in world units. */
  size: { x: number; y: number; z: number };
  appliedScale: number;
  groundY: number;
  triangles: number;
  meshes: number;
  texturedMaterials: number;
}

/**
 * Mutable runtime slot shared between the 3D components and the exporter.
 * Deliberately *not* React state: the exporter needs the live pivot group,
 * not a snapshot from the last render.
 */
export interface StageRuntime {
  pivot: THREE.Group | null;
  modelRoot: THREE.Object3D | null;
  metrics: ModelMetrics | null;
  /**
   * Gate for OrbitControls. The 2D layer editor flips this off while a layer is
   * being dragged so a stray pointer event can never rotate the product.
   */
  orbitEnabled: boolean;
  /** Registered by CameraRig; applies the gate synchronously. */
  setOrbitEnabled?: (enabled: boolean) => void;
}

export function createStageRuntime(): StageRuntime {
  return { pivot: null, modelRoot: null, metrics: null, orbitEnabled: true };
}

export function countTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute('position');
    if (index) triangles += index.count / 3;
    else if (position) triangles += position.count / 3;
  });
  return Math.round(triangles);
}
