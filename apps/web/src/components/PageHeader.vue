<script setup lang="ts">
/**
 * A page's own title.
 *
 * Navigation and the settings gear are NOT here — they belong to the shell
 * (`App.vue`), which is the only place that renders the header row. A view
 * calling this is declaring what the page is called, not how to get somewhere
 * else.
 */
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <header class="page-titlebar">
    <h1 class="page-title">{{ title }}</h1>
    <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
  </header>
</template>
