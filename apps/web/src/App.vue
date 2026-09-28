<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppNav from './components/AppNav.vue';
</script>

<template>
  <div class="shell">
    <AppNav />
    <header class="page-header">
      <div class="page-brand">
        <div class="logo">₿</div>
        <div>
          <h1 class="page-title">Portfolio Dashboard</h1>
          <p class="page-subtitle">Vue shell — one page at a time</p>
        </div>
      </div>
    </header>
    <RouterView />
  </div>
</template>
