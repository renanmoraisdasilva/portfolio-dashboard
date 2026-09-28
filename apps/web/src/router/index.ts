import { createRouter, createWebHistory } from 'vue-router';
import { legacyEntries } from '../config/nav';
import HomeView from '../views/HomeView.vue';
import LegacyHandoff from '../views/LegacyHandoff.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    // Migrated pages get a real route here and stop rendering the hand-off.
    // The router is deliberately explicit so the generated list below only
    // covers what is left: analytics moved out of it in Phase 5.
    { path: '/analytics', name: 'analytics', component: () => import('../views/AnalyticsView.vue') },
    ...legacyEntries().map((entry) => ({
      path: entry.path,
      name: entry.path.slice(1),
      component: LegacyHandoff,
      props: { label: entry.label, legacyHref: entry.legacyHref },
    })),
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
