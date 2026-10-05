<script setup lang="ts">
const ICONS: Record<string, string> = {
  BTC: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="12" r="12" fill="#F7931A" />
        <text x="12" y="16" font-size="12" text-anchor="middle" fill="#fff" font-family="system-ui, Arial">₿</text>
      </svg>`,
  ETH: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <polygon points="12,2 22,12 12,17 2,12" fill="#627EEA" />
        <polygon points="12,2 12,9 22,12 12,17" fill="#FFFFFF" opacity="0.12" />
      </svg>`,
  SOL: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="3" y="7" width="18" height="4" rx="1.5" transform="rotate(-20 12 9)" fill="#00FFA3"/>
        <rect x="3" y="11" width="18" height="4" rx="1.5" transform="rotate(-20 12 13)" fill="#7C3AED" opacity="0.9"/>
        <rect x="3" y="15" width="18" height="4" rx="1.5" transform="rotate(-20 12 17)" fill="#00D9FF" opacity="0.85"/>
      </svg>`,
  SPY: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="3" width="20" height="18" rx="2" fill="#0A0E1A" stroke="#2D3748" />
        <polyline points="4,14 8,10 12,13 16,8 20,12" fill="none" stroke="#10B981" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`,
  GLD: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <circle cx="12" cy="10" r="6" fill="#D4AF37" />
        <rect x="9" y="16" width="6" height="5" rx="1.5" fill="#B8860B" />
      </svg>`,
  IBIT: `<svg viewBox="0 0 48 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="44" height="20" rx="3" fill="#0A84FF" />
        <text x="24" y="16" font-size="10" text-anchor="middle" fill="#fff" font-family="system-ui, Arial">IBIT</text>
      </svg>`,
  BRL: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="4" fill="#F7DF1E" />
        <text x="12" y="16" font-size="11" text-anchor="middle" fill="#0a0e1a" font-family="system-ui, Arial">R$</text>
      </svg>`,
};

const props = defineProps<{ symbol: string }>();

function iconFor(symbol: string): string {
  if (ICONS[symbol]) return ICONS[symbol];
  const fs = symbol.length > 4 ? '7' : '9';
  return `<svg viewBox="0 0 48 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="2" y="2" width="44" height="20" rx="3" fill="#334155" /><text x="24" y="16" font-size="${fs}" text-anchor="middle" fill="#e2e8f0" font-family="system-ui, Arial">${symbol}</text></svg>`;
}
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <span class="asset-icon" v-html="iconFor(props.symbol)"></span>
</template>
