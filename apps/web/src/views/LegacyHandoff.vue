<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import { useDocumentTitle } from '../composables/useDocumentTitle';

const props = defineProps<{ label: string; legacyHref: string }>();

useDocumentTitle(props.label);
</script>

<template>
  <PageHeader icon="dYs" :title="label" subtitle="Served from the legacy static pages" />

  <section class="card">
    <h2>{{ label }} is not part of the Vue app</h2>
    <p>
      It is deliberately left as a vanilla page. The SQL Explorer is an arbitrary-SQL console over HTTP with no authentication, so
      it is kept behind <code>ENABLE_SQL_EXPLORER=true</code> (off by default, including in the Docker image) and is not worth
      migrating — the rest of the application is, and rewriting a page nobody runs would be cost without benefit.
    </p>
    <p>
      Until it is retired, it is served untouched from <code>/legacy/</code> by the same API. The link below will only resolve
      when the flag is enabled.
    </p>
    <p>
      <a class="btn" :href="legacyHref">Open the {{ label }} page</a>
    </p>
  </section>
</template>
