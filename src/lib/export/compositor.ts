import { drawBackground, drawLayers, type ImageLookup } from '../layers/render';
import type { BackgroundConfig, Layer, StageSize } from '../types';

/**
 * Composites the real WebGL frame with the 2D layers.
 *
 * The 3D canvas is drawn first, then the same `drawLayers` used by the live
 * preview paints on top — one code path, two consumers.
 */
export class FrameCompositor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(readonly stage: StageSize) {
    const canvas = document.createElement('canvas');
    canvas.width = stage.width;
    canvas.height = stage.height;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    if (!ctx) throw new Error('无法创建 2D 合成画布上下文');
    this.canvas = canvas;
    this.ctx = ctx;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  draw(
    glCanvas: CanvasImageSource,
    background: BackgroundConfig,
    layers: readonly Layer[],
    glWidth: number,
    glHeight: number,
    images?: ImageLookup,
  ): HTMLCanvasElement {
    const { ctx, stage } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawBackground(ctx, background, stage);
    if (glWidth > 0 && glHeight > 0) {
      ctx.drawImage(glCanvas, 0, 0, glWidth, glHeight, 0, 0, stage.width, stage.height);
    }
    drawLayers(ctx, layers, stage, { images });
    return this.canvas;
  }

  dispose(): void {
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}
