import { beforeEach, describe, expect, it } from 'vitest';
import { TEMPLATES, applyTemplate, createDefaultProject } from '@/lib/presets';
import type { ImageLayer } from '@/lib/types';
import { useEditorStore } from '@/store/editor';
import { useWorkflowStore } from '@/store/workflow';

/** Fresh project at `asset-ready` (the state the gallery is normally used in). */
function resetToAssetReady() {
  useEditorStore.getState().resetProject();
  useWorkflowStore.getState().send({ type: 'ASSET_READY' });
}

function state() {
  return useWorkflowStore.getState().state;
}

function config() {
  return useEditorStore.getState().config;
}

function imageLayer(assetId: string): ImageLayer {
  return {
    id: `image-${assetId}`,
    name: '商品图',
    type: 'image',
    visible: true,
    locked: false,
    rect: { x: 0.2, y: 0.3, w: 0.4, h: 0.3 },
    rotation: 0,
    opacity: 1,
    zIndex: 40,
    assetId,
    fit: 'cover',
    radius: 0,
    alt: '商品图',
  };
}

describe('template catalogue', () => {
  it('ships at least 5 templates with unique ids', () => {
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(5);
    const ids = TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every card a name, a background summary and a distinct style signature', () => {
    const signatures = new Set<string>();
    for (const template of TEMPLATES) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.backgroundSummary.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      const { material, lighting, animation } = template.patch;
      signatures.add(
        [
          material.presetId,
          material.color,
          lighting.presetId,
          JSON.stringify(lighting.background),
          animation.presetId,
          animation.durationMs,
        ].join('|'),
      );
    }
    // Every template must look different, otherwise the gallery is decorative.
    expect(signatures.size).toBe(TEMPLATES.length);
  });

  it('keeps every template patch self-contained', () => {
    for (const template of TEMPLATES) {
      expect(template.patch.camera.distance).toBeGreaterThan(0);
      expect(template.patch.animation.fps).toBe(30);
      expect(template.patch.lighting.background.type).toBe('gradient');
    }
  });
});

describe('applyTemplate · style patch only', () => {
  it('never touches the product, the layers or the stage', () => {
    const base = createDefaultProject();
    base.layers = [...base.layers, imageLayer('img-1')];
    const next = applyTemplate(base, 'noir-metal');

    expect(next.templateId).toBe('noir-metal');
    expect(next.product).toEqual(base.product);
    expect(next.stage).toEqual(base.stage);
    expect(next.layers).toBe(base.layers);
    expect(next.layers).toHaveLength(5);
    expect(next.layers.at(-1)?.type).toBe('image');
  });

  it('keeps the user base-colour texture', () => {
    const base = createDefaultProject();
    base.material = { ...base.material, mapAssetId: 'img-texture' };
    expect(applyTemplate(base, 'mint-ceramic').material.mapAssetId).toBe('img-texture');
  });

  it('does not mutate the input config', () => {
    const base = createDefaultProject();
    const snapshot = JSON.stringify(base);
    applyTemplate(base, 'cobalt-tech');
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('applies each template distinctly', () => {
    const base = createDefaultProject();
    const first = applyTemplate(base, 'clean-studio');
    const second = applyTemplate(base, 'rose-editorial');
    expect(first.lighting.background).not.toEqual(second.lighting.background);
    expect(first.material.presetId).not.toBe(second.material.presetId);
    expect(first.animation.presetId).not.toBe(second.animation.presetId);
  });
});

describe('editor store · template flow', () => {
  beforeEach(() => {
    resetToAssetReady();
  });

  it('applies a template, records the restore point and moves to template-selected', () => {
    const originalMaterial = { ...config().material };
    const originalLighting = { ...config().lighting };
    useEditorStore.getState().applyTemplateById('sunset-drop');

    expect(state()).toBe('template-selected');
    expect(config().templateId).toBe('sunset-drop');
    expect(config().lighting.presetId).toBe('sunset');

    const restore = useWorkflowStore.getState().restorePoint;
    expect(restore).not.toBeNull();
    expect(restore?.material).toEqual(originalMaterial);
    expect(restore?.lighting).toEqual(originalLighting);
  });

  it('keeps model, image assets and layers across template switches', () => {
    const store = useEditorStore.getState();
    store.addImageAsset({
      id: 'img-a',
      name: 'a.png',
      mime: 'image/png',
      bytes: 100,
      width: 10,
      height: 10,
      createdAt: 1,
    });
    useEditorStore.getState().addImageLayer({ id: 'img-a', name: 'a.png', mime: 'image/png', bytes: 100, width: 10, height: 10, createdAt: 1 });
    const layersBefore = config().layers;
    const productBefore = config().product;
    const imagesBefore = useEditorStore.getState().images;

    useEditorStore.getState().applyTemplateById('clean-studio');
    useEditorStore.getState().applyTemplateById('cobalt-tech');

    expect(config().layers).toBe(layersBefore);
    expect(config().product).toEqual(productBefore);
    expect(useEditorStore.getState().images).toBe(imagesBefore);
    expect(config().templateId).toBe('cobalt-tech');
    // Switching templates must not overwrite the original restore point.
    expect(useWorkflowStore.getState().restorePoint?.templateId).toBeNull();
  });

  it('detaches when a style field is edited and drops the restore point', () => {
    useEditorStore.getState().applyTemplateById('clean-studio');
    useEditorStore.getState().patchMaterial({ metalness: 0.5 });

    expect(config().templateId).toBeNull();
    expect(state()).toBe('editing');
    expect(useWorkflowStore.getState().restorePoint).toBeNull();
  });

  it('restores the pre-template style exactly', () => {
    const originalMaterial = { ...config().material };
    const originalBackground = { ...config().lighting.background };

    useEditorStore.getState().applyTemplateById('noir-metal');
    const noirBg = config().lighting.background;
    expect(noirBg.type === 'gradient' ? noirBg.from : null).toBe('#1a1f27');

    useEditorStore.getState().restoreStyle();
    expect(state()).toBe('editing');
    expect(config().templateId).toBeNull();
    expect(config().material).toEqual(originalMaterial);
    expect(config().lighting.background).toEqual(originalBackground);
    expect(useWorkflowStore.getState().restorePoint).toBeNull();
  });

  it('ignores template changes while an export is running', () => {
    useEditorStore.getState().applyTemplateById('clean-studio');
    useWorkflowStore.getState().send({ type: 'PREVIEW_GENERATED' });
    useWorkflowStore.getState().send({ type: 'EXPORT_STARTED' });
    expect(state()).toBe('exporting');

    useEditorStore.getState().applyTemplateById('rose-editorial');
    expect(config().templateId).toBe('clean-studio');
    expect(state()).toBe('exporting');

    // And style edits are refused for the same reason.
    const metalness = config().material.metalness;
    useEditorStore.getState().patchMaterial({ metalness: 0.9 });
    expect(config().material.metalness).toBe(metalness);
  });

  it('resets the workflow together with the project', () => {
    useEditorStore.getState().applyTemplateById('clean-studio');
    useWorkflowStore.getState().send({ type: 'PREVIEW_GENERATED' });

    useEditorStore.getState().resetProject();
    expect(state()).toBe('idle');
    expect(config().templateId).toBeNull();
    expect(useWorkflowStore.getState().preview).toBeNull();
    expect(useWorkflowStore.getState().restorePoint).toBeNull();
  });
});
