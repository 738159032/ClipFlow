'use client';

import { useEffect, useRef } from 'react';
import type { TemplateDefinition } from '@/lib/presets';

/**
 * A template card thumbnail rendered from the template's *own* style fields —
 * background gradient, material colour/roughness and lighting preset. No
 * bitmap assets to go stale: change a template and its card follows.
 */

const WIDTH = 132;
const HEIGHT = 168;

function drawThumb(ctx: CanvasRenderingContext2D, template: TemplateDefinition) {
  const { background } = template.patch.lighting;
  const { material } = template.patch;
  const w = WIDTH;
  const h = HEIGHT;

  // Background: same angle convention as the stage (`0deg` = to top).
  if (background.type === 'gradient') {
    const rad = (background.angleDeg * Math.PI) / 180;
    const cx = w / 2;
    const cy = h / 2;
    const half = Math.hypot(w, h) / 2;
    const dx = Math.sin(rad) * half;
    const dy = -Math.cos(rad) * half;
    const gradient = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    gradient.addColorStop(0, background.from);
    gradient.addColorStop(1, background.to);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = background.color;
  }
  ctx.fillRect(0, 0, w, h);

  const dark = template.patch.lighting.presetId === 'noir';

  // Floor shadow.
  ctx.save();
  ctx.globalAlpha = dark ? 0.45 : 0.22;
  ctx.fillStyle = '#0a0f18';
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.8, w * 0.26, h * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Product body: a soft capsule standing in for the GLB.
  const bodyW = w * 0.34;
  const bodyH = h * 0.46;
  const x = (w - bodyW) / 2;
  const y = h * 0.3;
  const radius = bodyW * 0.42;

  const shade = ctx.createLinearGradient(x, y, x + bodyW, y + bodyH);
  shade.addColorStop(0, '#ffffff');
  shade.addColorStop(0.42, material.color);
  shade.addColorStop(1, dark ? '#3c4657' : '#8f98a8');
  ctx.fillStyle = shade;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + bodyW - radius, y);
  ctx.quadraticCurveTo(x + bodyW, y, x + bodyW, y + radius);
  ctx.lineTo(x + bodyW, y + bodyH - radius);
  ctx.quadraticCurveTo(x + bodyW, y + bodyH, x + bodyW - radius, y + bodyH);
  ctx.lineTo(x + radius, y + bodyH);
  ctx.quadraticCurveTo(x, y + bodyH, x, y + bodyH - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();

  // Specular streak: strong for gloss/metal, almost none for matte.
  const gloss = material.roughness < 0.4 ? 0.55 : material.roughness < 0.7 ? 0.3 : 0.14;
  ctx.save();
  ctx.globalAlpha = gloss;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(x + bodyW * 0.34, y + bodyH * 0.24, bodyW * 0.09, bodyH * 0.16, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Cap detail so the silhouette reads as a product rather than a pill.
  ctx.save();
  ctx.globalAlpha = dark ? 0.5 : 0.35;
  ctx.fillStyle = dark ? '#0b1018' : '#39404d';
  ctx.beginPath();
  ctx.ellipse(w / 2, y + bodyH * 0.08, bodyW * 0.2, bodyH * 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (dark) {
    const vignette = ctx.createRadialGradient(w / 2, h * 0.45, w * 0.15, w / 2, h * 0.45, w * 0.75);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
  }
}

export function TemplateThumb({ template }: { template: TemplateDefinition }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(WIDTH * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawThumb(ctx, template);
  }, [template]);

  return (
    <canvas
      ref={canvasRef}
      className="tpl-card__thumb"
      aria-hidden="true"
      data-testid={`template-thumb-${template.id}`}
    />
  );
}
