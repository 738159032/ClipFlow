'use client';

import { useEffect, useRef, useState } from 'react';
import { backgroundCss } from '@/lib/background';
import { formatTimecode } from '@/lib/timeline';
import type { PlaybackClock } from '@/lib/playback';
import type { ProjectConfig, Rect } from '@/lib/types';
import type { RendererHandle } from '@/components/scene/RendererBridge';
import type { StageRuntime } from '@/components/scene/runtime';
import { LayerInteraction } from './LayerInteraction';
import { LayerOverlay, type LayerOverlayHandle } from './LayerOverlay';
import { ProductStage, type ModelStatus } from './ProductStage';

export interface StagePreviewProps {
  config: ProjectConfig;
  clock: PlaybackClock;
  runtime: StageRuntime;
  modelStatus: ModelStatus;
  modelMetricsLabel: string | null;
  exporting: boolean;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onCommitLayerRect: (id: string, rect: Rect) => void;
  onModelStatus: (status: ModelStatus, payload?: { error?: string }) => void;
  onRendererReady: (handle: RendererHandle | null) => void;
  onModelDisposed?: (stats: { geometries: number; materials: number; textures: number }) => void;
}

/**
 * The stage: 3D canvas + 2D overlay + transport.
 * Both children render into the same aspect-ratio box, which is derived from
 * `config.stage` — that is what keeps preview and export framing identical.
 */
export function StagePreview({
  config,
  clock,
  runtime,
  modelStatus,
  modelMetricsLabel,
  exporting,
  selectedLayerId,
  onSelectLayer,
  onCommitLayerRect,
  onModelStatus,
  onRendererReady,
  onModelDisposed,
}: StagePreviewProps) {
  const [playing, setPlaying] = useState(false);
  const [timeLabel, setTimeLabel] = useState('00:00.00');
  const [progress, setProgress] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<LayerOverlayHandle | null>(null);

  useEffect(() => {
    clock.playing = playing;
    return () => {
      clock.playing = false;
    };
  }, [clock, playing]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setTimeLabel(formatTimecode(clock.timeMs));
      setProgress(clock.progress());
    }, 80);
    return () => window.clearInterval(id);
  }, [clock]);

  const { width, height } = config.stage;

  return (
    <section className="stage-panel" aria-label="实时合成预览">
      <div
        className="stage-frame"
        style={{
          aspectRatio: `${width} / ${height}`,
          background: backgroundCss(config.lighting.background),
          maxWidth: `calc(64vh * ${width / height})`,
        }}
        ref={canvasHostRef}
        data-testid="stage-frame"
      >
        <ProductStage
          config={config}
          clock={clock}
          runtime={runtime}
          resetKey={resetKey}
          onModelStatus={onModelStatus}
          onRendererReady={onRendererReady}
          onModelDisposed={onModelDisposed}
        />
        <LayerOverlay ref={overlayRef} layers={config.layers} stage={config.stage} clock={clock} />
        <LayerInteraction
          layers={config.layers}
          stage={config.stage}
          selectedId={selectedLayerId}
          disabled={exporting || modelStatus === 'loading'}
          stageRef={canvasHostRef}
          overlayRef={overlayRef}
          runtime={runtime}
          onSelect={onSelectLayer}
          onCommit={onCommitLayerRect}
        />

        {modelStatus === 'loading' ? (
          <div className="stage-mask">
            <span className="spinner" /> 正在加载 GLB 模型…
          </div>
        ) : null}
        {exporting ? (
          <div className="stage-mask stage-mask--export">
            <span className="spinner" /> 正在离线渲染并编码 MP4，请勿切换页面…
          </div>
        ) : null}
      </div>

      <div className="transport">
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            clock.toggle();
            setPlaying(clock.playing);
          }}
          data-testid="play-toggle"
          disabled={exporting}
        >
          {playing ? '暂停' : '播放'}
        </button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          onChange={(event) => {
            clock.seek((Number(event.target.value) / 1000) * clock.durationMs);
            setProgress(Number(event.target.value) / 1000);
            setTimeLabel(formatTimecode(clock.timeMs));
          }}
          aria-label="时间轴"
          data-testid="timeline-scrub"
          disabled={exporting}
        />
        <span className="mono transport__time" data-testid="timecode">
          {timeLabel} / {formatTimecode(config.animation.durationMs)}
        </span>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            setPlaying(false);
            clock.pause();
            clock.seek(0);
            setTimeLabel('00:00.00');
            setProgress(0);
          }}
        >
          回到起点
        </button>
        <button type="button" className="btn btn--ghost" onClick={() => setResetKey((k) => k + 1)}>
          重建场景
        </button>
      </div>

      <p className="stage-hint">
        {modelMetricsLabel ?? '模型加载中…'} · 点击图层可选中并拖动，拖四角缩放 · 空白处拖拽旋转商品 · 导出分辨率 {width}×{height}
      </p>
      {modelStatus === 'error' ? (
        <p className="inline-error">模型加载失败，已保留错误状态供排查（详见右侧日志）。</p>
      ) : null}
    </section>
  );
}
