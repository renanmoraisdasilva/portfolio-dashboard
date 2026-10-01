import { createRouter, createWebHistory } from 'vue-router';

/**
 * Every route is lazy, `/` included: the dashboard pulls in lightweight-charts,
 * which would otherwise weigh 400 kB on the shell's first paint.
 *
 * `/` is the dashboard, and the Vue app owns every route the header links to.
 * The catch-all sends an unknown path to the dashboard rather than 404ing, so a
 * mistyped URL still lands somewhere usable.
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
