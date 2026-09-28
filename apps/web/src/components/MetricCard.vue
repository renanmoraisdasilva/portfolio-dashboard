<script setup lang="ts">
import type { TooltipContent } from '../composables/useAnalyticsTooltips';

defineProps<{
  icon: string;
  label: string;
  /** Extra card modifier from `analytics.css` (`danger`, `neutral-accent`). */
  variant?: string;
  value: string;
  valueClass?: string;
  valueStyle?: Record<string, string>;
  /** Renders the value as the `null-badge` chip instead of plain text. */
  valueIsBadge?: boolean;
  sub: string;
  subClass?: string;
  subStyle?: Record<string, string>;
  tooltip: TooltipContent;
}>();
</script>

<template>
  <div class="metric-card" :class="variant">
    <div class="metric-icon">{{ icon }}</div>
    <div class="metric-label">{{ label }} <span class="metric-info-hint">ⓘ</span></div>
    <span v-if="valueIsBadge" class="null-badge">{{ value }}</span>
    <div v-else class="metric-value" :class="valueClass" :style="valueStyle">{{ value }}</div>
    <div class="metric-sub" :class="subClass" :style="subStyle">{{ sub }}</div>
    <div class="metric-tooltip">
      <div class="tt-title">{{ tooltip.title }}</div>
      <div class="tt-body">{{ tooltip.body }}</div>
      <div
        v-if="tooltip.value"
        class="tt-value"
        :style="{ color: tooltip.value.color }"
      >
        {{ tooltip.value.text }}
      </div>
      <div v-for="(hint, i) in tooltip.hints" :key="`h${i}`" class="tt-hint">{{ hint }}</div>
      <div v-if="tooltip.scale" class="tt-scale">
        <span
          v-for="item in tooltip.scale"
          :key="item.label"
          class="tt-scale-item"
          :class="item.kind"
          >{{ item.label }}</span
        >
      </div>
      <div v-for="(line, i) in tooltip.footer" :key="`f${i}`" class="tt-hint">{{ line }}</div>
    </div>
  </div>
</template>
