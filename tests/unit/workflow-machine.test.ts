import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_STEPS,
  canApplyTemplate,
  canExport,
  canGeneratePreview,
  canRestoreTemplate,
  stepIndex,
  transition,
  type WorkflowEvent,
  type WorkflowState,
} from '@/lib/workflow/machine';

/** Applies a sequence of events, failing loudly on the first rejection. */
function walk(start: WorkflowState, events: WorkflowEvent[]): WorkflowState {
  return events.reduce((current, event) => {
    const result = transition(current, event);
    expect(result.accepted, `${current} + ${event.type} → ${result.message}`).toBe(true);
    return result.state;
  }, start);
}

describe('workflow machine · happy path', () => {
  it('walks idle → asset-ready → template-selected → editing → preview-ready → exporting → export-success', () => {
    let state: WorkflowState = 'idle';
    const steps: Array<[WorkflowEvent, WorkflowState]> = [
      [{ type: 'ASSET_READY' }, 'asset-ready'],
      [{ type: 'TEMPLATE_APPLIED', templateId: 'clean-studio' }, 'template-selected'],
      [{ type: 'STYLE_EDITED' }, 'editing'],
      [{ type: 'PREVIEW_GENERATED' }, 'preview-ready'],
      [{ type: 'EXPORT_STARTED' }, 'exporting'],
      [{ type: 'EXPORT_SUCCEEDED' }, 'export-success'],
    ];
    for (const [event, expected] of steps) {
      const result = transition(state, event);
      expect(result.accepted).toBe(true);
      state = result.state;
      expect(state).toBe(expected);
    }
  });

  it('supports apply → restore without leaving the flow', () => {
    const state = walk('idle', [
      { type: 'ASSET_READY' },
      { type: 'TEMPLATE_APPLIED', templateId: 'noir-metal' },
      { type: 'TEMPLATE_RESTORED' },
    ]);
    expect(state).toBe('editing');
  });

  it('lets a cancelled export return to preview-ready', () => {
    const result = transition('exporting', { type: 'EXPORT_CANCELLED' });
    expect(result.accepted).toBe(true);
    expect(result.state).toBe('preview-ready');
  });

  it('records the failure message when an export errors', () => {
    const result = transition('exporting', { type: 'EXPORT_FAILED', message: '编码器错误' });
    expect(result.state).toBe('export-error');
    expect(result.message).toContain('编码器错误');
  });
});

describe('workflow machine · illegal transitions', () => {
  const cases: Array<[WorkflowState, WorkflowEvent, string]> = [
    ['idle', { type: 'TEMPLATE_APPLIED', templateId: 'x' }, '请先加载商品模型'],
    ['idle', { type: 'PREVIEW_GENERATED' }, '请先加载商品模型'],
    ['idle', { type: 'EXPORT_STARTED' }, '请先生成预览'],
    ['asset-ready', { type: 'EXPORT_STARTED' }, '请先生成预览'],
    ['template-selected', { type: 'EXPORT_STARTED' }, '请先生成预览'],
    ['editing', { type: 'EXPORT_STARTED' }, '请先生成预览'],
    ['preview-ready', { type: 'EXPORT_SUCCEEDED' }, '当前没有进行中的导出'],
    ['preview-ready', { type: 'EXPORT_CANCELLED' }, '当前没有进行中的导出'],
    ['editing', { type: 'TEMPLATE_RESTORED' }, '没有可恢复的模板应用'],
    ['exporting', { type: 'TEMPLATE_APPLIED', templateId: 'x' }, '正在导出 MP4'],
    ['exporting', { type: 'PREVIEW_GENERATED' }, '正在导出 MP4'],
    ['exporting', { type: 'EXPORT_STARTED' }, '导出正在进行中'],
  ];

  it.each(cases)('rejects %s + %o with a Chinese reason', (state, event, expected) => {
    const result = transition(state, event);
    expect(result.accepted).toBe(false);
    expect(result.tone).toBe('warn');
    expect(result.message).toContain(expected);
    // A rejected event never moves the machine.
    expect(result.state).toBe(state);
  });

  it('still allows editing while exporting? No — style edits are blocked', () => {
    expect(transition('exporting', { type: 'STYLE_EDITED' }).accepted).toBe(false);
    expect(transition('exporting', { type: 'CONTENT_EDITED' }).accepted).toBe(false);
  });
});

describe('workflow machine · reset & idempotency', () => {
  it('resets from every state', () => {
    for (const step of WORKFLOW_STEPS) {
      const result = transition(step.state, { type: 'RESET' });
      expect(result.accepted).toBe(true);
      expect(result.state).toBe('idle');
    }
  });

  it('treats repeated ASSET_READY as a no-op that keeps the current state', () => {
    for (const step of WORKFLOW_STEPS) {
      const result = transition(step.state, { type: 'ASSET_READY' });
      expect(result.accepted).toBe(true);
      if (step.state !== 'idle') expect(result.state).toBe(step.state);
    }
  });

  it('allows editing before the asset is ready but does not advance the flow', () => {
    const result = transition('idle', { type: 'STYLE_EDITED' });
    expect(result.accepted).toBe(true);
    expect(result.state).toBe('idle');
    expect(result.message).toContain('素材尚未就绪');
  });
});

describe('workflow selectors', () => {
  it('maps states to stepper indexes', () => {
    expect(stepIndex('idle')).toBe(0);
    expect(stepIndex('preview-ready')).toBe(4);
    expect(stepIndex('export-error')).toBe(7);
  });

  it('explains why a template cannot be applied yet', () => {
    expect(canApplyTemplate('asset-ready', true).allowed).toBe(true);
    const missing = canApplyTemplate('asset-ready', false);
    expect(missing.allowed).toBe(false);
    expect(missing.reason).toContain('请先选择一个模板');
    const idle = canApplyTemplate('idle', true);
    expect(idle.allowed).toBe(false);
    expect(idle.reason).toContain('请先加载商品模型');
  });

  it('gates preview, export and restore', () => {
    expect(canGeneratePreview('idle').allowed).toBe(false);
    expect(canGeneratePreview('editing').allowed).toBe(true);
    expect(canExport('preview-ready').allowed).toBe(true);
    expect(canExport('editing').allowed).toBe(false);
    expect(canExport('editing').reason).toContain('请先生成预览');
    expect(canRestoreTemplate('template-selected').allowed).toBe(true);
    expect(canRestoreTemplate('editing').allowed).toBe(false);
  });
});
