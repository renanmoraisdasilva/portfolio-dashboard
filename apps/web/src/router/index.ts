import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('../views/DashboardView.vue') },
    { path: '/analytics', name: 'analytics', component: () => import('../views/AnalyticsView.vue') },
    { path: '/simulation', name: 'simulation', component: () => import('../views/SimulationView.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
