'use client';

import type { SupportReport } from '@/lib/export/capabilities';
import type { ExportProgress } from '@/lib/export/mp4';
import { TEMPLATES } from '@/lib/presets';
import { totalFrames } from '@/lib/timeline';
import { canExport, type WorkflowState } from '@/lib/workflow/machine';
import type { ProjectConfig } from '@/lib/types';
import type { ExportOutcome, ExportStatus } from '@/hooks/useExportController';
import type { PreviewSnapshot } from '@/store/workflow';
import { Field, Section } from '@/components/ui/controls';

export interface ExportPanelProps {
  config: ProjectConfig;
  support: SupportReport | null;
  status: ExportStatus;
  progress: ExportProgress | null;
  logs: string[];
  outcome: ExportOutcome | null;
  error: string | null;
  fps: number;
  bitrate: number;
  rendererReady: boolean;

  workflowState: WorkflowState;
  preview: PreviewSnapshot | null;
  previewBusy: boolean;
  previewError: string | null;

  onFps: (fps: number) => void;
  onBitrate: (bitrate: number) => void;
  onDetect: () => void;
  onGeneratePreview: () => void;
  onStart: () => void;
  onCancel: () => void;
  onDownload: () => void;
  onExportStill: () => void;
}

const BITRATE_OPTIONS = [
  { label: '4 Mbps', value: 4_000_000 },
  { label: '8 Mbps', value: 8_000_000 },
  { label: '12 Mbps', value: 12_000_000 },
];

export function ExportPanel(props: ExportPanelProps) {
  const { config, support, status, progress, logs, outcome, error, preview, previewError } = props;
  const frames = totalFrames(props.fps, config.animation.durationMs);
  const busy = status === 'preparing' || status === 'encoding' || status === 'finalizing';
  const percent = progress && progress.total > 0 ? Math.round((progress.frame / progress.total) * 100) : 0;

  const exportGate = canExport(props.workflowState);
  // Once the project leaves preview-ready (an edit, a restore, a template
  // switch) the stored snapshot no longer describes the current scene.
  const previewStale =
    Boolean(preview) &&
    !['preview-ready', 'exporting', 'export-success', 'export-error'].includes(props.workflowState);
  const exportBlocked = !exportGate.allowed;
  const templateName = config.templateId
    ? TEMPLATES.find((template) => template.id === config.templateId)?.name ?? config.templateId
    : '未套模板';

  return (
    <div className="panel panel--right">
      <Section title="① 生成合成预览" desc="把当前 3D 帧 + 2D 图层合成一张快照，作为导出的“所见即所得”依据">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={props.onGeneratePreview}
          disabled={!props.rendererReady || props.previewBusy || busy}
          data-testid="generate-preview"
        >
          {props.previewBusy ? '正在合成…' : preview ? '重新生成预览' : '生成预览'}
        </button>

        {previewError ? (
          <p className="inline-error" role="alert" data-testid="preview-error">
            预览生成失败：{previewError}
          </p>
        ) : null}

        {preview ? (
          <div
            className="preview-card"
            data-testid="preview-card"
            data-preview-id={preview.id}
            data-stale={previewStale}
          >
            <div className="preview-card__thumb">
              {/* Object URL owned by the workflow store, revoked on replace/reset. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview.url} alt="合成预览快照" />
            </div>
            <dl className="kv kv--tight">
              <div>
                <dt>尺寸</dt>
                <dd className="mono" data-testid="preview-size">
                  {preview.width} × {preview.height}
                </dd>
              </div>
              <div>
                <dt>时间点</dt>
                <dd className="mono">{(preview.timeMs / 1000).toFixed(2)}s</dd>
              </div>
              <div>
                <dt>图层 / 模板</dt>
                <dd className="mono">
                  {preview.layerCount} 图层 · {templateName}
                </dd>
              </div>
              <div>
                <dt>耗时 / 体积</dt>
                <dd className="mono">
                  {Math.round(preview.captureMs)}ms · {(preview.bytes / 1024).toFixed(0)}KB
                </dd>
              </div>
            </dl>
            {previewStale ? (
              <p className="tpl-hint" data-testid="preview-stale">
                预览已过期：风格或图层改动后需要重新生成
              </p>
            ) : null}
          </div>
        ) : (
          <p className="small muted" data-testid="preview-empty">
            尚未生成预览：导出按钮会保持禁用，避免导出与预览不一致。
          </p>
        )}
      </Section>

      <Section title="② 导出 MP4" desc="WebCodecs H.264 → ISO-BMFF（真实 MP4 封装）">
        <dl className="kv">
          <div>
            <dt>分辨率</dt>
            <dd className="mono" data-testid="export-resolution">
              {config.stage.width} × {config.stage.height}
            </dd>
          </div>
          <div>
            <dt>帧率</dt>
            <dd className="mono">{props.fps} fps</dd>
          </div>
          <div>
            <dt>时长 / 总帧数</dt>
            <dd className="mono">
              {(config.animation.durationMs / 1000).toFixed(2)}s / {frames}
            </dd>
          </div>
          <div>
            <dt>编码器</dt>
            <dd className="mono" data-testid="selected-codec">
              {support?.selectedCodec ?? '检测中…'}
            </dd>
          </div>
        </dl>

        <Field label="帧率">
          <select value={props.fps} onChange={(event) => props.onFps(Number(event.target.value))}>
            <option value={24}>24 fps</option>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </Field>

        <Field label="码率">
          <select value={props.bitrate} onChange={(event) => props.onBitrate(Number(event.target.value))}>
            {BITRATE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="row">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={props.onStart}
            disabled={busy || !props.rendererReady || !support?.selectedCodec || exportBlocked}
            data-testid="export-start"
          >
            {busy ? '导出中…' : '导出 MP4'}
          </button>
          {busy ? (
            <button type="button" className="btn btn--danger" onClick={props.onCancel} data-testid="export-cancel">
              取消
            </button>
          ) : null}
        </div>

        {exportBlocked && !busy ? (
          <p className="tpl-hint" data-testid="export-blocked-reason">
            {exportGate.reason}
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={props.onExportStill}
          disabled={busy || !props.rendererReady}
          data-testid="export-still"
        >
          导出当前帧 PNG（诊断用，不走工作流）
        </button>

        {busy ? (
          <div className="progress" aria-live="polite">
            <div className="progress__bar" style={{ width: `${percent}%` }} />
            <span className="progress__label mono" data-testid="export-progress">
              {status} {progress ? `${progress.frame}/${progress.total}` : ''} ·{' '}
              {(progress?.elapsedMs ?? 0) / 1000 > 0 ? `${((progress?.elapsedMs ?? 0) / 1000).toFixed(1)}s` : ''}
            </span>
          </div>
        ) : null}

        {error ? (
          <p className="inline-error" role="alert" data-testid="export-error">
            {error}
          </p>
        ) : null}

        {outcome ? (
          <div className="export-result" data-testid="export-result">
            <p className="ok-line">
              已生成 MP4 · {(outcome.result.bytes / 1024 / 1024).toFixed(2)}MB · {outcome.result.frames} 帧 ·{' '}
              {(outcome.result.elapsedMs / 1000).toFixed(1)}s
            </p>
            <video src={outcome.url} controls playsInline className="export-video" data-testid="export-video" />
            <dl className="kv kv--tight">
              <div>
                <dt>容器</dt>
                <dd className="mono">
                  [{(outcome.result.inspection.brands ?? []).join(', ') || 'n/a'}].{outcome.result.inspection.videoCodec ?? '?'}
                </dd>
              </div>
              <div>
                <dt>播放时长</dt>
                <dd className="mono">{outcome.result.inspection.durationSec?.toFixed(2) ?? '?'}s</dd>
              </div>
              <div>
                <dt>轨道尺寸</dt>
                <dd className="mono">
                  {outcome.result.inspection.width ?? '?'} × {outcome.result.inspection.height ?? '?'}
                </dd>
              </div>
              <div>
                <dt>boxes</dt>
                <dd className="mono small">{outcome.result.inspection.boxes.join(' ')}</dd>
              </div>
            </dl>
            <button type="button" className="btn btn--primary btn--block" onClick={props.onDownload} data-testid="export-download">
              下载 {outcome.filename}
            </button>
          </div>
        ) : null}
      </Section>

      <Section title="编码能力检测" desc="在目标浏览器里实测，不做版本假设">
        <div className="row row--between">
          <span className="small">
            WebCodecs {support?.webCodecs ? '✓' : '✕'} · VideoFrame {support?.videoFrame ? '✓' : '✕'} · MediaRecorder(mp4){' '}
            {support?.mediaRecorderMp4 ? '✓' : '✕'}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={props.onDetect} data-testid="detect-again">
            重新检测
          </button>
        </div>
        <ul className="codec-list">
          {(support?.candidates ?? []).map((candidate) => (
            <li key={candidate.codec} className={candidate.supported ? 'codec is-ok' : 'codec'}>
              <span className="mono">{candidate.codec}</span>
              <span className="small">{candidate.label}</span>
              <span className="small">{candidate.supported ? '支持' : candidate.reason ?? '不支持'}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="运行日志" desc="导出诊断信息（真实输出，不伪造）">
        <pre className="log" data-testid="export-log">
          {logs.length === 0 ? '（暂无日志）' : logs.join('\n')}
        </pre>
      </Section>
    </div>
  );
}
