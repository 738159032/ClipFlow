'use client';

import { useCallback, useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { imageRegistry } from '@/lib/assets/registry';
import { drawLayers } from '@/lib/layers/render';
import { rectEquals } from '@/lib/layers/transform';
import type { PlaybackClock } from '@/lib/playback';
import type { Layer, Rect, StageSize } from '@/lib/types';

export interface LayerOverlayHandle {
  /** Paint one layer at a temporary rect (drag preview) without touching the store. */
  setDraft: (layerId: string, rect: Rect) => void;
  clearDraft: () => void;
  repaint: () => void;
  getCanvas: () => HTMLCanvasElement | null;
}

export interface LayerOverlayProps {
  layers: readonly Layer[];
  stage: StageSize;
  clock: PlaybackClock;
  ref?: Ref<LayerOverlayHandle>;
}

/**
 * Live 2D preview of the layers.
 *
 * It is a plain canvas — not DOM nodes — because the exporter rasterises the
 * layers with the very same function. DOM/CSS text and Canvas2D text do not
 * measure identically (letter spacing, fallback fonts), which would produce a
 * visible mismatch in the exported MP4.
 *
 * Drag previews are painted with a local "draft" rect: the layer follows the
 * pointer at frame rate without a single store write, and the committed rect
 * only arrives on pointerup.
 */
export function LayerOverlay({ layers, stage, clock, ref }: LayerOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const draftRef = useRef<{ id: string; rect: Rect } | null>(null);
  const lastSignatureRef = useRef('');
  const lastTimeRef = useRef(-1);
  const latest = useRef({ layers, stage, clock });
  latest.current = { layers, stage, clock };

  const buildLayers = useCallback((): readonly Layer[] => {
    const draft = draftRef.current;
    const current = latest.current.layers;
    if (!draft) return current;
    return current.map((layer) => (layer.id === draft.id ? { ...layer, rect: draft.rect } : layer));
  }, []);

  const paint = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const { stage: currentStage, clock: currentClock } = latest.current;
    const effective = buildLayers();
    ctx.clearRect(0, 0, currentStage.width, currentStage.height);
    // Same resolver as the exporter → identical image placement.
    drawLayers(ctx, effective, currentStage, { images: imageRegistry.source });
    lastSignatureRef.current = JSON.stringify(effective);
    lastTimeRef.current = currentClock.timeMs;
  }, [buildLayers]);

  useImperativeHandle(
    ref,
    () => ({
      setDraft: (layerId, rect) => {
        draftRef.current = { id: layerId, rect };
        paint();
      },
      clearDraft: () => {
        draftRef.current = null;
        paint();
      },
      repaint: paint,
      getCanvas: () => canvasRef.current,
    }),
    [paint],
  );

  useEffect(() => {
    const draft = draftRef.current;
    if (!draft) return;
    const committed = layers.find((layer) => layer.id === draft.id);
    // Once the store holds exactly the dragged rect, the draft is redundant:
    // dropping it here (instead of on pointerup) avoids a one-frame snap back.
    if (committed && rectEquals(committed.rect, draft.rect)) draftRef.current = null;
  }, [layers]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Backing store equals the export resolution; CSS scales it down. Geometry
    // is therefore identical in preview and export.
    canvas.width = stage.width;
    canvas.height = stage.height;
    ctxRef.current = canvas.getContext('2d');
    paint();

    let raf = 0;
    const loop = () => {
      const { clock: currentClock } = latest.current;
      // Layers/draft only repaint when something actually changed, so an idle
      // stage costs nothing and a playing animation stays smooth.
      // `imageRegistry.version` changes when an asset is added/released, which
      // must repaint even though the layer data itself is unchanged.
      const signature = `${JSON.stringify(buildLayers())}|img:${imageRegistry.version}`;
      if (signature !== lastSignatureRef.current || currentClock.timeMs !== lastTimeRef.current) {
        paint();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [stage.width, stage.height, paint, buildLayers]);

  return (
    <canvas
      ref={canvasRef}
      className="layer-overlay"
      width={stage.width}
      height={stage.height}
      role="img"
      aria-label="2D 图层合成预览"
      data-testid="layer-overlay"
    />
  );
}
