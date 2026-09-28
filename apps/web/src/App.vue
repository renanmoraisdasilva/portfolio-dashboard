<script setup lang="ts">
import { RouterView } from 'vue-router';
import AppNav from './components/AppNav.vue';
</script>

<template>
  <div class="shell">
    <AppNav />
    <!-- Each view renders its own PageHeader, so every page keeps the logo and
         wording the vanilla page had. -->
    <RouterView />
  </div>
</template>
