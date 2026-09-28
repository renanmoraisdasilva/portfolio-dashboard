<script setup lang="ts">
import { NAV_ENTRIES } from '../config/nav';
import { useApi } from '../composables/useApi';

const api = useApi();
</script>

<template>
  <section class="card">
    <h2>Strangler shell</h2>
    <p>
      This is the Vue app. Pages move here one at a time; until then each one is
      served untouched from <code>/legacy/</code> by the same API, so nothing
      breaks while the migration runs.
    </p>
    <table class="data-table">
      <thead>
        <tr>
          <th>Page</th>
          <th>Status</th>
          <th>Route</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in NAV_ENTRIES" :key="entry.path">
          <td>{{ entry.label }}</td>
          <td>{{ entry.status === 'migrated' ? 'Vue' : 'legacy' }}</td>
          <td><code>{{ entry.path }}</code></td>
        </tr>
      </tbody>
    </table>
    <p>
      <a class="btn" :href="NAV_ENTRIES[0].legacyHref">Open the dashboard</a>
    </p>
  </section>
</template>
