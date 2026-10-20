import { describe, expect, it } from 'vitest';
import { applyTemplate, createDefaultProject, TEMPLATES } from '@/lib/presets';

describe('applyTemplate', () => {
  it('writes style fields from the template', () => {
    const config = createDefaultProject();
    const next = applyTemplate(config, 'noir-metal');
    expect(next.templateId).toBe('noir-metal');
    expect(next.material.presetId).toBe('metal');
    expect(next.lighting.presetId).toBe('noir');
    expect(next.animation.presetId).toBe('reveal');
  });

  it('never touches the product asset or the layers', () => {
    const config = createDefaultProject();
    const next = applyTemplate(config, 'sunset-drop');
    expect(next.product).toEqual(config.product);
    expect(next.layers).toEqual(config.layers);
    expect(next.stage).toEqual(config.stage);
  });

  it('does not mutate the previous config object', () => {
    const config = createDefaultProject();
    const snapshot = JSON.stringify(config);
    applyTemplate(config, 'clean-studio');
    expect(JSON.stringify(config)).toBe(snapshot);
  });

  it('ignores unknown template ids', () => {
    const config = createDefaultProject();
    expect(applyTemplate(config, 'nope')).toBe(config);
  });

  it('ships unique ids for every template', () => {
    const ids = TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('createDefaultProject', () => {
  it('produces a serialisable project with the expected defaults', () => {
    const config = createDefaultProject();
    expect(config.schemaVersion).toBe(1);
    expect(config.stage).toEqual({ width: 1080, height: 1920 });
    expect(config.layers.map((layer) => layer.type).sort()).toEqual(['price', 'text', 'text', 'watermark']);
    expect(() => JSON.stringify(config)).not.toThrow();
    // No DOM/THREE objects may leak into the data model.
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });

  it('returns fresh layer objects each call (no shared mutable state)', () => {
    const a = createDefaultProject();
    const b = createDefaultProject();
    expect(a.layers).not.toBe(b.layers);
    expect(a.layers[0]).not.toBe(b.layers[0]);
  });
});
