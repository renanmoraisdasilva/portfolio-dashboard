<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router';
import { NAV_ENTRIES, isActive, entryTo } from '../config/nav';
import { useDashboardStore } from '../stores/dashboard';

const route = useRoute();
const store = useDashboardStore();

/** The dashboard's sub-view lives in the URL, so read it from there. */
const currentTab = (): string | undefined => {
  if (route.path !== '/') return undefined;
  const tab = route.query.tab;
  return typeof tab === 'string' ? tab : 'dashboard';
};
</script>

<template>
  <nav class="app-nav" aria-label="Primary">
    <RouterLink
      v-for="entry in NAV_ENTRIES"
      :key="entry.label"
      :to="entryTo(entry)"
      class="nav-link"
      :class="{ 'is-active': isActive(entry, route.path, currentTab()) }"
      @click="entry.tab && store.setTab(entry.tab)"
    >
      {{ entry.label }}
    </RouterLink>
  </nav>
</template>
