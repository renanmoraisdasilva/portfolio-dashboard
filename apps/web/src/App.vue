<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppNav from './components/AppNav.vue';
import SettingsModal from './components/dashboard/SettingsModal.vue';
import { useDashboardStore } from './stores/dashboard';

/**
 * The shell. It owns the header, and it is the only thing that does.
 *
 * The header used to be assembled twice: `AppNav` rendered the page links at the
 * top, and each view rendered its own `PageHeader` with its own buttons. The
 * dashboard then grew a second row of tab buttons under its title, so navigating
 * meant looking in two places for the same question.
 *
 * One row, here, for every page: the links, then the settings gear last on the
 * right. A page contributes content only. That is a layout concern, and layout
 * concerns belong to the layout.
 */
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
