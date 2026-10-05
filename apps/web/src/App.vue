<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppNav from './components/AppNav.vue';
import SettingsModal from './components/dashboard/SettingsModal.vue';
import { useDashboardStore } from './stores/dashboard';

const store = useDashboardStore();
</script>

<template>
  <div class="shell">
    <header class="app-header">
      <div class="app-brand">
        <span class="app-logo" aria-hidden="true">₿</span>
        <span class="app-brand-name">Portfolio Dashboard</span>
      </div>

      <div class="app-header-actions">
        <AppNav />
        <button
          class="btn"
          title="Settings & Tools"
          aria-label="Settings & Tools"
          style="font-size: 20px; padding: 7px 13px; line-height: 1"
          @click="store.settingsOpen = true"
        >
          ⚙
        </button>
      </div>
    </header>

    <RouterView />

    <SettingsModal />
  </div>
</template>
