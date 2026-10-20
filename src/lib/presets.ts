import type {
  AnimationConfig,
  AnimationPresetId,
  Layer,
  LightingConfig,
  MaterialConfig,
  MaterialPresetId,
  PriceTagLayer,
  ProjectConfig,
  TextLayer,
  WatermarkLayer,
} from './types';

export const FIXTURE_MODEL = {
  id: 'fixture-astronaut',
  name: 'astronaut.glb',
  url: '/models/astronaut.glb',
} as const;

export const MATERIAL_PRESETS: Record<
  MaterialPresetId,
  { label: string; metalness: number; roughness: number; color: string | null }
> = {
  matte: { label: '哑光', metalness: 0, roughness: 0.85, color: null },
  gloss: { label: '高光', metalness: 0.15, roughness: 0.18, color: null },
  metal: { label: '金属', metalness: 0.95, roughness: 0.28, color: null },
  ceramic: { label: '陶瓷', metalness: 0, roughness: 0.32, color: '#f2efe9' },
};

/** Light rig parameters per preset. Values are consumed by <SceneLights/>. */
export const LIGHTING_PRESETS: Record<
  string,
  { label: string; key: number; fill: number; ambient: number; env: number; keyColor: string; fillColor: string }
> = {
  studio: { label: '影棚白', key: 2.6, fill: 1.1, ambient: 0.5, env: 1.0, keyColor: '#ffffff', fillColor: '#dfe8ff' },
  soft: { label: '柔光箱', key: 1.6, fill: 1.6, ambient: 0.9, env: 1.35, keyColor: '#fff6ea', fillColor: '#ffffff' },
  sunset: { label: '日落暖调', key: 3.0, fill: 0.7, ambient: 0.35, env: 0.75, keyColor: '#ffb066', fillColor: '#6f7dff' },
  noir: { label: '暗调硬光', key: 4.2, fill: 0.25, ambient: 0.18, env: 0.35, keyColor: '#ffffff', fillColor: '#8ea2ff' },
};

export const MATERIAL_DEFAULTS: MaterialConfig = {
  presetId: 'gloss',
  color: '#d8dde6',
  metalness: 0.15,
  roughness: 0.18,
  mapAssetId: null,
};

export const LIGHTING_DEFAULTS: LightingConfig = {
  presetId: 'studio',
  keyIntensity: 2.6,
  fillIntensity: 1.1,
  ambientIntensity: 0.5,
  envIntensity: 1,
  background: { type: 'gradient', from: '#f4f6fa', to: '#cfd8e6', angleDeg: 160 },
};

export const ANIMATION_DEFAULTS: AnimationConfig = {
  presetId: 'turntable',
  durationMs: 5000,
  fps: 30,
  loop: true,
};

export const DEFAULT_CAMERA = {
  fov: 38,
  distance: 5.4,
  azimuthDeg: 24,
  polarDeg: 78,
  targetY: 0.12,
};

function textLayer(over: Partial<TextLayer> & Pick<TextLayer, 'id' | 'name'>): TextLayer {
  return {
    type: 'text',
    visible: true,
    locked: false,
    rect: { x: 0.08, y: 0.07, w: 0.84, h: 0.09 },
    rotation: 0,
    opacity: 1,
    zIndex: 10,
    text: 'NEW ARRIVAL',
    fontSize: 64,
    fontFamily: '"Inter", "Noto Sans SC", system-ui, -apple-system, sans-serif',
    fontWeight: 700,
    color: '#12161f',
    align: 'left',
    lineHeight: 1.15,
    letterSpacing: 2,
    shadow: false,
    stroke: null,
    ...over,
  };
}

export function createPriceLayer(over: Partial<PriceTagLayer> = {}): PriceTagLayer {
  return {
    id: `price-${Math.random().toString(36).slice(2, 8)}`,
    name: '价格标签',
    type: 'price',
    visible: true,
    locked: false,
    rect: { x: 0.08, y: 0.79, w: 0.5, h: 0.1 },
    rotation: 0,
    opacity: 1,
    zIndex: 20,
    currency: '¥',
    amount: '1,299',
    caption: '限时首发价',
    fill: '#101418',
    textColor: '#ffffff',
    radius: 28,
    fontSize: 90,
    ...over,
  };
}

export function createWatermarkLayer(over: Partial<WatermarkLayer> = {}): WatermarkLayer {
  return {
    id: `watermark-${Math.random().toString(36).slice(2, 8)}`,
    name: '水印',
    type: 'watermark',
    visible: true,
    locked: false,
    rect: { x: 0.56, y: 0.9, w: 0.36, h: 0.05 },
    rotation: 0,
    opacity: 0.42,
    zIndex: 30,
    text: 'ClipFlow Studio',
    fontSize: 40,
    color: '#ffffff',
    ...over,
  };
}

export const DEFAULT_LAYERS: Layer[] = [
  textLayer({ id: 'title', name: '主标题', text: 'AURORA 系列', fontSize: 92, rect: { x: 0.08, y: 0.075, w: 0.84, h: 0.1 } }),
  textLayer({
    id: 'subtitle',
    name: '副标题',
    text: '3D 商品展示 · 实时合成',
    fontSize: 40,
    fontWeight: 400,
    color: '#5a6474',
    letterSpacing: 1,
    zIndex: 11,
    rect: { x: 0.08, y: 0.155, w: 0.84, h: 0.05 },
  }),
  createPriceLayer(),
  createWatermarkLayer(),
];

export function createDefaultProject(): ProjectConfig {
  return {
    schemaVersion: 1,
    stage: { width: 1080, height: 1920 },
    camera: { ...DEFAULT_CAMERA },
    product: {
      assetId: FIXTURE_MODEL.id,
      modelName: FIXTURE_MODEL.name,
      sourceUrl: FIXTURE_MODEL.url,
      scale: 1,
      rotationDeg: [0, 0, 0],
      offset: [0, 0, 0],
    },
    material: { ...MATERIAL_DEFAULTS },
    lighting: { ...LIGHTING_DEFAULTS, background: { ...LIGHTING_DEFAULTS.background } },
    animation: { ...ANIMATION_DEFAULTS },
    layers: DEFAULT_LAYERS.map((layer) => ({ ...layer, rect: { ...layer.rect } })),
    templateId: null,
  };
}

/* ---------------------------------------------------------------- templates */

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  /** One-line background description shown on the gallery card. */
  backgroundSummary: string;
  /** Style fields applied over the current project. Content is preserved. */
  patch: {
    material: MaterialConfig;
    lighting: LightingConfig;
    animation: AnimationConfig;
    camera: ProjectConfig['camera'];
  };
}

export const ANIMATION_LABELS: Record<AnimationPresetId, string> = {
  none: '静止',
  turntable: '转台',
  float: '悬浮',
  reveal: '入场',
};

export const TEMPLATES: TemplateDefinition[] = [
  {
    id: 'clean-studio',
    name: '极简影棚',
    description: '白底 + 高光材质 + 缓慢转台，适合电商主图视频',
    backgroundSummary: '浅灰渐变 · 160°',
    patch: {
      material: { presetId: 'gloss', color: '#d8dde6', metalness: 0.15, roughness: 0.18, mapAssetId: null },
      lighting: {
        presetId: 'studio',
        keyIntensity: 2.6,
        fillIntensity: 1.1,
        ambientIntensity: 0.5,
        envIntensity: 1,
        background: { type: 'gradient', from: '#f7f8fb', to: '#d7dee9', angleDeg: 160 },
      },
      animation: { presetId: 'turntable', durationMs: 5000, fps: 30, loop: true },
      camera: { ...DEFAULT_CAMERA },
    },
  },
  {
    id: 'sunset-drop',
    name: '日落新品',
    description: '暖色渐变 + 悬浮动效，适合社交平台上新',
    backgroundSummary: '暖桃→酱紫 · 200°',
    patch: {
      material: { presetId: 'matte', color: '#e8d6c4', metalness: 0, roughness: 0.8, mapAssetId: null },
      lighting: {
        presetId: 'sunset',
        keyIntensity: 3,
        fillIntensity: 0.7,
        ambientIntensity: 0.35,
        envIntensity: 0.75,
        background: { type: 'gradient', from: '#ffd9a8', to: '#8a5a7a', angleDeg: 200 },
      },
      animation: { presetId: 'float', durationMs: 6000, fps: 30, loop: true },
      camera: { ...DEFAULT_CAMERA, distance: 5.1, polarDeg: 82 },
    },
  },
  {
    id: 'noir-metal',
    name: '暗调金属',
    description: '硬光 + 金属材质 + 入场动效，适合质感大片',
    backgroundSummary: '近黑渐变 · 180°',
    patch: {
      material: { presetId: 'metal', color: '#b8c2cc', metalness: 0.95, roughness: 0.28, mapAssetId: null },
      lighting: {
        presetId: 'noir',
        keyIntensity: 4.2,
        fillIntensity: 0.25,
        ambientIntensity: 0.18,
        envIntensity: 0.35,
        background: { type: 'gradient', from: '#1a1f27', to: '#05070b', angleDeg: 180 },
      },
      animation: { presetId: 'reveal', durationMs: 4000, fps: 30, loop: true },
      camera: { ...DEFAULT_CAMERA, distance: 5.7, polarDeg: 74 },
    },
  },
  {
    id: 'mint-ceramic',
    name: '薄荷陶瓷',
    description: '柔光 + 陶瓷质感 + 慢悬浮，适合家居与美妆',
    backgroundSummary: '薄荷白→浅绿 · 135°',
    patch: {
      material: { presetId: 'ceramic', color: '#f4f7f2', metalness: 0, roughness: 0.32, mapAssetId: null },
      lighting: {
        presetId: 'soft',
        keyIntensity: 1.8,
        fillIntensity: 1.5,
        ambientIntensity: 0.85,
        envIntensity: 1.25,
        background: { type: 'gradient', from: '#f2fbf6', to: '#b7dfcd', angleDeg: 135 },
      },
      animation: { presetId: 'float', durationMs: 7000, fps: 30, loop: true },
      camera: { ...DEFAULT_CAMERA, distance: 4.9, polarDeg: 80 },
    },
  },
  {
    id: 'cobalt-tech',
    name: '钴蓝科技',
    description: '深蓝渐变 + 冷补光 + 长转台，适合数码与科技品',
    backgroundSummary: '钴蓝→墨蓝 · 210°',
    patch: {
      material: { presetId: 'gloss', color: '#a9bcd8', metalness: 0.55, roughness: 0.22, mapAssetId: null },
      lighting: {
        presetId: 'soft',
        keyIntensity: 2.2,
        fillIntensity: 1.9,
        ambientIntensity: 0.45,
        envIntensity: 1.1,
        background: { type: 'gradient', from: '#20325a', to: '#080f1f', angleDeg: 210 },
      },
      animation: { presetId: 'turntable', durationMs: 8000, fps: 30, loop: true },
      camera: { ...DEFAULT_CAMERA, distance: 5.2, polarDeg: 76 },
    },
  },
  {
    id: 'rose-editorial',
    name: '玫瑰画报',
    description: '蜜粉渐变 + 柔光近景 + 入场，适合服饰与香氛',
    backgroundSummary: '蜜粉→玫瑰 · 150°',
    patch: {
      material: { presetId: 'matte', color: '#f6dbe3', metalness: 0.05, roughness: 0.62, mapAssetId: null },
      lighting: {
        presetId: 'soft',
        keyIntensity: 1.6,
        fillIntensity: 1.3,
        ambientIntensity: 0.9,
        envIntensity: 1.15,
        background: { type: 'gradient', from: '#fff0f5', to: '#e9a9bd', angleDeg: 150 },
      },
      animation: { presetId: 'reveal', durationMs: 3500, fps: 30, loop: true },
      camera: { ...DEFAULT_CAMERA, distance: 4.6, polarDeg: 81 },
    },
  },
];

/**
 * Applying a template writes only "style" fields. Product assets, layer
 * content and layer geometry belong to the user and are preserved — this is
 * the contract described in docs/ARCHITECTURE.md.
 */
export function applyTemplate(config: ProjectConfig, templateId: string): ProjectConfig {
  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) return config;
  return {
    ...config,
    templateId: template.id,
    // A template restyles the material but must not silently drop the user's
    // own base-colour texture.
    material: { ...template.patch.material, mapAssetId: config.material.mapAssetId },
    lighting: {
      ...template.patch.lighting,
      background: { ...template.patch.lighting.background },
    },
    animation: { ...template.patch.animation },
    camera: { ...template.patch.camera },
  };
}

/** When a user edits a style field, the project no longer matches the template. */
export function detachFromTemplate(config: ProjectConfig): ProjectConfig {
  if (config.templateId === null) return config;
  return { ...config, templateId: null };
}
