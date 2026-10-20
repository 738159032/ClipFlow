/**
 * Encoder capability detection.
 *
 * We never assume H.264 is available: Chrome on Windows normally exposes it
 * through Media Foundation, but Chromium builds without proprietary codecs and
 * some VMs do not. The UI must show the detected matrix instead of failing with
 * a generic error.
 */

export interface EncoderCandidate {
  codec: string;
  label: string;
  supported: boolean;
  reason?: string;
}

export interface EncoderSettings {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export interface SupportReport {
  webCodecs: boolean;
  videoFrame: boolean;
  offscreenCanvas: boolean;
  candidates: EncoderCandidate[];
  /** First supported codec string, or null. */
  selectedCodec: string | null;
  /** MediaRecorder MP4 (second candidate path). */
  mediaRecorderMp4: boolean;
  checkedAt: number;
}

export const H264_CANDIDATES: ReadonlyArray<{ codec: string; label: string }> = [
  { codec: 'avc1.640028', label: 'H.264 High @ L4.0' },
  { codec: 'avc1.4d0028', label: 'H.264 Main @ L4.0' },
  { codec: 'avc1.42e01f', label: 'H.264 Baseline @ L3.1' },
];

export function makeEncoderConfig(codec: string, settings: EncoderSettings): VideoEncoderConfig {
  return {
    codec,
    width: settings.width,
    height: settings.height,
    framerate: settings.fps,
    bitrate: settings.bitrate,
    latencyMode: 'quality',
  };
}

export async function detectSupport(settings: EncoderSettings): Promise<SupportReport> {
  const hasEncoder = typeof globalThis !== 'undefined' && 'VideoEncoder' in globalThis;
  const hasFrame = typeof globalThis !== 'undefined' && 'VideoFrame' in globalThis;
  const hasOffscreen = typeof globalThis !== 'undefined' && 'OffscreenCanvas' in globalThis;

  const candidates: EncoderCandidate[] = [];
  let selectedCodec: string | null = null;

  for (const candidate of H264_CANDIDATES) {
    if (!hasEncoder) {
      candidates.push({ ...candidate, supported: false, reason: 'VideoEncoder 不可用' });
      continue;
    }
    try {
      const result = await VideoEncoder.isConfigSupported(makeEncoderConfig(candidate.codec, settings));
      const supported = Boolean(result.supported);
      candidates.push({
        ...candidate,
        supported,
        reason: supported ? undefined : 'isConfigSupported 返回 false',
      });
      if (supported && !selectedCodec) selectedCodec = candidate.codec;
    } catch (error) {
      candidates.push({ ...candidate, supported: false, reason: toMessage(error) });
    }
  }

  let mediaRecorderMp4 = false;
  try {
    mediaRecorderMp4 =
      typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42001f');
  } catch {
    mediaRecorderMp4 = false;
  }

  return {
    webCodecs: hasEncoder,
    videoFrame: hasFrame,
    offscreenCanvas: hasOffscreen,
    candidates,
    selectedCodec,
    mediaRecorderMp4,
    checkedAt: Date.now(),
  };
}

export function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
