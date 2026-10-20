'use client';

import { create } from 'zustand';
import { fitRectToAspect } from '../lib/assets/validate';
import {
  applyTemplate,
  createDefaultProject,
  createPriceLayer,
  createWatermarkLayer,
  detachFromTemplate,
  FIXTURE_MODEL,
  MATERIAL_PRESETS,
} from '../lib/presets';
import type {
  AnimationConfig,
  AssetRecord,
  CameraConfig,
  ImageAssetMeta,
  ImageLayer,
  Layer,
  LightingConfig,
  MaterialConfig,
  ProductConfig,
  ProjectConfig,
  StageSize,
  TextLayer,
} from '../lib/types';

export type AssetStatus = 'idle' | 'loading' | 'ready' | 'error';

interface EditorState {
  config: ProjectConfig;
  selectedLayerId: string | null;
  asset: AssetRecord | null;
  assetStatus: AssetStatus;
  assetError: string | null;

  /**
   * Image asset *metadata* only (no Blob / Object URL / ImageBitmap).
   * Runtime objects live in `imageRegistry`.
   */
  images: Record<string, ImageAssetMeta>;
  activeImageAssetId: string | null;

  /** Bumps whenever a style field changes so templates can be detached. */
  setStage: (stage: StageSize) => void;
  patchCamera: (patch: Partial<CameraConfig>) => void;
  patchProduct: (patch: Partial<ProductConfig>) => void;
  patchMaterial: (patch: Partial<MaterialConfig>) => void;
  patchLighting: (patch: Partial<LightingConfig>) => void;
  patchAnimation: (patch: Partial<AnimationConfig>) => void;

  applyMaterialPreset: (presetId: MaterialConfig['presetId']) => void;
  applyTemplateById: (templateId: string) => void;
  resetProject: () => void;

  selectLayer: (id: string | null) => void;
  updateLayer: <T extends Layer>(id: string, patch: Partial<T>) => void;
  addLayer: (kind: 'text' | 'price' | 'watermark') => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;

  setModelFile: (file: File) => void;
  useFixtureModel: () => void;
  setAssetStatus: (status: AssetStatus, error?: string | null) => void;

  addImageAsset: (meta: ImageAssetMeta) => void;
  removeImageAsset: (id: string) => void;
  clearImageAssets: () => void;
  addImageLayer: (meta: ImageAssetMeta) => string;
  setLayerImageAsset: (layerId: string, assetId: string) => void;
}

function makeId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Every mutation returns a new object so React/R3F see a changed reference. */
function touch(config: ProjectConfig, patch: Partial<ProjectConfig>): ProjectConfig {
  return { ...config, ...patch };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  config: createDefaultProject(),
  selectedLayerId: 'title',
  asset: null,
  assetStatus: 'idle',
  assetError: null,
  images: {},
  activeImageAssetId: null,

  setStage: (stage) => set({ config: { ...get().config, stage } }),

  patchCamera: (patch) =>
    set({
      config: touch(get().config, {
        camera: { ...get().config.camera, ...patch },
        templateId: null,
      }),
    }),

  patchProduct: (patch) =>
    set({ config: touch(get().config, { product: { ...get().config.product, ...patch } }) }),

  patchMaterial: (patch) =>
    set({
      config: touch(get().config, {
        material: { ...get().config.material, ...patch },
        templateId: null,
      }),
    }),

  patchLighting: (patch) =>
    set({
      config: touch(get().config, {
        lighting: { ...get().config.lighting, ...patch },
        templateId: null,
      }),
    }),

  patchAnimation: (patch) =>
    set({
      config: touch(get().config, {
        animation: { ...get().config.animation, ...patch },
        templateId: null,
      }),
    }),

  applyMaterialPreset: (presetId) => {
    const preset = MATERIAL_PRESETS[presetId];
    if (!preset) return;
    set({
      config: touch(get().config, {
        material: {
          presetId,
          metalness: preset.metalness,
          roughness: preset.roughness,
          color: preset.color ?? get().config.material.color,
          // Switching preset must not throw away an applied image texture.
          mapAssetId: get().config.material.mapAssetId,
        },
        templateId: null,
      }),
    });
  },

  applyTemplateById: (templateId) => {
    set({ config: applyTemplate(get().config, templateId) });
  },

  resetProject: () =>
    set({
      config: createDefaultProject(),
      selectedLayerId: 'title',
      assetStatus: 'idle',
      assetError: null,
      images: {},
      activeImageAssetId: null,
    }),

  selectLayer: (id) => set({ selectedLayerId: id }),

  updateLayer: (id, patch) =>
    set({
      config: touch(get().config, {
        layers: get().config.layers.map((layer) => (layer.id === id ? ({ ...layer, ...patch } as Layer) : layer)),
      }),
    }),

  addLayer: (kind) => {
    const base = get().config.layers;
    const topZ = base.reduce((max, layer) => Math.max(max, layer.zIndex), 0) + 1;
    let layer: Layer;
    if (kind === 'price') {
      layer = { ...createPriceLayer(), id: makeId('price'), zIndex: topZ };
    } else if (kind === 'watermark') {
      layer = { ...createWatermarkLayer(), id: makeId('watermark'), zIndex: topZ };
    } else {
      layer = {
        id: makeId('text'),
        name: '文字图层',
        type: 'text',
        visible: true,
        locked: false,
        rect: { x: 0.08, y: 0.4, w: 0.84, h: 0.08 },
        rotation: 0,
        opacity: 1,
        zIndex: topZ,
        text: '双击编辑文字',
        fontSize: 56,
        fontFamily: '"Inter", "Noto Sans SC", system-ui, sans-serif',
        fontWeight: 600,
        color: '#12161f',
        align: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        shadow: false,
        stroke: null,
      } satisfies TextLayer;
    }
    set({
      config: touch(get().config, { layers: [...base, layer] }),
      selectedLayerId: layer.id,
    });
  },

  removeLayer: (id) =>
    set({
      config: touch(get().config, { layers: get().config.layers.filter((layer) => layer.id !== id) }),
      selectedLayerId: get().selectedLayerId === id ? null : get().selectedLayerId,
    }),

  duplicateLayer: (id) => {
    const source = get().config.layers.find((layer) => layer.id === id);
    if (!source) return;
    const copy: Layer = {
      ...source,
      id: makeId(source.type),
      name: `${source.name} 副本`,
      rect: { ...source.rect, x: Math.min(0.9, source.rect.x + 0.03), y: Math.min(0.9, source.rect.y + 0.03) },
      zIndex: source.zIndex + 1,
    };
    set({ config: touch(get().config, { layers: [...get().config.layers, copy] }), selectedLayerId: copy.id });
  },

  setModelFile: (file) => {
    const previous = get().asset;
    if (previous) URL.revokeObjectURL(previous.url);
    const asset: AssetRecord = {
      id: makeId('asset'),
      kind: 'model',
      name: file.name,
      url: URL.createObjectURL(file),
      bytes: file.size,
      createdAt: Date.now(),
    };
    set({
      asset,
      assetStatus: 'loading',
      assetError: null,
      config: touch(get().config, {
        product: {
          assetId: asset.id,
          modelName: asset.name,
          sourceUrl: asset.url,
          scale: 1,
          rotationDeg: [0, 0, 0],
          offset: [0, 0, 0],
        },
      }),
    });
  },

  useFixtureModel: () => {
    const previous = get().asset;
    if (previous) URL.revokeObjectURL(previous.url);
    set({
      asset: null,
      assetStatus: 'loading',
      assetError: null,
      config: touch(get().config, {
        product: {
          assetId: FIXTURE_MODEL.id,
          modelName: FIXTURE_MODEL.name,
          sourceUrl: FIXTURE_MODEL.url,
          scale: 1,
          rotationDeg: [0, 0, 0],
          offset: [0, 0, 0],
        },
      }),
    });
  },

  setAssetStatus: (status, error = null) => set({ assetStatus: status, assetError: error }),

  addImageAsset: (meta) =>
    set({
      images: { ...get().images, [meta.id]: meta },
      activeImageAssetId: meta.id,
    }),

  removeImageAsset: (id) =>
    set({
      images: Object.fromEntries(Object.entries(get().images).filter(([key]) => key !== id)),
      activeImageAssetId: get().activeImageAssetId === id ? null : get().activeImageAssetId,
    }),

  clearImageAssets: () => set({ images: {}, activeImageAssetId: null }),

  addImageLayer: (meta) => {
    const config = get().config;
    const topZ = config.layers.reduce((max, layer) => Math.max(max, layer.zIndex), 0) + 1;
    const layer: ImageLayer = {
      id: makeId('image'),
      name: meta.name.replace(/\.[^.]+$/, '').slice(0, 24) || '图片图层',
      type: 'image',
      visible: true,
      locked: false,
      // Aspect-correct, centred: a square photo stays square in a 9:16 frame.
      rect: fitRectToAspect(meta.width / Math.max(1, meta.height), config.stage),
      rotation: 0,
      opacity: 1,
      zIndex: topZ,
      assetId: meta.id,
      fit: 'cover',
      radius: 0,
      alt: meta.name,
    };
    set({
      config: touch(config, { layers: [...config.layers, layer] }),
      selectedLayerId: layer.id,
    });
    return layer.id;
  },

  setLayerImageAsset: (layerId, assetId) =>
    set({
      config: touch(get().config, {
        layers: get().config.layers.map((layer) =>
          layer.id === layerId && layer.type === 'image' ? { ...layer, assetId } : layer,
        ),
      }),
    }),
}));

/** Selector helper for the currently selected layer. */
export function selectSelectedLayer(state: EditorState): Layer | null {
  return state.config.layers.find((layer) => layer.id === state.selectedLayerId) ?? null;
}

export { detachFromTemplate };
