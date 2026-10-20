'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RendererHandle } from '@/components/scene/RendererBridge';
import { detectSupport, toMessage, type SupportReport } from '@/lib/export/capabilities';
import {
  exportMp4,
  ExportCancelledError,
  type ExportProgress,
  type Mp4ExportResult,
  type SceneFrameSource,
} from '@/lib/export/mp4';
import { captureStillFrame } from '@/lib/export/still';
import type { ProjectConfig } from '@/lib/types';

export type ExportStatus = 'idle' | 'preparing' | 'encoding' | 'finalizing' | 'done' | 'error' | 'cancelled';

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export interface ExportOutcome {
  url: string;
  filename: string;
  result: Mp4ExportResult;
}

function makeSource(handle: RendererHandle): SceneFrameSource {
  return {
    begin: (width, height) => handle.begin(width, height),
    renderAt: (timeMs) => handle.renderAt(timeMs),
    end: () => handle.end(),
  };
}

function filenameFor(config: ProjectConfig, settings: ExportSettings): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}${pad(now.getSeconds())}`;
  return `clipflow-${stamp}-${settings.width}x${settings.height}-${settings.fps}fps.mp4`;
}

/**
 * Owns the export state machine, the AbortController and every object URL it
 * creates. URLs are revoked when replaced or when the hook unmounts, so a
 * cancelled or repeated export cannot leak blobs.
 */
export function useExportController(config: ProjectConfig) {
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [support, setSupport] = useState<SupportReport | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);

  const appendLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-120), line]);
  }, []);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const clearOutcome = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setOutcome(null);
  }, []);

  const detect = useCallback(async (settings: ExportSettings) => {
    const report = await detectSupport(settings);
    setSupport(report);
    return report;
  }, []);

  const start = useCallback(
    async (handle: RendererHandle | null, settings: ExportSettings, preferredCodec?: string) => {
      if (!handle) {
        setError('3D 渲染器尚未就绪');
        setStatus('error');
        return;
      }
      clearOutcome();
      setError(null);
      setLogs([]);
      setProgress({ phase: 'preparing', frame: 0, total: 0, elapsedMs: 0 });
      setStatus('preparing');
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await exportMp4(makeSource(handle), config, { ...settings, preferredCodec }, {
          signal: controller.signal,
          onProgress: (p) => {
            setProgress(p);
            setStatus(p.phase);
          },
          onLog: appendLog,
        });
        const url = URL.createObjectURL(result.blob);
        urlRef.current = url;
        setOutcome({ url, filename: filenameFor(config, settings), result });
        setStatus('done');
      } catch (err) {
        if (err instanceof ExportCancelledError) {
          appendLog('导出已取消，编码器与合成画布已释放');
          setStatus('cancelled');
        } else {
          const message = toMessage(err);
          appendLog(`导出失败: ${message}`);
          setError(message);
          setStatus('error');
        }
      } finally {
        abortRef.current = null;
        setProgress(null);
      }
    },
    [appendLog, clearOutcome, config],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const download = useCallback(() => {
    if (!outcome) return;
    const anchor = document.createElement('a');
    anchor.href = outcome.url;
    anchor.download = outcome.filename;
    anchor.click();
  }, [outcome]);

  /** PNG still of the composed frame — a fast sanity check of the pipeline. */
  const exportStill = useCallback(
    async (handle: RendererHandle | null, timeMs: number) => {
      if (!handle) {
        setError('3D 渲染器尚未就绪');
        return null;
      }
      try {
        const { blob, width, height } = await captureStillFrame(makeSource(handle), config, timeMs);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `clipflow-still-${width}x${height}.png`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        appendLog(`静帧已导出: ${width}x${height}, ${(blob.size / 1024).toFixed(0)}KB`);
        return blob;
      } catch (err) {
        const message = toMessage(err);
        appendLog(`静帧导出失败: ${message}`);
        setError(message);
        return null;
      }
    },
    [appendLog, config],
  );

  return { status, progress, logs, outcome, error, support, detect, start, cancel, download, exportStill, clearOutcome };
}
