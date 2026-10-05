<script setup lang="ts">
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
