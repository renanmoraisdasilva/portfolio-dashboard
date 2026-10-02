import type { ArcElement, Plugin } from 'chart.js';

export interface PieLabelOptions {
  threshold?: number;
  textColor?: string;
  nameFont?: string;
  pctFont?: string;
}

/**
 * A doughnut label as text, or an empty string.
 *
 * Chart.js types `data.labels` as an array of arbitrary values, and `String()` on
 * anything that is not a primitive yields `[object Object]` — which is what this
 * would have drawn on the canvas had a label ever been structured. The two callers
 * (dashboard and simulator) share the rule rather than each re-deriving it, for
 * the same reason `formatMoney` is shared: a rendering detail duplicated across
 * two charts is one that drifts.
 */
export function labelText(label: unknown): string {
  if (typeof label === 'string') return label;
  if (typeof label === 'number' || typeof label === 'bigint' || typeof label === 'boolean') return String(label);
  // A date is a legitimate slice name and reads usefully; anything else is a
  // structure we do not know how to name, so it gets no chip rather than a lie.
  if (label instanceof Date) return label.toLocaleDateString();
  return '';
}

/**
 * Allocation doughnut labels for the dashboard.
 *
 * Same idea as the simulator's plugin but a different rendering: slices above
 * `threshold` get a rounded chip on the arc, the rest are listed in the middle.
 * (The simulator's variant caps that list at eight and adds "+N more"; this one
 * prints every slice, which is what the dashboard always did.)
 */
export const dashboardPieLabelPlugin: Plugin<'doughnut'> = {
  id: 'pieLabelPlugin',
  afterDraw(chart, _args, options) {
    const { ctx } = chart;
    const dataset = chart.data.datasets[0];
    if (!dataset) return;
    const meta = chart.getDatasetMeta(0);
    const total = dataset.data.reduce((a, b) => a + (Number(b) || 0), 0);

    const opts = (options ?? {}) as PieLabelOptions;
    const threshold = typeof opts.threshold === 'number' ? opts.threshold : 5;
    const textColor = opts.textColor || '#fff';
    const nameFont = opts.nameFont || 'bold 12px system-ui, sans-serif';
    const pctFont = opts.pctFont || '11px system-ui, sans-serif';
    const padX = 8;
    const padY = 6;

    function roundRect(x: number, y: number, w: number, h: number, r: number): void {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    ctx.save();
    const smallItems: Array<{ label: string; pct: number }> = [];

    meta.data.forEach((element, i) => {
      const pct = total > 0 ? ((Number(dataset.data[i]) || 0) / total) * 100 : 0;
      const arc = element as ArcElement;
      const mid = (arc.startAngle + arc.endAngle) / 2;
      const radius = (arc.outerRadius + arc.innerRadius) / 2;
      const x = arc.x + Math.cos(mid) * radius;
      const y = arc.y + Math.sin(mid) * radius;

      if (pct >= threshold) {
        ctx.save();
        ctx.fillStyle = 'rgba(10,14,26,0.72)';
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;

        ctx.font = nameFont;
        const name = labelText(chart.data.labels?.[i]);
        const nameW = ctx.measureText(name).width;
        ctx.font = pctFont;
        const pctText = `${pct.toFixed(1)}%`;
        const pctW = ctx.measureText(pctText).width;
        const w = Math.max(nameW, pctW) + padX * 2;
        const h = 20 + padY * 2;
        roundRect(x - w / 2, y - h / 2, w, h, 8);
        ctx.fill();
        ctx.fillStyle = textColor;
        ctx.font = nameFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(name, x, y - (padY / 2 + 2));
        ctx.font = pctFont;
        ctx.fillText(pctText, x, y + (padY / 2 + 6));
        ctx.restore();
      } else {
        smallItems.push({ label: labelText(chart.data.labels?.[i]), pct });
      }
    });

    if (smallItems.length > 0) {
      ctx.save();
      const centerX = chart.width / 2;
      const centerY = chart.height / 2;
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = smallItems.map((s) => `${s.label} ${s.pct.toFixed(1)}%`);
      const lineHeight = 16;
      const totalH = lines.length * lineHeight;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], centerX, centerY - totalH / 2 + i * lineHeight + lineHeight / 2);
      }
      ctx.restore();
    }

    ctx.restore();
  },
};
