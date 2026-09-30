<script setup lang="ts">
import PageHeader from '../components/PageHeader.vue';
import { NAV_ENTRIES } from '../config/nav';
import { useDocumentTitle } from '../composables/useDocumentTitle';

const pending = NAV_ENTRIES.filter((entry) => entry.status !== 'migrated');

useDocumentTitle('Portfolio Dashboard');
</script>

<template>
  <PageHeader title="Portfolio Dashboard" subtitle="Holdings, cash, trades and alerts in one view" />

  <section class="card">
    <h2>Strangler shell</h2>
    <p>
      This is the Vue app. Pages move here one at a time; until then each one is served untouched from <code>/legacy/</code> by
      the same API, so nothing breaks while the migration runs.
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
          <td>
            <RouterLink v-if="entry.status === 'migrated'" :to="entry.path">
              <code>{{ entry.path }}</code>
            </RouterLink>
            <code v-else>{{ entry.path }}</code>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="pending.length">
      {{ pending.length }} page{{ pending.length === 1 ? '' : 's' }} still pending:
      {{ pending.map((entry) => entry.label).join(', ') }}.
    </p>
  </section>
</template>
