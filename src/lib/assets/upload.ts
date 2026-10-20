import type { ImageAssetMeta } from '../types';
import { imageRegistry, type ImageEntry } from './registry';
import {
  checkDecodedSize,
  validateImageFile,
  verifyImageSignature,
  type ImageRejectReason,
  type SupportedImageMime,
} from './validate';

/**
 * Browser-only upload pipeline: validate → read (with progress) → sniff →
 * decode → register.
 *
 * The returned entry is owned by `imageRegistry`; callers must only keep the
 * serialisable `meta` in the store. On any failure during decode, the Object URL
 * created for the attempt is revoked before throwing.
 */

export class ImageUploadError extends Error {
  readonly reason: ImageRejectReason;

  constructor(reason: ImageRejectReason, message: string) {
    super(message);
    this.name = 'ImageUploadError';
    this.reason = reason;
  }
}

export type UploadPhase = 'reading' | 'decoding' | 'finalizing';

export interface UploadProgress {
  phase: UploadPhase;
  /** 0..1 across the whole pipeline. */
  progress: number;
  loadedBytes: number;
  totalBytes: number;
}

export interface LoadedImage {
  meta: ImageAssetMeta;
  entry: ImageEntry;
}

export interface LoadImageOptions {
  maxBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}

function newId(): string {
  return `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Reads the file while reporting real byte progress (no fake timers). */
function readWithProgress(
  file: File,
  totalBytes: number,
  onProgress: ((progress: UploadProgress) => void) | undefined,
  signal: AbortSignal | undefined,
): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    // Fail fast: never allocate a reader (or touch the disk) after abort.
    if (signal?.aborted) {
      reject(new ImageUploadError('ABORTED', '已取消读取图片'));
      return;
    }

    const reader = new FileReader();
    let settled = false;

    const fail = (error: ImageUploadError) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const abort = () => {
      try {
        reader.abort();
      } catch {
        // ignore
      }
      fail(new ImageUploadError('ABORTED', '已取消读取图片'));
    };

    signal?.addEventListener('abort', abort, { once: true });

    reader.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.({
        phase: 'reading',
        progress: Math.min(0.85, (event.loaded / Math.max(1, totalBytes)) * 0.85),
        loadedBytes: event.loaded,
        totalBytes,
      });
    };
    reader.onerror = () => fail(new ImageUploadError('CORRUPT', '读取文件失败，请重试'));
    reader.onload = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      const result = reader.result;
      if (!(result instanceof ArrayBuffer)) {
        reject(new ImageUploadError('CORRUPT', '读取文件失败，请重试'));
        return;
      }
      resolve(result);
    };

    reader.readAsArrayBuffer(file);
  });
}

async function decodeBlob(
  blob: Blob,
  url: string,
): Promise<{ bitmap: ImageBitmap | null; element: HTMLImageElement | null; width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { bitmap, element: null, width: bitmap.width, height: bitmap.height };
    } catch {
      // fall through to the <img> decoder — some WEBP/JPEG variants behave
      // differently between the two code paths.
    }
  }

  const element = new Image();
  element.decoding = 'async';
  element.src = url;
  try {
    await element.decode();
  } catch {
    throw new ImageUploadError('DECODE', '图片解码失败，文件可能已损坏');
  }
  return { bitmap: null, element, width: element.naturalWidth, height: element.naturalHeight };
}

export async function loadImageFile(file: File, options: LoadImageOptions = {}): Promise<LoadedImage> {
  const check = validateImageFile(
    { name: file.name, type: file.type, size: file.size },
    { maxBytes: options.maxBytes },
  );
  if (!check.ok) throw new ImageUploadError(check.reason, check.message);

  options.onProgress?.({ phase: 'reading', progress: 0, loadedBytes: 0, totalBytes: file.size });
  const buffer = await readWithProgress(file, file.size, options.onProgress, options.signal);

  // Real bytes must match the declared type before we hand anything to a decoder.
  const head = new Uint8Array(buffer.slice(0, 16));
  const signature = verifyImageSignature(head, check.mime as SupportedImageMime);
  if (!signature.ok) throw new ImageUploadError('CORRUPT', signature.message);

  if (options.signal?.aborted) throw new ImageUploadError('ABORTED', '已取消读取图片');

  options.onProgress?.({ phase: 'decoding', progress: 0.9, loadedBytes: file.size, totalBytes: file.size });
  const blob = new Blob([buffer], { type: check.mime });
  const url = imageRegistry.createUrl(blob);

  let decoded: Awaited<ReturnType<typeof decodeBlob>>;
  try {
    decoded = await decodeBlob(blob, url);
  } catch (error) {
    imageRegistry.revokeUrl(url);
    throw error instanceof ImageUploadError
      ? error
      : new ImageUploadError('DECODE', '图片解码失败，文件可能已损坏');
  }

  const sizeError = checkDecodedSize(decoded.width, decoded.height);
  if (sizeError) {
    imageRegistry.revokeUrl(url);
    decoded.bitmap?.close();
    throw new ImageUploadError('DIMENSIONS', sizeError);
  }

  const meta: ImageAssetMeta = {
    id: newId(),
    name: file.name,
    mime: check.mime,
    bytes: file.size,
    width: decoded.width,
    height: decoded.height,
    createdAt: Date.now(),
  };
  const entry: ImageEntry = { meta, url, bitmap: decoded.bitmap, element: decoded.element };
  imageRegistry.put(entry);
  options.onProgress?.({ phase: 'finalizing', progress: 1, loadedBytes: file.size, totalBytes: file.size });

  return { meta, entry };
}
