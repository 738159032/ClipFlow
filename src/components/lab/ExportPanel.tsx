'use client';

import type { SupportReport } from '@/lib/export/capabilities';
import type { ExportProgress } from '@/lib/export/mp4';
import type { ProjectConfig } from '@/lib/types';
import type { ExportOutcome, ExportStatus } from '@/hooks/useExportController';
import { Field, Section } from '@/components/ui/controls';
import { totalFrames } from '@/lib/timeline';

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
  onFps: (fps: number) => void;
  onBitrate: (bitrate: number) => void;
  onDetect: () => void;
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
  const { config, support, status, progress, logs, outcome, error } = props;
  const frames = totalFrames(props.fps, config.animation.durationMs);
  const busy = status === 'preparing' || status === 'encoding' || status === 'finalizing';
  const percent = progress && progress.total > 0 ? Math.round((progress.frame / progress.total) * 100) : 0;

  return (
    <div className="panel panel--right">
      <Section title="导出 MP4" desc="WebCodecs H.264 → ISO-BMFF（真实 MP4 封装）">
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
            disabled={busy || !props.rendererReady || !support?.selectedCodec}
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
        <button type="button" className="btn btn--ghost btn--block" onClick={props.onExportStill} disabled={busy || !props.rendererReady} data-testid="export-still">
          导出当前帧 PNG（验证合成）
        </button>

        {busy ? (
          <div className="progress" aria-live="polite">
            <div className="progress__bar" style={{ width: `${percent}%` }} />
            <span className="progress__label mono" data-testid="export-progress">
              {status} {progress ? `${progress.frame}/${progress.total}` : ''} · {(progress?.elapsedMs ?? 0) / 1000 > 0 ? `${((progress?.elapsedMs ?? 0) / 1000).toFixed(1)}s` : ''}
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
                <dd className="mono">[{(outcome.result.inspection.brands ?? []).join(', ') || 'n/a'}].{outcome.result.inspection.videoCodec ?? '?'}</dd>
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
