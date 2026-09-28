import type { ArcElement, Plugin } from 'chart.js';

export interface PieLabelOptions {
  /** Slices below this share go to the side list instead of onto the arc. */
  threshold?: number;
  textColor?: string;
  nameFont?: string;
  pctFont?: string;
}

/**
 * Draws the allocation doughnut's labels.
 *
 * Ported verbatim from the legacy page, minus the `canvas.id` guard: there the
 * plugin was registered globally and had to ignore other charts, here it is
 * registered per chart (see `AllocationPanel.vue`) so it cannot run anywhere
 * else.
 *
 * Slices of at least `threshold` get a rounded label box on the arc; the rest
 * are collected and listed in the middle (at most 8, then "+N more").
 */
export const pieLabelPlugin: Plugin<'doughnut'> = {
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
    const pad = 10;

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
    const smallItems: { label: string; pct: number; color: string }[] = [];

    meta.data.forEach((element, i) => {
      const value = Number(dataset.data[i]) || 0;
      const pct = total > 0 ? (value / total) * 100 : 0;
      const label = String(chart.data.labels?.[i] ?? '');
      if (pct >= threshold) {
        const arc = element as ArcElement;
        const midAngle = (arc.startAngle + arc.endAngle) / 2;
        const r = (arc.outerRadius + (arc.innerRadius || 0)) / 2;
        const x = arc.x + Math.cos(midAngle) * r;
        const y = arc.y + Math.sin(midAngle) * r;

        ctx.font = nameFont;
        const nameW = ctx.measureText(label).width;
        ctx.font = pctFont;
        const pctText = `${pct.toFixed(1)}%`;
        const pctW = ctx.measureText(pctText).width;
        const rectW = Math.max(nameW, pctW) + pad * 2;
        const rectH = 22 + pad;

        ctx.fillStyle = 'rgba(10,14,26,0.64)';
        roundRect(x - rectW / 2, y - rectH / 2, rectW, rectH, 6);
        ctx.fill();

        ctx.fillStyle = textColor;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = nameFont;
        ctx.fillText(label, x, y - 6);
        ctx.font = pctFont;
        ctx.fillText(pctText, x, y + 8);
      } else {
        const colors = dataset.backgroundColor;
        smallItems.push({
          label,
          pct,
          color: Array.isArray(colors) ? String(colors[i] ?? '#888') : '#888',
        });
      }
    });

    if (smallItems.length > 0) {
      const area = chart.chartArea;
      const cx = area.left + (area.right - area.left) / 2;
      const cy = area.top + (area.bottom - area.top) / 2;
      const lineH = 16;
      const max = Math.min(smallItems.length, 8);
      const totalH = max * lineH;
      let y = cy - totalH / 2 + lineH / 2;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '11px system-ui, sans-serif';
      for (let k = 0; k < max; k++) {
        const it = smallItems[k];
        ctx.fillStyle = it.color;
        ctx.fillRect(cx - 40, y - 7, 12, 12);
        ctx.fillStyle = '#fff';
        ctx.fillText(`${it.label} ${it.pct.toFixed(1)}%`, cx - 22, y);
        y += lineH;
      }
      if (smallItems.length > 8) {
        ctx.fillStyle = '#fff';
        ctx.fillText(`+${smallItems.length - 8} more`, cx - 22, y);
      }
    }

    ctx.restore();
  },
};
