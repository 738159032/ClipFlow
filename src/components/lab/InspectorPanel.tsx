'use client';

import { formatBytes } from '@/lib/assets/validate';
import { FIXTURE_MODEL, LIGHTING_PRESETS, MATERIAL_PRESETS } from '@/lib/presets';
import { STAGE_PRESETS, type StagePresetKey } from '@/lib/layout';
import type {
  AnimationPresetId,
  ImageLayer,
  Layer,
  LightingPresetId,
  MaterialPresetId,
  PriceTagLayer,
  TextLayer,
  WatermarkLayer,
} from '@/lib/types';
import { useEditorStore, selectSelectedLayer } from '@/store/editor';
import { ColorField, Field, Section, Segmented, Slider, Toggle } from '@/components/ui/controls';
import { ImageAssetPanel } from './ImageAssetPanel';
import { TemplateGallery } from './TemplateGallery';

const STAGE_KEYS = Object.keys(STAGE_PRESETS) as StagePresetKey[];

export function InspectorPanel({ onInjectBrokenAsset }: { onInjectBrokenAsset: () => void }) {
  const config = useEditorStore((s) => s.config);
  const asset = useEditorStore((s) => s.asset);
  const assetStatus = useEditorStore((s) => s.assetStatus);
  const selected = useEditorStore(selectSelectedLayer);
  const images = useEditorStore((state) => state.images);
  const activeImageAssetId = useEditorStore((state) => state.activeImageAssetId);
  const mapMeta = config.material.mapAssetId ? images[config.material.mapAssetId] : null;
  const {
    setStage,
    patchCamera,
    patchMaterial,
    patchLighting,
    patchAnimation,
    applyMaterialPreset,
    selectLayer,
    updateLayer,
    addLayer,
    removeLayer,
    duplicateLayer,
    setModelFile,
    useFixtureModel,
  } = useEditorStore.getState();

  const activeStageKey = STAGE_KEYS.find((key) => {
    const preset = STAGE_PRESETS[key];
    return preset.width === config.stage.width && preset.height === config.stage.height;
  });

  return (
    <div className="panel panel--left">
      <TemplateGallery />

      <Section title="商品素材" desc="GLB 通过 Object URL 加载，替换时显式 revoke + dispose">
        <div className="file-row">
          <input
            type="file"
            accept=".glb,.gltf,model/gltf-binary"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) setModelFile(file);
              event.target.value = '';
            }}
            data-testid="model-file"
          />
        </div>
        <div className="row row--between">
          <span className="mono small" data-testid="model-name">
            {config.product.modelName ?? '未加载'} {asset ? `· ${(asset.bytes / 1024 / 1024).toFixed(2)}MB` : ''}
          </span>
          <span className={`chip chip--${assetStatus}`} data-testid="model-status">
            {assetStatus === 'ready' ? '已就绪' : assetStatus === 'loading' ? '加载中' : assetStatus === 'error' ? '失败' : '待加载'}
          </span>
        </div>
        <div className="row">
          <button type="button" className="btn btn--ghost" onClick={useFixtureModel}>
            使用内置模型
          </button>
          <button type="button" className="btn btn--ghost" onClick={onInjectBrokenAsset} data-testid="inject-broken">
            模拟加载失败
          </button>
        </div>
        {asset ? (
          <p className="small muted mono">
            {asset.url.slice(0, 28)}… ({FIXTURE_MODEL.name} 之外的本地文件)
          </p>
        ) : null}
        <Slider
          label="模型缩放"
          value={config.product.scale}
          min={0.4}
          max={2}
          step={0.01}
          onChange={(scale) => useEditorStore.getState().patchProduct({ scale })}
        />
        <Slider
          label="模型 Y 轴旋转"
          value={config.product.rotationDeg[1]}
          min={-180}
          max={180}
          step={1}
          suffix="°"
          onChange={(deg) =>
            useEditorStore.getState().patchProduct({
              rotationDeg: [config.product.rotationDeg[0], deg, config.product.rotationDeg[2]],
            })
          }
        />
      </Section>

      <ImageAssetPanel />

      <Section title="舞台尺寸" desc="图层使用 0–1 归一化坐标，切换尺寸不会错位">
        <Segmented
          label="画幅"
          value={activeStageKey ?? STAGE_KEYS[0]!}
          options={STAGE_KEYS.map((key) => ({ value: key, label: STAGE_PRESETS[key].label.split(' ')[0]!, title: STAGE_PRESETS[key].label }))}
          onChange={(key) => setStage({ width: STAGE_PRESETS[key].width, height: STAGE_PRESETS[key].height })}
        />
        <p className="small muted mono" data-testid="stage-size">
          {config.stage.width} × {config.stage.height}
        </p>
      </Section>

      <Section title="材质" desc="带贴图的材质保留原始贴图，只覆盖金属度/粗糙度">
        <Segmented
          value={config.material.presetId}
          options={(Object.keys(MATERIAL_PRESETS) as MaterialPresetId[]).map((id) => ({
            value: id,
            label: MATERIAL_PRESETS[id]?.label ?? id,
          }))}
          onChange={(id) => applyMaterialPreset(id)}
        />
        <ColorField label="基色（无贴图时生效）" value={config.material.color} onChange={(color) => patchMaterial({ color })} />
        <Slider label="金属度" value={config.material.metalness} min={0} max={1} step={0.01} onChange={(metalness) => patchMaterial({ metalness })} />
        <Slider label="粗糙度" value={config.material.roughness} min={0} max={1} step={0.01} onChange={(roughness) => patchMaterial({ roughness })} />

        <div className="material-map">
          <div className="row row--between">
            <span className="small muted">商品贴图</span>
            <span className="mono small" data-testid="material-map-status">
              {mapMeta ? mapMeta.name : '模型自带贴图'}
            </span>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="material-map-apply"
              disabled={!activeImageAssetId || config.material.mapAssetId === activeImageAssetId}
              onClick={() => patchMaterial({ mapAssetId: activeImageAssetId })}
            >
              用当前素材作贴图
            </button>
            {config.material.mapAssetId ? (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                data-testid="material-map-clear"
                onClick={() => patchMaterial({ mapAssetId: null })}
              >
                恢复模型贴图
              </button>
            ) : null}
          </div>
          <p className="small muted">沿用模型自带 UV，不做投影编辑</p>
        </div>
      </Section>

      <Section title="灯光" desc="三点布光 + 程序化 RoomEnvironment（离线，不依赖 HDR 下载）">
        <Segmented
          value={config.lighting.presetId}
          options={(Object.keys(LIGHTING_PRESETS) as LightingPresetId[]).map((id) => ({
            value: id,
            label: LIGHTING_PRESETS[id]!.label,
          }))}
          onChange={(id) => {
            const preset = LIGHTING_PRESETS[id]!;
            patchLighting({
              presetId: id,
              keyIntensity: preset.key,
              fillIntensity: preset.fill,
              ambientIntensity: preset.ambient,
              envIntensity: preset.env,
            });
          }}
        />
        <Slider label="主光强度" value={config.lighting.keyIntensity} min={0} max={6} step={0.05} onChange={(keyIntensity) => patchLighting({ keyIntensity })} />
        <Slider label="补光强度" value={config.lighting.fillIntensity} min={0} max={4} step={0.05} onChange={(fillIntensity) => patchLighting({ fillIntensity })} />
        <Slider label="环境光" value={config.lighting.ambientIntensity} min={0} max={2} step={0.05} onChange={(ambientIntensity) => patchLighting({ ambientIntensity })} />
        <Slider label="环境反射" value={config.lighting.envIntensity} min={0} max={2} step={0.05} onChange={(envIntensity) => patchLighting({ envIntensity })} />
      </Section>

      <Section title="动画与相机" desc="导出与预览共用 sampleAnimation()">
        <Segmented
          label="动画预设"
          value={config.animation.presetId}
          options={[
            { value: 'turntable' as AnimationPresetId, label: '转台' },
            { value: 'float' as AnimationPresetId, label: '悬浮' },
            { value: 'reveal' as AnimationPresetId, label: '入场' },
            { value: 'none' as AnimationPresetId, label: '静止' },
          ]}
          onChange={(presetId) => patchAnimation({ presetId })}
        />
        <Slider
          label="时长"
          value={config.animation.durationMs}
          min={1000}
          max={15000}
          step={500}
          suffix="ms"
          onChange={(durationMs) => patchAnimation({ durationMs })}
        />
        <Slider
          label="相机距离"
          value={config.camera.distance}
          min={2.4}
          max={8}
          step={0.05}
          onChange={(distance) => patchCamera({ distance })}
        />
        <Slider
          label="相机方位角"
          value={config.camera.azimuthDeg}
          min={-180}
          max={180}
          step={1}
          suffix="°"
          onChange={(azimuthDeg) => patchCamera({ azimuthDeg })}
        />
      </Section>

      <Section title="2D 图层" desc="预览与导出共用同一个 Canvas2D 光栅器">
        <div className="row">
          <button type="button" className="btn btn--ghost" onClick={() => addLayer('text')}>
            + 文字
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => addLayer('price')}>
            + 价格
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => addLayer('watermark')}>
            + 水印
          </button>
        </div>
        <ul className="layer-list">
          {[...config.layers]
            .sort((a, b) => b.zIndex - a.zIndex)
            .map((layer) => (
              <li key={layer.id} className={layer.id === selected?.id ? 'layer-row is-active' : 'layer-row'}>
                <button type="button" className="layer-row__main" onClick={() => selectLayer(layer.id)}>
                  <span className={`layer-dot layer-dot--${layer.type}`} />
                  <span className="layer-row__name">{layer.name}</span>
                  <span className="mono small muted">z{layer.zIndex}</span>
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  title={layer.visible ? '隐藏' : '显示'}
                  onClick={() => updateLayer<Layer>(layer.id, { visible: !layer.visible })}
                >
                  {layer.visible ? '◉' : '○'}
                </button>
                <button type="button" className="icon-btn" title="复制" onClick={() => duplicateLayer(layer.id)}>
                  ⧉
                </button>
                <button type="button" className="icon-btn" title="删除" onClick={() => removeLayer(layer.id)}>
                  ✕
                </button>
              </li>
            ))}
        </ul>
      </Section>

      {selected ? <LayerInspector layer={selected} /> : null}
    </div>
  );
}

function LayerInspector({ layer }: { layer: Layer }) {
  const update = (patch: Partial<Layer>) => useEditorStore.getState().updateLayer<Layer>(layer.id, patch);
  const updateRect = (patch: Partial<Layer['rect']>) => update({ rect: { ...layer.rect, ...patch } });

  return (
    <Section title="图层属性" desc={`${layer.type} · ${layer.id}`}>
      <Field label="名称">
        <input type="text" value={layer.name} onChange={(event) => update({ name: event.target.value })} />
      </Field>

      {layer.type === 'text' ? (
        <>
          <Field label="文字内容">
            <textarea
              rows={2}
              value={(layer as TextLayer).text}
              onChange={(event) => update({ text: event.target.value } as Partial<TextLayer>)}
              data-testid="layer-text"
            />
          </Field>
          <Slider
            label="字号（设计 px @1080 宽）"
            value={(layer as TextLayer).fontSize}
            min={16}
            max={160}
            step={1}
            onChange={(fontSize) => update({ fontSize } as Partial<TextLayer>)}
          />
          <ColorField label="颜色" value={(layer as TextLayer).color} onChange={(color) => update({ color } as Partial<TextLayer>)} />
          <Toggle
            label="投影"
            checked={(layer as TextLayer).shadow}
            onChange={(shadow) => update({ shadow } as Partial<TextLayer>)}
          />
        </>
      ) : null}

      {layer.type === 'price' ? (
        <>
          <Field label="金额">
            <input type="text" value={(layer as PriceTagLayer).amount} onChange={(event) => update({ amount: event.target.value } as Partial<PriceTagLayer>)} />
          </Field>
          <Field label="说明文案">
            <input type="text" value={(layer as PriceTagLayer).caption} onChange={(event) => update({ caption: event.target.value } as Partial<PriceTagLayer>)} />
          </Field>
          <ColorField label="底色" value={(layer as PriceTagLayer).fill} onChange={(fill) => update({ fill } as Partial<PriceTagLayer>)} />
          <ColorField label="文字色" value={(layer as PriceTagLayer).textColor} onChange={(textColor) => update({ textColor } as Partial<PriceTagLayer>)} />
        </>
      ) : null}

      {layer.type === 'watermark' ? (
        <>
          <Field label="水印文字">
            <input type="text" value={(layer as WatermarkLayer).text} onChange={(event) => update({ text: event.target.value } as Partial<WatermarkLayer>)} />
          </Field>
          <ColorField label="颜色" value={(layer as WatermarkLayer).color} onChange={(color) => update({ color } as Partial<WatermarkLayer>)} />
        </>
      ) : null}

      {layer.type === 'image' ? <ImageLayerFields layer={layer} onChange={update} /> : null}

      <Slider label="X（归一化）" value={layer.rect.x} min={0} max={1} step={0.005} onChange={(x) => updateRect({ x })} />
      <Slider label="Y（归一化）" value={layer.rect.y} min={0} max={1} step={0.005} onChange={(y) => updateRect({ y })} />
      <Slider label="宽" value={layer.rect.w} min={0.05} max={1} step={0.005} onChange={(w) => updateRect({ w })} />
      <Slider label="高" value={layer.rect.h} min={0.02} max={1} step={0.005} onChange={(h) => updateRect({ h })} />
      <Slider label="不透明度" value={layer.opacity} min={0} max={1} step={0.01} onChange={(opacity) => update({ opacity })} />
      <Slider label="旋转" value={layer.rotation} min={-45} max={45} step={1} suffix="°" onChange={(rotation) => update({ rotation })} />
      <Slider label="层级 zIndex" value={layer.zIndex} min={0} max={99} step={1} onChange={(zIndex) => update({ zIndex })} />
    </Section>
  );
}

function ImageLayerFields({
  layer,
  onChange,
}: {
  layer: ImageLayer;
  onChange: (patch: Partial<Layer>) => void;
}) {
  const meta = useEditorStore((state) => state.images[layer.assetId]);
  return (
    <>
      <div className="image-asset__inline" data-testid="image-layer-asset">
        <span className="mono small">{meta ? meta.name : '素材缺失'}</span>
        {meta ? (
          <span className="small muted mono">
            {meta.width}×{meta.height} · {formatBytes(meta.bytes)}
          </span>
        ) : null}
      </div>
      <Segmented
        label="填充方式"
        value={layer.fit}
        options={[
          { value: 'cover', label: '裁切填满' },
          { value: 'contain', label: '完整显示' },
        ]}
        onChange={(fit) => onChange({ fit } as Partial<ImageLayer>)}
      />
      <Slider
        label="圆角（设计 px）"
        value={layer.radius}
        min={0}
        max={80}
        step={1}
        onChange={(radius) => onChange({ radius } as Partial<ImageLayer>)}
      />
      <Field label="替代文本">
        <input
          type="text"
          value={layer.alt}
          onChange={(event) => onChange({ alt: event.target.value } as Partial<ImageLayer>)}
        />
      </Field>
    </>
  );
}
