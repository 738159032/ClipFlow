'use client';

import { useCallback, useRef, useState } from 'react';
import { imageRegistry } from '@/lib/assets/registry';
import { ImageUploadError, loadImageFile } from '@/lib/assets/upload';
import { useEditorStore } from '@/store/editor';
import type { ImageAssetMeta } from '@/lib/types';

export type ImageUploadStatus = 'idle' | 'reading' | 'decoding' | 'ready' | 'error';

export interface ImageUploadView {
  status: ImageUploadStatus;
  fileName: string | null;
  bytes: number;
  /** 0..1 */
  progress: number;
  error: string | null;
}

const INITIAL: ImageUploadView = {
  status: 'idle',
  fileName: null,
  bytes: 0,
  progress: 0,
  error: null,
};

/**
 * Orchestrates the image upload lifecycle around the pure pieces:
 * validate → read/decode (`loadImageFile`) → store metadata → release the
 * previous asset when nothing references it any more.
 *
 * The store only ever receives `ImageAssetMeta`; blobs, URLs and bitmaps stay
 * in `imageRegistry`.
 */
export function useImageAssets() {
  const [view, setView] = useState<ImageUploadView>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const uploadSeq = useRef(0);

  const upload = useCallback(async (file: File) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const seq = ++uploadSeq.current;

    setView({
      status: 'reading',
      fileName: file.name,
      bytes: file.size,
      progress: 0,
      error: null,
    });

    try {
      const { meta } = await loadImageFile(file, {
        signal: controller.signal,
        onProgress: (progress) => {
          if (seq !== uploadSeq.current) return;
          setView((current) => ({
            ...current,
            status: progress.phase === 'decoding' ? 'decoding' : progress.phase === 'finalizing' ? 'ready' : 'reading',
            progress: progress.progress,
            bytes: progress.totalBytes,
          }));
        },
      });
      if (seq !== uploadSeq.current) return;

      const store = useEditorStore.getState();
      const previous = store.activeImageAssetId;
      store.addImageAsset(meta);

      // The old asset can only be released when nothing references it: neither
      // an image layer nor the product material map.
      if (previous && previous !== meta.id) {
        const stillUsed =
          store.config.material.mapAssetId === previous ||
          store.config.layers.some((layer) => layer.type === 'image' && layer.assetId === previous);
        if (!stillUsed) {
          imageRegistry.release(previous);
          useEditorStore.getState().removeImageAsset(previous);
        }
      }

      setView({ status: 'ready', fileName: meta.name, bytes: meta.bytes, progress: 1, error: null });
    } catch (error) {
      if (seq !== uploadSeq.current) return;
      if (error instanceof ImageUploadError && error.reason === 'ABORTED') return;
      const message = error instanceof Error ? error.message : '图片上传失败，请重试';
      setView((current) => ({ ...current, status: 'error', progress: 0, error: message }));
    }
  }, []);

  /** Drops the current asset (and its runtime objects) if it is unused. */
  const removeActive = useCallback(() => {
    const store = useEditorStore.getState();
    const id = store.activeImageAssetId;
    if (!id) return;
    const usedByLayer = store.config.layers.some((layer) => layer.type === 'image' && layer.assetId === id);
    const usedByMaterial = store.config.material.mapAssetId === id;
    if (usedByLayer || usedByMaterial) {
      setView((current) => ({
        ...current,
        status: 'error',
        error: usedByMaterial
          ? '该素材正作为商品贴图使用，请先恢复模型贴图'
          : '该素材仍被图片图层使用，请先删除对应图层',
      }));
      return;
    }
    imageRegistry.release(id);
    store.removeImageAsset(id);
    setView(INITIAL);
  }, []);

  /** Aborts an in-flight upload (FileReader + decode). */
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    uploadSeq.current += 1;
    setView(INITIAL);
  }, []);

  const addLayer = useCallback((meta: ImageAssetMeta) => {
    useEditorStore.getState().addImageLayer(meta);
  }, []);

  const replaceSelectedLayer = useCallback((layerId: string, assetId: string) => {
    useEditorStore.getState().setLayerImageAsset(layerId, assetId);
  }, []);

  return { view, upload, cancel, removeActive, addLayer, replaceSelectedLayer };
}
