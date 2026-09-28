import { createRouter, createWebHistory } from 'vue-router';
import { legacyEntries } from '../config/nav';
import LegacyHandoff from '../views/LegacyHandoff.vue';

/**
 * Every route is lazy, `/` included: the dashboard pulls in lightweight-charts,
 * which would otherwise weigh 400 kB on the shell's first paint.
 *
 * `/` is the dashboard — the last page of Phase 5, so the Vue app now owns the
 * whole thing. `legacyEntries()` only carries what is left: the SQL Explorer,
 * which Phase 3 gates behind ENABLE_SQL_EXPLORER and never migrated.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
    { path: '/analytics', name: 'analytics', component: () => import('../views/AnalyticsView.vue') },
    { path: '/simulation', name: 'simulation', component: () => import('../views/SimulationView.vue') },
    ...legacyEntries().map((entry) => ({
      path: entry.path,
      name: entry.path.slice(1),
      component: LegacyHandoff,
      props: { label: entry.label, legacyHref: entry.legacyHref },
    })),
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
