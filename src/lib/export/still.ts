import { imageRegistry } from '../assets/registry';
import { FrameCompositor } from './compositor';
import type { SceneFrameSource } from './mp4';
import type { ProjectConfig } from '../types';

/**
 * Renders the exact composited frame at `timeMs` at full stage resolution and
 * returns it as a PNG blob. This is the cheapest way to prove the 3D + 2D
 * composition pipeline independently of the video encoder.
 */
export async function captureStillFrame(
  source: SceneFrameSource,
  config: ProjectConfig,
  timeMs: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = config.stage;
  const compositor = new FrameCompositor({ width, height });
  try {
    await source.begin(width, height);
    const glCanvas = source.renderAt(timeMs);
    const composed = compositor.draw(
      glCanvas,
      config.lighting.background,
      config.layers,
      glCanvas.width,
      glCanvas.height,
      imageRegistry.source,
    );
    const blob = await new Promise<Blob | null>((resolve) => composed.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('无法生成 PNG 静帧');
    return { blob, width, height };
  } finally {
    source.end();
    compositor.dispose();
  }
}
