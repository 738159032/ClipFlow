/**
 * Workflow state machine for the template → edit → preview → export flow.
 *
 * Pure and synchronous: the UI both *asks* this module whether an action is
 * allowed (for disabling buttons and showing the reason) and *executes* it
 * through the same function, so the button state can never disagree with the
 * behaviour. Rejected events return a Chinese reason instead of throwing.
 */

export type WorkflowState =
  | 'idle'
  | 'asset-ready'
  | 'template-selected'
  | 'editing'
  | 'preview-ready'
  | 'exporting'
  | 'export-success'
  | 'export-error';

export type WorkflowEvent =
  | { type: 'ASSET_READY' }
  | { type: 'TEMPLATE_APPLIED'; templateId: string }
  | { type: 'TEMPLATE_RESTORED' }
  | { type: 'STYLE_EDITED' }
  | { type: 'CONTENT_EDITED' }
  | { type: 'PREVIEW_GENERATED' }
  | { type: 'EXPORT_STARTED' }
  | { type: 'EXPORT_SUCCEEDED' }
  | { type: 'EXPORT_FAILED'; message?: string }
  | { type: 'EXPORT_CANCELLED' }
  | { type: 'RESET' };

export type WorkflowTone = 'ok' | 'warn';

export interface TransitionResult {
  state: WorkflowState;
  accepted: boolean;
  /** Human readable explanation; always Chinese, shown inline (never a toast). */
  message: string;
  tone: WorkflowTone;
}

export const INITIAL_STATE: WorkflowState = 'idle';

/** Ordered steps for the stepper; `export-success` / `export-error` are terminal-ish. */
export const WORKFLOW_STEPS: ReadonlyArray<{ state: WorkflowState; label: string; hint: string }> = [
  { state: 'idle', label: '待开始', hint: '还没有可用的模型或图片素材' },
  { state: 'asset-ready', label: '素材就绪', hint: '模型已加载，可以套用模板' },
  { state: 'template-selected', label: '已套模板', hint: '模板已应用，可撤销回到自己的风格' },
  { state: 'editing', label: '编辑中', hint: '正在调整风格或图层' },
  { state: 'preview-ready', label: '预览就绪', hint: '已有合成快照，可以导出' },
  { state: 'exporting', label: '导出中', hint: '正在编码 MP4' },
  { state: 'export-success', label: '导出成功', hint: 'MP4 已生成，可下载或再次导出' },
  { state: 'export-error', label: '导出失败', hint: '导出失败，可重试或继续编辑' },
];

export function stepIndex(state: WorkflowState): number {
  const index = WORKFLOW_STEPS.findIndex((step) => step.state === state);
  return index < 0 ? 0 : index;
}

export function stepLabel(state: WorkflowState): string {
  return WORKFLOW_STEPS[stepIndex(state)]?.label ?? state;
}

const REJECTED = (state: WorkflowState, message: string): TransitionResult => ({
  state,
  accepted: false,
  message,
  tone: 'warn',
});

const ACCEPTED = (state: WorkflowState, message: string): TransitionResult => ({
  state,
  accepted: true,
  message,
  tone: 'ok',
});

/** True while an export owns the encoder — the workflow must not be disturbed. */
function isExporting(state: WorkflowState): boolean {
  return state === 'exporting';
}

/**
 * Apply one event. Unknown events are a programming error, not a user action,
 * so they are ignored with a neutral message.
 */
export function transition(state: WorkflowState, event: WorkflowEvent): TransitionResult {
  switch (event.type) {
    case 'ASSET_READY': {
      if (state === 'idle') return ACCEPTED('asset-ready', '素材已就绪，可以套用模板');
      // Idempotent: uploading another image while editing must not reset the flow.
      return ACCEPTED(state, '素材已更新');
    }

    case 'TEMPLATE_APPLIED': {
      if (state === 'idle') {
        return REJECTED(state, '请先加载商品模型或上传图片素材，再应用模板');
      }
      if (isExporting(state)) {
        return REJECTED(state, '正在导出 MP4，请等待完成或取消后再切换模板');
      }
      return ACCEPTED('template-selected', '模板已应用（模型、图片素材与图层保持不变）');
    }

    case 'TEMPLATE_RESTORED': {
      if (state !== 'template-selected') {
        return REJECTED(state, '当前没有可恢复的模板应用，或已手动修改过风格');
      }
      return ACCEPTED('editing', '已恢复到应用模板前的风格');
    }

    case 'STYLE_EDITED': {
      // Editing before the asset is ready is allowed (the change still lands in
      // the config) but it does not pretend the flow has started.
      if (state === 'idle') return ACCEPTED('idle', '素材尚未就绪，改动会在模型加载后生效');
      if (isExporting(state)) return REJECTED(state, '正在导出 MP4，暂不能修改风格');
      return ACCEPTED('editing', '风格已修改，已脱离模板');
    }

    case 'CONTENT_EDITED': {
      if (state === 'idle') return ACCEPTED('idle', '素材尚未就绪，改动会在模型加载后生效');
      if (isExporting(state)) return REJECTED(state, '正在导出 MP4，暂不能修改内容');
      return ACCEPTED('editing', '内容已修改');
    }

    case 'PREVIEW_GENERATED': {
      if (state === 'idle') return REJECTED(state, '请先加载商品模型或上传图片素材，再生成预览');
      if (isExporting(state)) return REJECTED(state, '正在导出 MP4，请等待完成后再生成预览');
      return ACCEPTED('preview-ready', '合成预览已生成，可以导出 MP4');
    }

    case 'EXPORT_STARTED': {
      if (isExporting(state)) return REJECTED(state, '导出正在进行中');
      if (state === 'preview-ready' || state === 'export-success' || state === 'export-error') {
        return ACCEPTED('exporting', '正在离线渲染并编码 MP4');
      }
      return REJECTED(state, '请先生成预览，再导出 MP4');
    }

    case 'EXPORT_SUCCEEDED': {
      if (!isExporting(state)) return REJECTED(state, '当前没有进行中的导出');
      return ACCEPTED('export-success', 'MP4 导出成功');
    }

    case 'EXPORT_FAILED': {
      if (!isExporting(state)) return REJECTED(state, '当前没有进行中的导出');
      return ACCEPTED('export-error', event.message ? `导出失败：${event.message}` : '导出失败，请查看日志');
    }

    case 'EXPORT_CANCELLED': {
      if (!isExporting(state)) return REJECTED(state, '当前没有进行中的导出');
      return ACCEPTED('preview-ready', '已取消导出，可以继续编辑或重新导出');
    }

    case 'RESET': {
      return ACCEPTED('idle', '已重新开始');
    }

    default:
      return REJECTED(state, '未知操作');
  }
}

/* --------------------------------------------------------------- selectors */

/** Whether the template can be applied right now (drives the button state). */
export function canApplyTemplate(state: WorkflowState, hasCandidate: boolean): { allowed: boolean; reason: string } {
  if (!hasCandidate) return { allowed: false, reason: '请先选择一个模板卡片' };
  const result = transition(state, { type: 'TEMPLATE_APPLIED', templateId: '' });
  return { allowed: result.accepted, reason: result.accepted ? '' : result.message };
}

export function canRestoreTemplate(state: WorkflowState): { allowed: boolean; reason: string } {
  const result = transition(state, { type: 'TEMPLATE_RESTORED' });
  return { allowed: result.accepted, reason: result.accepted ? '' : result.message };
}

export function canGeneratePreview(state: WorkflowState): { allowed: boolean; reason: string } {
  const result = transition(state, { type: 'PREVIEW_GENERATED' });
  return { allowed: result.accepted, reason: result.accepted ? '' : result.message };
}

export function canExport(state: WorkflowState): { allowed: boolean; reason: string } {
  const result = transition(state, { type: 'EXPORT_STARTED' });
  return { allowed: result.accepted, reason: result.accepted ? '' : result.message };
}
