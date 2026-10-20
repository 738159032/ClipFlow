'use client';

import { useEffect, useState } from 'react';
import { imageRegistry } from '@/lib/assets/registry';
import { ANIMATION_LABELS, LIGHTING_PRESETS, TEMPLATES } from '@/lib/presets';
import { canApplyTemplate, canRestoreTemplate } from '@/lib/workflow/machine';
import { useEditorStore } from '@/store/editor';
import { useWorkflowStore } from '@/store/workflow';
import { Section } from '@/components/ui/controls';
import { TemplateThumb } from './TemplateThumb';

/**
 * Template gallery + the three explicit entrances:
 *
 * - 应用模板        apply the *selected card* (style patch only; content kept)
 * - 恢复当前编辑     roll back to the style captured before the first template
 * - 重新开始        hard reset, behind an inline confirmation
 *
 * Button enablement is derived from the same state machine that executes the
 * action, so a disabled button always states its reason in Chinese.
 */
export function TemplateGallery() {
  const config = useEditorStore((state) => state.config);
  const applyTemplateById = useEditorStore((state) => state.applyTemplateById);
  const restoreStyle = useEditorStore((state) => state.restoreStyle);
  const workflowState = useWorkflowStore((state) => state.state);
  const restorePoint = useWorkflowStore((state) => state.restorePoint);
  const [candidate, setCandidate] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const appliedId = config.templateId;
  const selected = candidate ? TEMPLATES.find((item) => item.id === candidate) ?? null : null;

  const applyGate = canApplyTemplate(workflowState, Boolean(selected));
  const restoreGate = canRestoreTemplate(workflowState);
  const alreadyApplied = Boolean(selected && appliedId === selected.id);
  const applyDisabled = !applyGate.allowed || alreadyApplied;
  const applyReason = alreadyApplied ? '该模板已应用，切换其他卡片可再套用' : applyGate.reason;
  const restoreReason = !restorePoint
    ? '应用模板后未做修改时才可恢复'
    : workflowState === 'template-selected'
      ? ''
      : '当前状态不可恢复：已生成预览或正在编辑，请先切换模板';

  useEffect(() => {
    if (!confirmingReset) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmingReset(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirmingReset]);

  const doReset = () => {
    // resetProject() clears assetStatus, so remember whether the GLB was loaded.
    const modelWasReady = useEditorStore.getState().assetStatus === 'ready';
    useEditorStore.getState().resetProject();
    // Project reset must also drop decoded images (bitmaps + object URLs).
    imageRegistry.clear();
    // The fixture model is still loaded after a reset, so the flow is
    // legitimately back at "asset ready" rather than "idle".
    if (modelWasReady) {
      useWorkflowStore.getState().send({ type: 'ASSET_READY' });
    }
    setCandidate(null);
    setConfirmingReset(false);
  };

  return (
    <Section title="模板" desc="模板只写入风格字段（材质/灯光/动画/相机），模型、图片素材与图层保持不变">
      <div className="tpl-grid" data-testid="template-grid">
        {TEMPLATES.map((template) => {
          const isCandidate = candidate === template.id;
          const isApplied = appliedId === template.id;
          return (
            <button
              key={template.id}
              type="button"
              className={isCandidate ? 'tpl-card is-selected' : 'tpl-card'}
              onClick={() => setCandidate(template.id)}
              aria-pressed={isCandidate}
              aria-label={`${template.name} 模板`}
              data-testid={`template-card-${template.id}`}
              data-selected={isCandidate}
              data-applied={isApplied}
            >
              <TemplateThumb template={template} />
              <span className="tpl-card__name">{template.name}</span>
              <span className="tpl-card__summary">{template.backgroundSummary}</span>
              <span className="tpl-card__chips">
                <span>{LIGHTING_PRESETS[template.patch.lighting.presetId]?.label ?? '灯光'}</span>
                <span>{ANIMATION_LABELS[template.patch.animation.presetId]}</span>
              </span>
              {isApplied ? (
                <span className="tpl-card__badge" data-testid="template-applied-badge">
                  已应用
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="tpl-actions">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => selected && applyTemplateById(selected.id)}
          disabled={applyDisabled}
          data-testid="template-apply"
          title={applyDisabled ? applyReason : undefined}
        >
          {alreadyApplied ? `已应用「${selected?.name}」` : selected ? `应用「${selected.name}」` : '应用模板'}
        </button>
        {applyDisabled && applyReason ? (
          <p className="tpl-hint" data-testid="template-apply-reason">
            {applyReason}
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={restoreStyle}
          disabled={!restoreGate.allowed || !restorePoint}
          data-testid="template-restore"
          title={restoreReason || undefined}
        >
          恢复当前编辑
        </button>
        <p className="tpl-hint" data-testid="template-restore-reason">
          {restoreReason || '把风格恢复到应用模板前的状态'}
        </p>
      </div>

      {confirmingReset ? (
        <div
          className="confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="reset-title"
          aria-describedby="reset-desc"
          data-testid="reset-confirm"
        >
          <strong id="reset-title">重新开始会清空当前工程</strong>
          <p id="reset-desc">模型、图片素材与所有图层都会被重置，且无法撤销。</p>
          <div className="row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmingReset(false)} data-testid="reset-cancel">
              取消
            </button>
            <button type="button" className="btn btn--danger btn--sm" onClick={doReset} data-testid="reset-confirm-button">
              确认重新开始
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn--danger btn--block btn--sm"
          onClick={() => setConfirmingReset(true)}
          data-testid="reset-start"
        >
          重新开始…
        </button>
      )}
    </Section>
  );
}
