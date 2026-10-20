'use client';

import { WORKFLOW_STEPS, stepIndex } from '@/lib/workflow/machine';
import { useWorkflowStore } from '@/store/workflow';

/**
 * Visible state machine: where the project is in
 * 素材 → 模板 → 编辑 → 预览 → 导出, plus the last transition message.
 *
 * The message is the single place the UI explains *why* an action is blocked —
 * no toasts, no silent failures.
 */
export function WorkflowBar() {
  const state = useWorkflowStore((store) => store.state);
  const message = useWorkflowStore((store) => store.message);
  const preview = useWorkflowStore((store) => store.preview);
  const current = stepIndex(state);

  return (
    <section className="workflow" data-testid="workflow-bar" data-state={state} aria-label="工作流状态">
      <ol className="workflow__steps">
        {WORKFLOW_STEPS.map((step, index) => {
          const status = index === current ? 'is-current' : index < current ? 'is-done' : '';
          return (
            <li
              key={step.state}
              className={`workflow__step ${status}`.trim()}
              aria-current={index === current ? 'step' : undefined}
              title={step.hint}
              data-testid={`workflow-step-${step.state}`}
              data-status={status.replace('is-', '') || 'todo'}
            >
              <span className="workflow__dot" aria-hidden="true" />
              {step.label}
            </li>
          );
        })}
      </ol>

      <p
        className="workflow__message"
        data-testid="workflow-message"
        data-tone={message?.tone ?? 'none'}
        role="status"
        aria-live="polite"
      >
        {message?.text ?? WORKFLOW_STEPS[current]?.hint}
      </p>

      {preview ? (
        <p className="workflow__preview mono small" data-testid="workflow-preview-summary">
          预览快照 {preview.width}×{preview.height} · {(preview.bytes / 1024).toFixed(0)}KB ·{' '}
          {(preview.timeMs / 1000).toFixed(2)}s · {preview.layerCount} 图层
        </p>
      ) : null}
    </section>
  );
}
