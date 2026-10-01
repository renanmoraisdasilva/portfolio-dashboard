import { createRouter, createWebHistory } from 'vue-router';

/**
 * Every route is lazy, `/` included: the dashboard pulls in lightweight-charts,
 * which would otherwise weigh 400 kB on the shell's first paint.
 *
 * `/` is the dashboard, and the Vue app now owns the whole thing. There is no
 * `LegacyHandoff` route: the SQL Explorer was the last page served from
 * `pages/`, and removing it left every header link pointing at a Vue route.
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
    { path: '/analytics', name: 'analytics', component: () => import('../views/AnalyticsView.vue') },
    { path: '/simulation', name: 'simulation', component: () => import('../views/SimulationView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
