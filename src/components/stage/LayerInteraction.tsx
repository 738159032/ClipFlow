'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { StageRuntime } from '@/components/scene/runtime';
import {
  RESIZE_CORNERS,
  hitTestLayers,
  rectEquals,
  rectToPercentStyle,
  resizeRectBy,
  resizeRectFromCorner,
  toNormalizedPoint,
  translateRect,
  type ResizeCorner,
} from '@/lib/layers/transform';
import type { Layer, Rect, StageSize } from '@/lib/types';
import type { LayerOverlayHandle } from './LayerOverlay';

const KEY_MOVE_STEP = 0.005;
const KEY_MOVE_STEP_LARGE = 0.02;
const KEY_RESIZE_STEP = 0.01;
const CLICK_SLOP_PX = 4;

const TYPE_LABEL: Record<Layer['type'], string> = {
  text: '文字',
  price: '价格标签',
  watermark: '水印',
  image: '图片',
};

interface DragSession {
  pointerId: number;
  mode: 'move' | 'resize';
  corner: ResizeCorner | null;
  layerId: string;
  startClientX: number;
  startClientY: number;
  startRect: Rect;
  /** Stage CSS size at pointer-down; used to normalise pointer deltas. */
  cssWidth: number;
  cssHeight: number;
  rect: Rect;
  moved: boolean;
  frame: number | null;
  pendingX: number;
  pendingY: number;
}

export interface LayerInteractionProps {
  layers: readonly Layer[];
  stage: StageSize;
  selectedId: string | null;
  disabled?: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  overlayRef: RefObject<LayerOverlayHandle | null>;
  runtime: StageRuntime;
  onSelect: (id: string | null) => void;
  onCommit: (id: string, rect: Rect) => void;
}

/**
 * Interaction layer for the 2D canvas.
 *
 * Design notes (docs/DECISIONS.md D12):
 * - Hit testing runs in normalised stage space via `hitTestLayers()` against the
 *   live `getBoundingClientRect()`. CSS scaling, device pixel ratio, window
 *   resize and stage-preset changes cannot shift a layer: no pixel value is
 *   ever stored.
 * - Pointer moves never touch the store. A local `DragSession` drives the
 *   canvas "draft" rect and the chrome's inline style, so a whole drag costs
 *   one store write (on pointerup).
 * - Selection chrome and focus boxes are decorative DOM (`pointer-events:
 *   none`), so they can never appear in an exported frame.
 */
export function LayerInteraction({
  layers,
  stage,
  selectedId,
  disabled = false,
  stageRef,
  overlayRef,
  runtime,
  onSelect,
  onCommit,
}: LayerInteractionProps) {
  const chromeRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragSession | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const emptyDownRef = useRef<{ x: number; y: number } | null>(null);
  const latest = useRef({ layers, stage, selectedId, disabled, runtime, onSelect, onCommit });
  latest.current = { layers, stage, selectedId, disabled, runtime, onSelect, onCommit };

  const selectedLayer = layers.find((layer) => layer.id === selectedId) ?? null;

  const positionChrome = useCallback((rect: Rect) => {
    const chrome = chromeRef.current;
    if (!chrome) return;
    chrome.style.left = `${rect.x * 100}%`;
    chrome.style.top = `${rect.y * 100}%`;
    chrome.style.width = `${rect.w * 100}%`;
    chrome.style.height = `${rect.h * 100}%`;
  }, []);

  /** Move DOM focus onto a layer's focusable box (click-to-keyboard parity). */
  const focusLayer = useCallback((layerId: string) => {
    rootRef.current?.querySelector<HTMLElement>(`[data-layer-id="${layerId}"]`)?.focus({ preventScroll: true });
  }, []);

  const applyDragFrame = useCallback(() => {
    const session = dragRef.current;
    if (!session) return;
    session.frame = null;
    const dx = (session.pendingX - session.startClientX) / session.cssWidth;
    const dy = (session.pendingY - session.startClientY) / session.cssHeight;
    const rect =
      session.mode === 'move'
        ? translateRect(session.startRect, dx, dy)
        : resizeRectFromCorner(session.startRect, session.corner ?? 'se', dx, dy);
    session.rect = rect;
    // Canvas repaint + chrome style write: zero React renders per frame.
    overlayRef.current?.setDraft(session.layerId, rect);
    positionChrome(rect);
  }, [overlayRef, positionChrome]);

  const endSession = useCallback(
    (commit: boolean) => {
      const session = dragRef.current;
      if (!session) return;
      detachRef.current?.();
      detachRef.current = null;
      if (session.frame !== null) cancelAnimationFrame(session.frame);
      dragRef.current = null;
      if (rootRef.current) delete rootRef.current.dataset.dragging;
      latest.current.runtime.setOrbitEnabled?.(true);

      if (commit && session.moved && !rectEquals(session.rect, session.startRect)) {
        // The overlay keeps painting the draft until the committed layers
        // arrive, so there is no one-frame snap back to the old position.
        latest.current.onCommit(session.layerId, session.rect);
      } else {
        overlayRef.current?.clearDraft();
      }
    },
    [overlayRef],
  );

  const beginDrag = useCallback(
    (init: {
      mode: 'move' | 'resize';
      corner: ResizeCorner | null;
      layer: Layer;
      clientX: number;
      clientY: number;
      pointerId: number;
      box: DOMRect;
    }) => {
      dragRef.current = {
        pointerId: init.pointerId,
        mode: init.mode,
        corner: init.corner,
        layerId: init.layer.id,
        startClientX: init.clientX,
        startClientY: init.clientY,
        startRect: { ...init.layer.rect },
        cssWidth: init.box.width,
        cssHeight: init.box.height,
        rect: { ...init.layer.rect },
        moved: false,
        frame: null,
        pendingX: init.clientX,
        pendingY: init.clientY,
      };
      if (rootRef.current) rootRef.current.dataset.dragging = 'true';
      latest.current.onSelect(init.layer.id);
      focusLayer(init.layer.id);
      // Belt and braces: even if an orbit handler receives the event, it is off.
      latest.current.runtime.setOrbitEnabled?.(false);

      const onMove = (event: PointerEvent) => {
        const session = dragRef.current;
        if (!session || event.pointerId !== session.pointerId) return;
        if (!session.moved) {
          const travelled =
            Math.abs(event.clientX - session.startClientX) + Math.abs(event.clientY - session.startClientY);
          if (travelled > 1) session.moved = true;
        }
        session.pendingX = event.clientX;
        session.pendingY = event.clientY;
        // One paint per animation frame regardless of pointer event rate.
        if (session.frame === null) session.frame = requestAnimationFrame(applyDragFrame);
      };

      const finish = (event: PointerEvent) => {
        const session = dragRef.current;
        if (!session || event.pointerId !== session.pointerId) return;
        if (session.frame !== null) {
          cancelAnimationFrame(session.frame);
          session.frame = null;
          applyDragFrame();
        }
        endSession(true);
      };

      const detach = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', finish, true);
      };
      detachRef.current = detach;
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', finish, true);
      window.addEventListener('pointercancel', finish, true);
    },
    [applyDragFrame, endSession, focusLayer],
  );

  useEffect(() => {
    const stageEl = stageRef.current;
    if (!stageEl) return;

    const onDown = (event: PointerEvent) => {
      const props = latest.current;
      if (props.disabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      // Resize handles own their pointerdown; do not hijack them here.
      if (target?.closest('[data-layer-handle]')) return;

      const box = stageEl.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const point = toNormalizedPoint(event.clientX, event.clientY, box);
      const hit = hitTestLayers(props.layers, point, props.stage);
      if (!hit) {
        // Empty stage → OrbitControls keeps working; remember the point so a
        // click (as opposed to a drag) can clear the selection.
        emptyDownRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

      // Capture phase + stopPropagation: the 3D orbit must not start while a
      // layer is dragged, and text selection is suppressed the same way.
      event.preventDefault();
      event.stopPropagation();
      beginDrag({
        mode: 'move',
        corner: null,
        layer: hit,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerId: event.pointerId,
        box,
      });
    };

    const onClick = (event: MouseEvent) => {
      const start = emptyDownRef.current;
      emptyDownRef.current = null;
      if (!start) return;
      const travelled = Math.abs(event.clientX - start.x) + Math.abs(event.clientY - start.y);
      if (travelled <= CLICK_SLOP_PX) latest.current.onSelect(null);
    };

    const onHover = (event: PointerEvent) => {
      if (dragRef.current) return;
      if (latest.current.disabled) {
        if (stageEl.style.cursor) stageEl.style.cursor = '';
        return;
      }
      const box = stageEl.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) return;
      const point = toNormalizedPoint(event.clientX, event.clientY, box);
      const hit = hitTestLayers(latest.current.layers, point, latest.current.stage);
      const cursor = hit ? 'move' : '';
      if (stageEl.style.cursor !== cursor) stageEl.style.cursor = cursor;
    };

    stageEl.addEventListener('pointerdown', onDown, true);
    stageEl.addEventListener('pointerdown', onHover, false);
    stageEl.addEventListener('pointermove', onHover, false);
    stageEl.addEventListener('click', onClick, false);

    return () => {
      stageEl.removeEventListener('pointerdown', onDown, true);
      stageEl.removeEventListener('pointerdown', onHover, false);
      stageEl.removeEventListener('pointermove', onHover, false);
      stageEl.removeEventListener('click', onClick, false);
      stageEl.style.cursor = '';
      detachRef.current?.();
      detachRef.current = null;
      latest.current.runtime.setOrbitEnabled?.(true);
    };
  }, [beginDrag, stageRef]);

  // A React re-render during a drag (e.g. the transport clock ticking) would
  // reset the chrome to the store rect; re-apply the draft after every commit.
  useLayoutEffect(() => {
    const session = dragRef.current;
    if (session) positionChrome(session.rect);
  });

  const startResize = (event: ReactPointerEvent<HTMLDivElement>, corner: ResizeCorner) => {
    const props = latest.current;
    const stageEl = stageRef.current;
    if (props.disabled || !selectedLayer || !stageEl) return;
    const box = stageEl.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    beginDrag({
      mode: 'resize',
      corner,
      layer: selectedLayer,
      clientX: event.clientX,
      clientY: event.clientY,
      pointerId: event.pointerId,
      box,
    });
  };

  const onLayerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, layer: Layer) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onSelect(null);
      event.currentTarget.blur();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect(layer.id);
      return;
    }

    const resize = event.ctrlKey || event.metaKey;
    const step = event.shiftKey ? KEY_MOVE_STEP_LARGE : KEY_MOVE_STEP;
    let rect: Rect | null = null;

    switch (event.key) {
      case 'ArrowLeft':
        rect = resize ? resizeRectBy(layer.rect, -KEY_RESIZE_STEP, 0) : translateRect(layer.rect, -step, 0);
        break;
      case 'ArrowRight':
        rect = resize ? resizeRectBy(layer.rect, KEY_RESIZE_STEP, 0) : translateRect(layer.rect, step, 0);
        break;
      case 'ArrowUp':
        rect = resize ? resizeRectBy(layer.rect, 0, -KEY_RESIZE_STEP) : translateRect(layer.rect, 0, -step);
        break;
      case 'ArrowDown':
        rect = resize ? resizeRectBy(layer.rect, 0, KEY_RESIZE_STEP) : translateRect(layer.rect, 0, step);
        break;
      default:
        return;
    }

    event.preventDefault();
    if (rect && !rectEquals(rect, layer.rect)) onCommit(layer.id, rect);
  };

  return (
    <div className="layer-editor" ref={rootRef} data-testid="layer-editor">
      <p id="layer-keyboard-help" className="sr-only">
        方向键移动图层；Shift 加方向键快速移动；Ctrl 或 Command 加方向键调整大小；Esc 取消选择。
      </p>

      {[...layers]
        .sort((a, b) => b.zIndex - a.zIndex)
        .map((layer) => (
          <div
            key={layer.id}
            className={`layer-hit${layer.id === selectedId ? ' is-selected' : ''}${
              layer.visible ? '' : ' is-hidden'
            }`}
            style={{
              ...rectToPercentStyle(layer.rect),
              transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
              zIndex: layer.zIndex,
            }}
            role="button"
            tabIndex={layer.locked ? -1 : 0}
            aria-label={`${layer.name}（${TYPE_LABEL[layer.type]}图层）`}
            aria-pressed={layer.id === selectedId}
            aria-describedby="layer-keyboard-help"
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Shift+ArrowUp Shift+ArrowDown Shift+ArrowLeft Shift+ArrowRight Control+ArrowUp Control+ArrowDown Control+ArrowLeft Control+ArrowRight"
            data-layer-id={layer.id}
            data-layer-type={layer.type}
            data-layer-asset={layer.type === 'image' ? layer.assetId : undefined}
            data-testid={`layer-hit-${layer.id}`}
            onFocus={() => onSelect(layer.id)}
            onKeyDown={(event) => onLayerKeyDown(event, layer)}
          />
        ))}

      {selectedLayer ? (
        <div
          ref={chromeRef}
          className="layer-chrome"
          style={{
            ...rectToPercentStyle(selectedLayer.rect),
            transform: selectedLayer.rotation ? `rotate(${selectedLayer.rotation}deg)` : undefined,
          }}
          data-testid="layer-chrome"
          aria-hidden="true"
        >
          <span className="layer-chrome__label">{selectedLayer.name}</span>
          {RESIZE_CORNERS.map((corner) => (
            <div
              key={corner}
              className={`layer-handle layer-handle--${corner}`}
              data-layer-handle={corner}
              data-testid={`layer-handle-${corner}`}
              onPointerDown={(event) => startResize(event, corner)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
