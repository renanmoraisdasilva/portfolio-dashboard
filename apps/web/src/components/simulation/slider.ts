export function sliderBackground(min: number, max: number, value: number): string {
  const pct = Math.round(((value - min) / (max - min)) * 100);
  const fill = value >= 0 ? 'var(--accent-primary)' : 'var(--accent-danger)';
  return `linear-gradient(90deg, ${fill} ${pct}%, var(--bg-tertiary) ${pct}%)`;
}
