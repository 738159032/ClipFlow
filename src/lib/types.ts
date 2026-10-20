/**
 * Single source of truth for the project data model.
 *
 * All persisted/editor state is plain JSON-serialisable data (no DOM handles,
 * no THREE objects, no Blob). Runtime objects (renderer, textures, object URLs)
 * live outside this model and are managed by dedicated owners — see
 * docs/ARCHITECTURE.md.
 */

export type Vec3 = [number, number, number];

export interface Rect {
  /** Normalised 0..1 relative to stage width, origin at top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export type StageSize = {
  width: number;
  height: number;
};

export type BackgroundConfig =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; from: string; to: string; angleDeg: number };

/* ------------------------------------------------------------------ layers */

export interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Normalised geometry; resolution independent by construction. */
  rect: Rect;
  /** Degrees, clockwise, around the rect centre. */
  rotation: number;
  /** 0..1 */
  opacity: number;
  /** Paint order, ascending (larger = on top). */
  zIndex: number;
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  /** Font size expressed in design pixels at DESIGN_WIDTH (1080). */
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Multiplier of fontSize. */
  lineHeight: number;
  letterSpacing: number;
  shadow: boolean;
  stroke?: { color: string; width: number } | null;
}

export interface PriceTagLayer extends LayerBase {
  type: 'price';
  currency: string;
  amount: string;
  caption: string;
  fill: string;
  textColor: string;
  /** Corner radius in design px. */
  radius: number;
  fontSize: number;
}

export interface WatermarkLayer extends LayerBase {
  type: 'watermark';
  text: string;
  fontSize: number;
  color: string;
  /** Watermarks are rendered semi-transparent by design. */
  opacity: number;
}

/**
 * An image layer draws a decoded image asset into its rect.
 *
 * `assetId` is metadata only: the Object URL / ImageBitmap live in
 * `src/lib/assets/registry.ts`, never in the store. It is *not* a model
 * texture — image assets never touch the product material.
 */
export interface ImageLayer extends LayerBase {
  type: 'image';
  assetId: string;
  fit: 'cover' | 'contain';
  /** Corner radius in design px at DESIGN_WIDTH. */
  radius: number;
  /** Accessible description (also used as the layer name fallback). */
  alt: string;
}

export type Layer = TextLayer | PriceTagLayer | WatermarkLayer | ImageLayer;

/* ----------------------------------------------------------------- presets */

export type MaterialPresetId = 'matte' | 'gloss' | 'metal' | 'ceramic';
export type LightingPresetId = 'studio' | 'soft' | 'sunset' | 'noir';
export type AnimationPresetId = 'none' | 'turntable' | 'float' | 'reveal';

/* ------------------------------------------------------------------ config */

export interface ProductConfig {
  /** Id of the uploaded asset, or null when using the built-in fixture. */
  assetId: string | null;
  /** Original file name, for display only. */
  modelName: string | null;
  /** URL used by the loader (object URL for uploads, static path for fixture). */
  sourceUrl: string;
  /** Extra uniform scale applied on top of auto-framing. */
  scale: number;
  /** Degrees. */
  rotationDeg: Vec3;
  /** World-space offset in stage units. */
  offset: Vec3;
}

export interface MaterialConfig {
  presetId: MaterialPresetId;
  color: string;
  metalness: number;
  roughness: number;
  /**
   * Image asset used as the product's base-colour map. `null` keeps the GLB's
   * own texture. This is the *material* path — completely separate from
   * `ImageLayer` (see DECISIONS D13).
   */
  mapAssetId: string | null;
}

export interface LightingConfig {
  presetId: LightingPresetId;
  keyIntensity: number;
  fillIntensity: number;
  ambientIntensity: number;
  envIntensity: number;
  background: BackgroundConfig;
}

export interface CameraConfig {
  fov: number;
  distance: number;
  /** Degrees, orbit around Y. */
  azimuthDeg: number;
  /** Degrees, 0 = top, 90 = horizon. */
  polarDeg: number;
  targetY: number;
}

export interface AnimationConfig {
  presetId: AnimationPresetId;
  durationMs: number;
  fps: number;
  loop: boolean;
}

export interface ProjectConfig {
  schemaVersion: 1;
  stage: StageSize;
  camera: CameraConfig;
  product: ProductConfig;
  material: MaterialConfig;
  lighting: LightingConfig;
  animation: AnimationConfig;
  layers: Layer[];
  /** Last applied template id, null when the user started from scratch. */
  templateId: string | null;
}

/* ------------------------------------------------------------------ assets */

export interface AssetRecord {
  id: string;
  kind: 'model' | 'image';
  name: string;
  /** Object URL (revocable) for uploads. */
  url: string;
  bytes: number;
  createdAt: number;
}

/**
 * Serializable metadata for an uploaded image. Deliberately contains no Blob,
 * Object URL, ImageBitmap or DOM node — those are runtime objects owned by
 * `imageRegistry` and released explicitly.
 */
export interface ImageAssetMeta {
  id: string;
  name: string;
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: number;
  width: number;
  height: number;
  createdAt: number;
}
