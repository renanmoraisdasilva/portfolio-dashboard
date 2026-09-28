<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import { useDocumentTitle } from '../composables/useDocumentTitle';

const props = defineProps<{ label: string; legacyHref: string }>();

useDocumentTitle(props.label);
</script>

<template>
  <PageHeader icon="🚧" :title="label" subtitle="Not migrated to Vue yet" />

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
