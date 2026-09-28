<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router';
import { NAV_ENTRIES, isActive } from '../config/nav';

const route = useRoute();
</script>

<template>
  <nav class="app-nav" aria-label="Primary">
    <RouterLink
      v-for="entry in NAV_ENTRIES"
      :key="entry.path"
      :to="entry.path"
      class="nav-link"
      :class="{ 'is-active': isActive(entry.path, route.path) }"
    >
      {{ entry.label }}
    </RouterLink>
  </nav>
</template>
