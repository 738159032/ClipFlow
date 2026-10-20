import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { imageRegistry } from '../assets/registry';
import { frameTimestampUs, frameTimeMs, totalFrames } from '../timeline';
import type { ProjectConfig } from '../types';
import { FrameCompositor } from './compositor';
import { detectSupport, makeEncoderConfig, toMessage, type EncoderSettings } from './capabilities';
import { inspectMp4, type Mp4Inspection } from './mp4-validate';

/**
 * A scene frame source is owned by the 3D layer (it borrows the live renderer).
 * The exporter only knows how to ask for a rendered frame at a given time.
 */
export interface SceneFrameSource {
  begin(width: number, height: number): Promise<void>;
  /** Renders the scene at `timeMs` and returns the canvas holding that frame. */
  renderAt(timeMs: number): HTMLCanvasElement;
  end(): void;
}

export interface Mp4ExportSettings extends EncoderSettings {
  /** Preferred codec string; falls back to the first supported candidate. */
  preferredCodec?: string;
}

export interface ExportProgress {
  phase: 'preparing' | 'encoding' | 'finalizing';
  frame: number;
  total: number;
  elapsedMs: number;
}

export interface Mp4ExportResult {
  blob: Blob;
  bytes: number;
  frames: number;
  elapsedMs: number;
  codec: string;
  stage: { width: number; height: number };
  fps: number;
  durationMs: number;
  inspection: Mp4Inspection;
  encodeMsPerFrame: number;
}

export class ExportCancelledError extends Error {
  constructor() {
    super('导出已取消');
    this.name = 'ExportCancelledError';
  }
}

export class ExportUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExportUnsupportedError';
  }
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Renders `durationMs` of animation at a fixed resolution / fps and muxes it
 * into a real MP4 (H.264 in ISO-BMFF). Throws instead of silently falling back
 * to a different container.
 */
export async function exportMp4(
  source: SceneFrameSource,
  config: ProjectConfig,
  settings: Mp4ExportSettings,
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: ExportProgress) => void;
    onLog?: (line: string) => void;
  } = {},
): Promise<Mp4ExportResult> {
  const { width, height, fps } = settings;
  const durationMs = config.animation.durationMs;
  const total = totalFrames(fps, durationMs);
  const log = options.onLog ?? (() => {});
  const startedAt = performance.now();

  if (settings.width % 2 !== 0 || settings.height % 2 !== 0) {
    throw new ExportUnsupportedError('H.264 要求宽高为偶数');
  }

  options.onProgress?.({ phase: 'preparing', frame: 0, total, elapsedMs: 0 });

  const support = await detectSupport(settings);
  log(`WebCodecs: ${support.webCodecs ? '可用' : '不可用'} · VideoFrame: ${support.videoFrame ? '可用' : '不可用'}`);
  for (const candidate of support.candidates) {
    log(`  ${candidate.codec} (${candidate.label}): ${candidate.supported ? '支持' : `不支持 - ${candidate.reason ?? ''}`}`);
  }

  const codec = settings.preferredCodec ?? support.selectedCodec;
  if (!codec) {
    throw new ExportUnsupportedError(
      '当前浏览器没有可用的 H.264 编码器（WebCodecs）。请使用桌面版 Chrome/Edge，或改用备选编码方案。',
    );
  }
  const preferred = support.candidates.find((c) => c.codec === codec);
  if (preferred && !preferred.supported) {
    throw new ExportUnsupportedError(`指定编码器 ${codec} 不被支持`);
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: fps },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encoderError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (error) {
        encoderError = error;
      }
    },
    error: (error) => {
      encoderError = error;
    },
  });

  encoder.configure(makeEncoderConfig(codec, settings));
  log(`编码器已配置: ${codec} ${width}x${height} @${fps}fps, ${Math.round(settings.bitrate / 1000)}kbps`);

  const compositor = new FrameCompositor({ width, height });
  const gop = Math.max(1, Math.round(fps * 2));
  let frameIndex = 0;

  try {
    await source.begin(width, height);
    log(`离线渲染尺寸已切换为 ${width}x${height}`);

    for (frameIndex = 0; frameIndex < total; frameIndex += 1) {
      if (options.signal?.aborted) throw new ExportCancelledError();
      if (encoderError) throw new Error(`编码器错误: ${toMessage(encoderError)}`);

      const timeMs = frameTimeMs(frameIndex, fps);
      const glCanvas = source.renderAt(timeMs);
      const composed = compositor.draw(
        glCanvas,
        config.lighting.background,
        config.layers,
        glCanvas.width,
        glCanvas.height,
        // Same lookup as the preview: image layers are baked into the video.
        imageRegistry.source,
      );

      const frame = new VideoFrame(composed, {
        timestamp: frameTimestampUs(frameIndex, fps),
        duration: Math.round(1_000_000 / fps),
      });
      encoder.encode(frame, { keyFrame: frameIndex % gop === 0 });
      frame.close();

      // Backpressure: never let the encoder queue grow unbounded.
      while (encoder.encodeQueueSize > 6) {
        await sleep(1);
        if (options.signal?.aborted) throw new ExportCancelledError();
      }
      if (frameIndex % 5 === 0) {
        options.onProgress?.({
          phase: 'encoding',
          frame: frameIndex + 1,
          total,
          elapsedMs: performance.now() - startedAt,
        });
        // Yield so the progress bar can paint.
        await sleep(0);
      }
    }

    options.onProgress?.({ phase: 'finalizing', frame: total, total, elapsedMs: performance.now() - startedAt });
    await encoder.flush();
    if (encoderError) throw new Error(`编码器错误: ${toMessage(encoderError)}`);
    muxer.finalize();

    const { buffer } = muxer.target as ArrayBufferTarget;
    const blob = new Blob([buffer], { type: 'video/mp4' });
    const inspection = inspectMp4(buffer);
    if (!inspection.valid) {
      throw new Error(`生成的 MP4 结构校验失败: ${inspection.errors.join('; ')}`);
    }

    const elapsedMs = performance.now() - startedAt;
    log(
      `完成: ${total} 帧, ${(blob.size / 1024 / 1024).toFixed(2)}MB, ${(elapsedMs / 1000).toFixed(1)}s, ` +
        `moov=${inspection.durationSec?.toFixed(2)}s, codec=${inspection.videoCodec ?? '?'}`,
    );

    return {
      blob,
      bytes: blob.size,
      frames: total,
      elapsedMs,
      codec,
      stage: { width, height },
      fps,
      durationMs,
      inspection,
      encodeMsPerFrame: elapsedMs / Math.max(1, total),
    };
  } finally {
    source.end();
    compositor.dispose();
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // already closed
    }
  }
}
