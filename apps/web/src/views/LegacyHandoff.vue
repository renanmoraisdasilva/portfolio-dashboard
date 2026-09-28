<script setup lang="ts">
defineProps<{ label: string; legacyHref: string }>();
</script>

<template>
  <section class="card">
    <h2>{{ label }} is not migrated yet</h2>
    <p>
      Phase 5 rewrites this page in Vue. Until then it is served untouched from
      <code>/legacy/</code> by the same API.
    </p>
    <p>
      <a class="btn" :href="legacyHref">Open the {{ label }} page</a>
    </p>
  </section>
</template>
