import type { BackgroundConfig } from './types';

/**
 * CSS mirror of `drawBackground`. Keeping both in one module makes the
 * background visually identical in the live preview and in the export.
 */
export function backgroundCss(background: BackgroundConfig): string {
  if (background.type === 'solid') return background.color;
  // CSS gradients measure 0deg as "to top", which is what drawBackground does.
  return `linear-gradient(${background.angleDeg}deg, ${background.from}, ${background.to})`;
}
