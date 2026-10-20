import { computeImageDrawRect } from '../assets/validate';
import { designScale, rectToPixels } from '../layout';
import type {
  BackgroundConfig,
  ImageLayer,
  Layer,
  PriceTagLayer,
  StageSize,
  TextLayer,
  WatermarkLayer,
} from '../types';

/**
 * The single 2D rasteriser.
 *
 * Both the live preview overlay and the video export compositor call these
 * functions with the *same* stage size, so a text layer cannot look different
 * in the exported MP4 than it does in the preview. Everything is expressed in
 * stage pixels; callers that need HiDPI scale the context, never the geometry.
 */

type Ctx = CanvasRenderingContext2D;

/** Resolves an image asset id to something `drawImage` accepts. */
export type ImageLookup = (assetId: string) => CanvasImageSource | null;

export interface DrawOptions {
  /** Skip layers that are hidden. Default true. */
  respectVisibility?: boolean;
  /**
   * Image resolver. The preview and the export compositor both pass
   * `imageRegistry.source`, which is what guarantees identical output. When it
   * is missing (or the asset is gone) the layer draws an explicit placeholder
   * instead of silently disappearing.
   */
  images?: ImageLookup;
}

export function drawBackground(ctx: Ctx, background: BackgroundConfig, stage: StageSize): void {
  if (background.type === 'solid') {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, stage.width, stage.height);
    return;
  }
  // Angle is measured clockwise from "to bottom" so 0deg = vertical gradient.
  const rad = (background.angleDeg * Math.PI) / 180;
  const cx = stage.width / 2;
  const cy = stage.height / 2;
  const half = Math.hypot(stage.width, stage.height) / 2;
  const dx = Math.sin(rad) * half;
  const dy = -Math.cos(rad) * half;
  const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  gradient.addColorStop(0, background.from);
  gradient.addColorStop(1, background.to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, stage.width, stage.height);
}

export function drawLayers(
  ctx: Ctx,
  layers: readonly Layer[],
  stage: StageSize,
  options: DrawOptions = {},
): void {
  const respectVisibility = options.respectVisibility ?? true;
  const ordered = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  for (const layer of ordered) {
    if (respectVisibility && !layer.visible) continue;
    if (layer.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    drawOne(ctx, layer, stage, options);
    ctx.restore();
  }
}

function withRotation(ctx: Ctx, layer: Layer, stage: StageSize, draw: () => void): void {
  const box = rectToPixels(layer.rect, stage);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.translate(cx, cy);
  if (layer.rotation !== 0) ctx.rotate((layer.rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  draw();
}

function drawOne(ctx: Ctx, layer: Layer, stage: StageSize, options: DrawOptions): void {
  switch (layer.type) {
    case 'text':
      withRotation(ctx, layer, stage, () => drawText(ctx, layer, stage));
      break;
    case 'price':
      withRotation(ctx, layer, stage, () => drawPrice(ctx, layer, stage));
      break;
    case 'watermark':
      withRotation(ctx, layer, stage, () => drawWatermark(ctx, layer, stage));
      break;
    case 'image':
      withRotation(ctx, layer, stage, () => drawImageLayer(ctx, layer, stage, options.images));
      break;
  }
}

function sourceSize(source: CanvasImageSource): { width: number; height: number } {
  const candidate = source as {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    videoWidth?: number;
    videoHeight?: number;
  };
  return {
    width: candidate.naturalWidth || candidate.videoWidth || candidate.width || 0,
    height: candidate.naturalHeight || candidate.videoHeight || candidate.height || 0,
  };
}

function drawImageLayer(ctx: Ctx, layer: ImageLayer, stage: StageSize, images?: ImageLookup): void {
  const box = rectToPixels(layer.rect, stage);
  const radius = Math.max(0, layer.radius * designScale(stage.width));
  const source = images?.(layer.assetId) ?? null;

  ctx.save();
  roundRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.clip();

  if (!source) {
    // Visible, deterministic placeholder — never a silently empty frame.
    ctx.fillStyle = 'rgba(120, 132, 150, 0.10)';
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = 'rgba(120, 132, 150, 0.85)';
    ctx.lineWidth = Math.max(1, stage.width * 0.002);
    ctx.setLineDash([stage.width * 0.012, stage.width * 0.008]);
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.setLineDash([]);
    const labelSize = Math.max(12, stage.width * 0.022);
    ctx.font = `500 ${labelSize}px "Inter", "Noto Sans SC", system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(90, 100, 116, 0.9)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('图片未就绪', box.x + box.w / 2, box.y + box.h / 2);
    ctx.restore();
    return;
  }

  const size = sourceSize(source);
  if (size.width <= 0 || size.height <= 0) {
    ctx.restore();
    return;
  }
  const d = computeImageDrawRect(size, { w: box.w, h: box.h }, layer.fit);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, d.sx, d.sy, d.sw, d.sh, box.x + d.dx, box.y + d.dy, d.dw, d.dh);
  ctx.restore();
}

function setFont(ctx: Ctx, layer: TextLayer, sizePx: number): void {
  ctx.font = `${layer.fontWeight} ${sizePx}px ${layer.fontFamily}`;
  // letterSpacing is not in the DOM lib typings for all TS versions.
  const withSpacing = ctx as Ctx & { letterSpacing?: string };
  if ('letterSpacing' in ctx) withSpacing.letterSpacing = `${layer.letterSpacing}px`;
  ctx.textBaseline = 'top';
}

/** Greedy wrap, per explicit line. Character based so CJK text wraps. */
export function wrapText(ctx: Ctx, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    if (rawLine.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const char of Array.from(rawLine)) {
      const candidate = line + char;
      if (line !== '' && ctx.measureText(candidate).width > maxWidth) {
        out.push(line);
        line = char;
      } else {
        line = candidate;
      }
    }
    out.push(line);
  }
  return out;
}

function drawText(ctx: Ctx, layer: TextLayer, stage: StageSize): void {
  const box = rectToPixels(layer.rect, stage);
  const sizePx = layer.fontSize * designScale(stage.width);
  setFont(ctx, layer, sizePx);

  const lines = wrapText(ctx, layer.text, box.w);
  const lineHeight = sizePx * layer.lineHeight;

  ctx.textAlign = layer.align === 'center' ? 'center' : layer.align === 'right' ? 'right' : 'left';
  const anchorX = layer.align === 'center' ? box.x + box.w / 2 : layer.align === 'right' ? box.x + box.w : box.x;

  if (layer.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = sizePx * 0.25;
    ctx.shadowOffsetY = sizePx * 0.05;
  }

  lines.forEach((line, index) => {
    const y = box.y + index * lineHeight;
    if (layer.stroke && layer.stroke.width > 0) {
      ctx.lineWidth = layer.stroke.width * designScale(stage.width);
      ctx.strokeStyle = layer.stroke.color;
      ctx.lineJoin = 'round';
      ctx.strokeText(line, anchorX, y);
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, anchorX, y);
  });

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function drawPrice(ctx: Ctx, layer: PriceTagLayer, stage: StageSize): void {
  const box = rectToPixels(layer.rect, stage);
  const radius = layer.radius * designScale(stage.width);
  roundRect(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.fillStyle = layer.fill;
  ctx.fill();

  const amountPx = layer.fontSize * designScale(stage.width);
  const captionPx = amountPx * 0.26;
  const padX = amountPx * 0.42;

  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = layer.textColor;

  const baseline = box.y + box.h * 0.62;
  ctx.font = `600 ${amountPx * 0.5}px "Inter", system-ui, sans-serif`;
  ctx.fillText(layer.currency, box.x + padX, baseline - amountPx * 0.42);

  const currencyWidth = ctx.measureText(layer.currency).width;
  ctx.font = `800 ${amountPx}px "Inter", "Noto Sans SC", system-ui, sans-serif`;
  ctx.fillText(layer.amount, box.x + padX + currencyWidth + amountPx * 0.06, baseline);

  ctx.globalAlpha *= 0.78;
  ctx.font = `500 ${captionPx}px "Inter", "Noto Sans SC", system-ui, sans-serif`;
  ctx.fillText(layer.caption, box.x + padX, box.y + box.h * 0.86);
}

function drawWatermark(ctx: Ctx, layer: WatermarkLayer, stage: StageSize): void {
  const box = rectToPixels(layer.rect, stage);
  const sizePx = layer.fontSize * designScale(stage.width);
  ctx.font = `600 ${sizePx}px "Inter", "Noto Sans SC", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = layer.color;
  ctx.fillText(layer.text, box.x + box.w / 2, box.y + box.h / 2);
}

/** Utility used by tests and by the "frames are identical" assertion. */
export function describeLayerBox(layer: Layer, stage: StageSize): string {
  const box = rectToPixels(layer.rect, stage);
  return `${layer.id}:${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.w)},${Math.round(box.h)}@${layer.zIndex}`;
}
