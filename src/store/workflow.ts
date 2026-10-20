'use client';

import { create } from 'zustand';
import {
  INITIAL_STATE,
  transition,
  type TransitionResult,
  type WorkflowEvent,
  type WorkflowState,
  type WorkflowTone,
} from '@/lib/workflow/machine';
import type { AnimationConfig, CameraConfig, LightingConfig, MaterialConfig } from '@/lib/types';

/**
 * Workflow store: the state machine *plus* the two pieces of observable state
 * the flow needs — the last generated composite preview and the style snapshot
 * used by "恢复当前编辑".
 *
 * Deliberately not persisted anywhere (no localStorage / no server): see
 * docs/DECISIONS.md D14.
 */

/** The style fields a template owns — exactly what `applyTemplate` patches. */
export interface StyleSnapshot {
  material: MaterialConfig;
  lighting: LightingConfig;
  camera: CameraConfig;
  animation: AnimationConfig;
  templateId: string | null;
}

export interface PreviewSnapshot {
  id: string;
  /** Object URL of the composited PNG; revoked when replaced or cleared. */
  url: string;
  width: number;
  height: number;
  bytes: number;
  createdAt: number;
  /** Timeline position that was captured. */
  timeMs: number;
  templateId: string | null;
  layerCount: number;
  /** How long the capture took, in ms (diagnostic). */
  captureMs: number;
}

export type PreviewInput = Omit<PreviewSnapshot, 'id' | 'createdAt'>;

interface WorkflowStore {
  state: WorkflowState;
  message: { text: string; tone: WorkflowTone } | null;
  preview: PreviewSnapshot | null;
  restorePoint: StyleSnapshot | null;

  send: (event: WorkflowEvent) => TransitionResult;
  setMessage: (text: string, tone?: WorkflowTone) => void;
  setPreview: (preview: PreviewInput) => PreviewSnapshot;
  clearPreview: () => void;
  setRestorePoint: (snapshot: StyleSnapshot | null) => void;
  /** Hard reset: state → idle, preview revoked, restore point dropped. */
  resetWorkflow: () => void;
}

let previewSeq = 0;

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  state: INITIAL_STATE,
  message: null,
  preview: null,
  restorePoint: null,

  send: (event) => {
    const result = transition(get().state, event);
    set({
      state: result.state,
      message: { text: result.message, tone: result.tone },
    });
    return result;
  },

  setMessage: (text, tone = 'warn') => set({ message: { text, tone } }),

  setPreview: (input) => {
    const previous = get().preview;
    if (previous) URL.revokeObjectURL(previous.url);
    previewSeq += 1;
    const snapshot: PreviewSnapshot = {
      ...input,
      id: `preview-${Date.now().toString(36)}-${previewSeq}`,
      createdAt: Date.now(),
    };
    set({ preview: snapshot });
    return snapshot;
  },

  clearPreview: () => {
    const previous = get().preview;
    if (previous) URL.revokeObjectURL(previous.url);
    set({ preview: null });
  },

  setRestorePoint: (snapshot) => set({ restorePoint: snapshot }),

  resetWorkflow: () => {
    const previous = get().preview;
    if (previous) URL.revokeObjectURL(previous.url);
    set({
      state: 'idle',
      message: { text: '已重新开始：模型、素材与图层已重置', tone: 'ok' },
      preview: null,
      restorePoint: null,
    });
  },
}));

/** Copies just the style fields (deep enough for the nested background config). */
export function pickStyleSnapshot(config: {
  material: MaterialConfig;
  lighting: LightingConfig;
  camera: CameraConfig;
  animation: AnimationConfig;
  templateId: string | null;
}): StyleSnapshot {
  return {
    material: { ...config.material },
    lighting: { ...config.lighting, background: { ...config.lighting.background } },
    camera: { ...config.camera },
    animation: { ...config.animation },
    templateId: config.templateId,
  };
}
