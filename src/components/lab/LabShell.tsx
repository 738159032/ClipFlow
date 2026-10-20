'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { imageRegistry } from '@/lib/assets/registry';
import { createPlaybackClock } from '@/lib/playback';
import type { ModelMetrics, StageRuntime } from '@/components/scene/runtime';
import { createStageRuntime } from '@/components/scene/runtime';
import type { RendererHandle } from '@/components/scene/RendererBridge';
import type { ModelStatus } from '@/components/stage/ProductStage';
import { StagePreview } from '@/components/stage/StagePreview';
import { useExportController } from '@/hooks/useExportController';
import { useEditorStore } from '@/store/editor';
import type { Layer, Rect } from '@/lib/types';
import { ExportPanel } from './ExportPanel';
import { InspectorPanel } from './InspectorPanel';

/**
 * Lab shell: owns runtime objects (runtime slot, playback clock, renderer
 * handle) and wires the panels to the store. Everything visual lives in the
 * three panels.
 */
export function LabShell() {
  const config = useEditorStore((s) => s.config);
  const selectedLayerId = useEditorStore((s) => s.selectedLayerId);
  const selectLayer = useEditorStore((s) => s.selectLayer);
  const clock = useMemo(() => createPlaybackClock(config.animation), []); // eslint-disable-line react-hooks/exhaustive-deps
  const runtimeRef = useRef<StageRuntime>(createStageRuntime());
  const [renderer, setRenderer] = useState<RendererHandle | null>(null);
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [metrics, setMetrics] = useState<ModelMetrics | null>(null);
  const [fps, setFps] = useState(30);
  const [bitrate, setBitrate] = useState(8_000_000);
  const [disposeStats, setDisposeStats] = useState<{ geometries: number; materials: number; textures: number } | null>(null);

  const exporter = useExportController(config);
  const { detect, start, exportStill } = exporter;

  const settings = useMemo(
    () => ({ width: config.stage.width, height: config.stage.height, fps, bitrate }),
    [config.stage.width, config.stage.height, fps, bitrate],
  );

  const handleModelStatus = useCallback((status: ModelStatus, payload?: { metrics?: ModelMetrics; error?: string }) => {
    setModelStatus(status);
    if (payload?.metrics) setMetrics(payload.metrics);
    useEditorStore.getState().setAssetStatus(status === 'idle' ? 'idle' : status, payload?.error ?? null);
  }, []);

  useEffect(() => {
    void detect(settings);
  }, [detect, settings]);

  // Leaving the editor (client-side navigation) must drop decoded images.
  useEffect(
    () => () => {
      imageRegistry.clear();
      useEditorStore.getState().clearImageAssets();
    },
    [],
  );

  const metricsLabel = metrics
    ? `${metrics.triangles.toLocaleString()} 三角面 · ${metrics.meshes} mesh · 尺寸 ${metrics.size.x.toFixed(2)}×${metrics.size.y.toFixed(2)}×${metrics.size.z.toFixed(2)}`
    : null;

  const injectBrokenAsset = () => {
    useEditorStore.getState().patchProduct({
      assetId: 'broken',
      modelName: 'missing-model.glb',
      sourceUrl: '/models/definitely-missing.glb',
    });
    handleModelStatus('loading');
  };

  const commitLayerRect = useCallback((id: string, rect: Rect) => {
    useEditorStore.getState().updateLayer<Layer>(id, { rect });
  }, []);

  const disposed = exportDisposalProbe(runtimeRef.current);
  return (
    <div className="lab">
      <header className="lab__head">
        <div>
          <Link href="/" className="lab__back" data-testid="lab-back">
            ← 项目概览
          </Link>
          <h1>ClipFlow · 阶段 0 验证台</h1>
          <p className="small muted">
            3D 商品预览 / 2D 图层合成 / WebCodecs MP4 导出 —— 全部为真实运行结果
          </p>
        </div>
        <div className="lab__chips">
          <span className={`chip ${renderer ? 'chip--ready' : 'chip--loading'}`} data-testid="renderer-status">
            渲染器 {renderer ? '就绪' : '初始化中'}
          </span>
          <span className={`chip chip--${modelStatus}`} data-testid="scene-model-status">
            模型 {modelStatus}
          </span>
          <span className="chip">{config.stage.width}×{config.stage.height}</span>
        </div>
      </header>

      <div className="lab__grid">
        <InspectorPanel onInjectBrokenAsset={injectBrokenAsset} />

        <main className="lab__center">
          <StagePreview
            config={config}
            clock={clock}
            runtime={runtimeRef.current}
            modelStatus={modelStatus}
            modelMetricsLabel={metricsLabel}
            exporting={exporter.status === 'encoding' || exporter.status === 'preparing' || exporter.status === 'finalizing'}
            selectedLayerId={selectedLayerId}
            onSelectLayer={selectLayer}
            onCommitLayerRect={commitLayerRect}
            onModelStatus={handleModelStatus}
            onRendererReady={setRenderer}
            onModelDisposed={(stats) => {
              setDisposeStats(stats);
              setMetrics(null);
            }}
          />

          <section className="checklist" aria-label="阶段 0 验证项">
            <h2>验证项自检</h2>
            <ul>
              <li className={renderer ? 'is-ok' : ''}>① 客户端渲染：Canvas 挂载 + WebGL2 检测 + 错误边界</li>
              <li className={modelStatus === 'ready' ? 'is-ok' : ''}>② GLB 加载：自动居中 / 统一尺寸 / 相机控制 / dispose</li>
              <li className={config.layers.length > 0 ? 'is-ok' : ''}>③ 2D 图层：归一化坐标，切换画幅保持相对位置</li>
              <li className={exporter.status === 'done' ? 'is-ok' : ''}>④ 合成帧：3D 渲染结果 + 2D 图层写入同一 Canvas</li>
              <li className={exporter.status === 'done' ? 'is-ok' : ''}>⑤ MP4：固定分辨率/帧率/时长 + 真实封装 + 播放</li>
            </ul>
            <div className="checklist__foot">
              <p className="small muted mono">资源：{disposed}</p>
              {disposeStats ? (
                <p className="small ok-line" data-testid="dispose-stats">
                  已释放 {disposeStats.geometries} 几何体 / {disposeStats.materials} 材质 / {disposeStats.textures} 贴图
                </p>
              ) : null}
              <div className="row">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    useEditorStore.getState().patchProduct({ assetId: null, modelName: null, sourceUrl: '' });
                    handleModelStatus('idle');
                  }}
                  data-testid="unload-model"
                >
                  卸载模型（触发 dispose）
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    useEditorStore.getState().useFixtureModel();
                    handleModelStatus('loading');
                  }}
                >
                  重新加载内置模型
                </button>
              </div>
            </div>
          </section>
        </main>

        <ExportPanel
          config={config}
          support={exporter.support}
          status={exporter.status}
          progress={exporter.progress}
          logs={exporter.logs}
          outcome={exporter.outcome}
          error={exporter.error}
          fps={fps}
          bitrate={bitrate}
          rendererReady={Boolean(renderer)}
          onFps={setFps}
          onBitrate={setBitrate}
          onDetect={() => void detect(settings)}
          onStart={() => void start(renderer, settings)}
          onCancel={exporter.cancel}
          onDownload={exporter.download}
          onExportStill={() => void exportStill(renderer, clock.timeMs)}
        />
      </div>
    </div>
  );
}

/** Reads the live runtime slot so the panel reflects real object state. */
function exportDisposalProbe(runtime: StageRuntime): string {
  if (!runtime.pivot) return 'pivot 未挂载';
  const metrics = runtime.metrics;
  if (!metrics) return 'pivot 已挂载 · 模型未加载';
  return `pivot 已挂载 · ${metrics.meshes} mesh / ${metrics.triangles} 三角面`;
}
