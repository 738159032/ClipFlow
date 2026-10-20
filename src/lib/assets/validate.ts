import type { Rect, StageSize } from '../types';

/**
 * Pure validation helpers for image uploads.
 *
 * Everything here is side-effect free and environment-agnostic (no DOM, no
 * decode), which makes it unit testable and keeps the "reject early" rules in
 * one place. Actual decoding happens in `upload.ts` and its result is checked
 * with `checkDecodedSize()`.
 */

export const IMAGE_MAX_BYTES = 50 * 1024 * 1024;
export const IMAGE_MAX_DIMENSION = 16384;

export type SupportedImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

const EXTENSION_TO_MIME: Record<string, SupportedImageMime> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** `accept` attribute for `<input type="file">`. */
export const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp';

export const SUPPORTED_FORMAT_LABEL = 'PNG / JPEG / WEBP';

export type ImageRejectReason =
  | 'EMPTY'
  | 'EXTENSION'
  | 'MIME'
  | 'TOO_LARGE'
  | 'CORRUPT'
  | 'DECODE'
  | 'DIMENSIONS'
  | 'ABORTED';

export type ImageFileCheck =
  | { ok: true; extension: string; mime: SupportedImageMime }
  | { ok: false; reason: ImageRejectReason; message: string };

export interface ImageFileInput {
  name: string;
  /** `File.type` as reported by the browser (may be empty). */
  type: string;
  size: number;
}

/** Lower-case extension without the dot, or '' when there is none. */
export function extensionOf(fileName: string): string {
  const match = /\.([A-Za-z0-9]+)\s*$/.exec(fileName.trim());
  return match?.[1] ? match[1].toLowerCase() : '';
}

/** Human readable byte size ("512 B", "2.4 KB", "3.1 MB"). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Browsers occasionally report the legacy `image/jpg`. */
function normalizeMime(mime: string): string {
  const lower = mime.trim().toLowerCase();
  return lower === 'image/jpg' ? 'image/jpeg' : lower;
}

/**
 * Extension + MIME + size checks. Runs before any bytes are read, so a 5GB
 * file is rejected without touching memory.
 */
export function validateImageFile(input: ImageFileInput, options: { maxBytes?: number } = {}): ImageFileCheck {
  const maxBytes = options.maxBytes ?? IMAGE_MAX_BYTES;
  const extension = extensionOf(input.name);

  if (input.size <= 0) {
    return { ok: false, reason: 'EMPTY', message: '文件为空，请选择有效的图片' };
  }
  if (!extension || !EXTENSION_TO_MIME[extension]) {
    return {
      ok: false,
      reason: 'EXTENSION',
      message: `不支持的扩展名「${extension ? `.${extension}` : '无'}」，仅支持 ${SUPPORTED_FORMAT_LABEL}`,
    };
  }

  const expected = EXTENSION_TO_MIME[extension] as SupportedImageMime;
  const declared = normalizeMime(input.type);
  if (!declared || !Object.values(EXTENSION_TO_MIME).includes(declared as SupportedImageMime)) {
    return {
      ok: false,
      reason: 'MIME',
      message: `文件类型「${input.type || '未知'}」不受支持，仅支持 ${SUPPORTED_FORMAT_LABEL}`,
    };
  }
  if (declared !== expected) {
    return {
      ok: false,
      reason: 'MIME',
      message: `扩展名与文件类型不一致（.${extension} 对应 ${expected}，实际为 ${declared}）`,
    };
  }
  if (input.size > maxBytes) {
    return {
      ok: false,
      reason: 'TOO_LARGE',
      message: `图片 ${formatBytes(input.size)} 超过 ${formatBytes(maxBytes)} 上限`,
    };
  }

  return { ok: true, extension, mime: expected };
}

/**
 * Magic-byte sniffing. A `.png` that actually contains a ZIP or random bytes is
 * rejected here, before the decoder produces a confusing error.
 */
export function sniffImageType(head: Uint8Array): SupportedImageMime | null {
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    head.length >= 12 &&
    String.fromCharCode(head[0] ?? 0, head[1] ?? 0, head[2] ?? 0, head[3] ?? 0) === 'RIFF' &&
    String.fromCharCode(head[8] ?? 0, head[9] ?? 0, head[10] ?? 0, head[11] ?? 0) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

export interface SniffCheck {
  ok: boolean;
  detected: SupportedImageMime | null;
  message: string;
}

/** Verifies the real bytes match the declared type. */
export function verifyImageSignature(head: Uint8Array, expected: SupportedImageMime): SniffCheck {
  const detected = sniffImageType(head);
  if (!detected) {
    return { ok: false, detected, message: '文件内容不是有效的 PNG / JPEG / WEBP 图片（可能已损坏）' };
  }
  if (detected !== expected) {
    return {
      ok: false,
      detected,
      message: `文件内容实际是 ${detected}，与扩展名声明的 ${expected} 不符`,
    };
  }
  return { ok: true, detected, message: '签名校验通过' };
}

/** Rejects 0×0 and absurdly large decodes (GPU texture limits). */
export function checkDecodedSize(width: number, height: number): string | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return '图片解码后的尺寸为 0，文件可能已损坏';
  }
  if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
    return `图片尺寸 ${Math.round(width)}×${Math.round(height)} 超过 ${IMAGE_MAX_DIMENSION}px 上限`;
  }
  return null;
}

/**
 * Centred rect for a freshly added image layer.
 *
 * `imageAspect` is width/height of the source image. The result keeps the
 * source aspect ratio on the *stage* (which may not be square), so a square
 * photo stays square in a 9:16 frame.
 */
export function fitRectToAspect(
  imageAspect: number,
  stage: StageSize,
  constraints: { maxWidth?: number; maxHeight?: number; centerX?: number; centerY?: number } = {},
): Rect {
  const maxWidth = constraints.maxWidth ?? 0.62;
  const maxHeight = constraints.maxHeight ?? 0.62;
  const stageAspect = stage.width / Math.max(1, stage.height);
  const aspect = Number.isFinite(imageAspect) && imageAspect > 0 ? imageAspect : 1;

  let w = maxWidth;
  // pixelAspect = (w * stageW) / (h * stageH) = aspect  =>  h = w * stageAspect / aspect
  let h = (w * stageAspect) / aspect;
  if (h > maxHeight) {
    h = maxHeight;
    w = (h * aspect) / stageAspect;
  }
  w = Math.min(1, Math.max(0.02, w));
  h = Math.min(1, Math.max(0.02, h));

  const centerX = constraints.centerX ?? 0.5;
  const centerY = constraints.centerY ?? 0.5;
  return {
    x: Math.min(Math.max(0, centerX - w / 2), 1 - w),
    y: Math.min(Math.max(0, centerY - h / 2), 1 - h),
    w,
    h,
  };
}

/** Source/destination rects for `cover` / `contain` cropping. */
export function computeImageDrawRect(
  source: { width: number; height: number },
  target: { w: number; h: number },
  fit: 'cover' | 'contain',
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const sourceAspect = source.width / Math.max(1, source.height);
  const targetAspect = target.w / Math.max(1, target.h);

  if (fit === 'cover') {
    if (sourceAspect > targetAspect) {
      const sw = source.height * targetAspect;
      return { sx: (source.width - sw) / 2, sy: 0, sw, sh: source.height, dx: 0, dy: 0, dw: target.w, dh: target.h };
    }
    const sh = source.width / targetAspect;
    return { sx: 0, sy: (source.height - sh) / 2, sw: source.width, sh, dx: 0, dy: 0, dw: target.w, dh: target.h };
  }

  // contain: letterbox inside the target
  if (sourceAspect > targetAspect) {
    const dh = target.w / sourceAspect;
    return { sx: 0, sy: 0, sw: source.width, sh: source.height, dx: 0, dy: (target.h - dh) / 2, dw: target.w, dh };
  }
  const dw = target.h * sourceAspect;
  return { sx: 0, sy: 0, sw: source.width, sh: source.height, dx: (target.w - dw) / 2, dy: 0, dw, dh: target.h };
}
