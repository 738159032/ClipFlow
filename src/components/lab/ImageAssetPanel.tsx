'use client';

import { useRef, useState } from 'react';
import { imageRegistry } from '@/lib/assets/registry';
import { IMAGE_ACCEPT, IMAGE_MAX_BYTES, SUPPORTED_FORMAT_LABEL, formatBytes } from '@/lib/assets/validate';
import { useImageAssets } from '@/hooks/useImageAssets';
import { selectSelectedLayer, useEditorStore } from '@/store/editor';
import { Section } from '@/components/ui/controls';

/**
 * Image asset intake.
 *
 * Scope is deliberately narrow: an uploaded image becomes a 2D **image layer**.
 * It never touches the product material (that would require a texture path with
 * its own ownership rules — see docs/DECISIONS.md D13).
 */
export function ImageAssetPanel() {
  const images = useEditorStore((state) => state.images);
  const activeId = useEditorStore((state) => state.activeImageAssetId);
  const layers = useEditorStore((state) => state.config.layers);
  const materialMapAssetId = useEditorStore((state) => state.config.material.mapAssetId);
  const selectedLayer = useEditorStore(selectSelectedLayer);
  const { view, upload, cancel, removeActive, addLayer, replaceSelectedLayer } = useImageAssets();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const activeMeta = activeId ? images[activeId] : null;
  const activeEntry = activeId ? imageRegistry.get(activeId) : null;
  const usedByLayers = activeId
    ? layers.filter((layer) => layer.type === 'image' && layer.assetId === activeId).length
    : 0;
  const usedAsTexture = Boolean(activeId) && materialMapAssetId === activeId;

  const pick = (file: File | undefined | null) => {
    if (!file) return;
    void upload(file);
  };

  const busy = view.status === 'reading' || view.status === 'decoding';

  return (
    <Section title="图片素材" desc={`${SUPPORTED_FORMAT_LABEL} · ≤ ${formatBytes(IMAGE_MAX_BYTES)} · 只存在于浏览器内存`}>
      <input
        ref={inputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        data-testid="image-file-input"
        onChange={(event) => {
          pick(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      <button
        type="button"
        className={dragOver ? 'dropzone is-over' : 'dropzone'}
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          pick(event.dataTransfer.files?.[0]);
        }}
        data-testid="image-dropzone"
        aria-label="选择或拖入图片文件"
      >
        <strong>点击选择图片</strong>
        <span>或把 PNG / JPEG / WEBP 拖到这里</span>
      </button>

      {view.fileName ? (
        <div className="upload-status" data-testid="image-upload-status" data-status={view.status}>
          <div className="row row--between">
            <span className="mono small upload-status__name" data-testid="image-file-name">
              {view.fileName}
            </span>
            <span className="small muted" data-testid="image-file-size">
              {formatBytes(view.bytes)}
            </span>
          </div>
          {busy ? (
            <>
              <div className="progress progress--inline" data-testid="image-progress">
                <div className="progress__bar" style={{ width: `${Math.round(view.progress * 100)}%` }} />
                <span className="progress__label mono">
                  {view.status === 'reading' ? `读取中 ${Math.round(view.progress * 100)}%` : '解码中…'}
                </span>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={cancel} data-testid="image-cancel">
                取消上传
              </button>
            </>
          ) : null}
          {view.status === 'ready' ? <p className="ok-line">图片已就绪</p> : null}
        </div>
      ) : null}

      {view.status === 'error' && view.error ? (
        <p className="inline-error" role="alert" data-testid="image-upload-error">
          {view.error}
        </p>
      ) : null}

      {activeMeta ? (
        <div className="image-asset" data-testid="image-asset">
          <div className="image-asset__thumb">
            {activeEntry?.url ? (
              // The Object URL is owned (and revoked) by imageRegistry.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={activeEntry.url} alt={activeMeta.name} />
            ) : (
              <span className="small muted">无预览</span>
            )}
          </div>
          <dl className="kv kv--tight">
            <div>
              <dt>尺寸</dt>
              <dd className="mono">
                {activeMeta.width} × {activeMeta.height}
              </dd>
            </div>
            <div>
              <dt>格式</dt>
              <dd className="mono">{activeMeta.mime.replace('image/', '').toUpperCase()}</dd>
            </div>
            <div>
              <dt>使用中</dt>
              <dd className="mono" data-testid="image-usage">
                {usedByLayers} 个图层{usedAsTexture ? ' · 商品贴图' : ''}
              </dd>
            </div>
          </dl>

          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => addLayer(activeMeta)}
            data-testid="image-add-layer"
          >
            作为图片图层使用
          </button>

          {selectedLayer && selectedLayer.type === 'image' && selectedLayer.assetId !== activeMeta.id ? (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => replaceSelectedLayer(selectedLayer.id, activeMeta.id)}
              data-testid="image-replace-layer"
            >
              替换当前图片图层
            </button>
          ) : null}

          <div className="row row--between">
            <span className="small muted">这里只加到 2D 图层；贴图请在「材质」区启用</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={removeActive} data-testid="image-remove">
              移除素材
            </button>
          </div>
        </div>
      ) : null}

      <p className="small muted">
        共 {Object.keys(images).length} 个素材 · {layers.length} 个图层
      </p>
    </Section>
  );
}
