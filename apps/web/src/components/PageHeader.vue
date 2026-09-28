<script setup lang="ts">
defineProps<{
  icon: string;
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <header class="page-header">
    <div class="page-brand">
      <div class="logo">{{ icon }}</div>
      <div>
        <h1 class="page-title">{{ title }}</h1>
        <p class="page-subtitle">{{ subtitle }}</p>
      </div>
    </div>
  </header>
</template>
