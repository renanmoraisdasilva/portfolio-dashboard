import { createRouter, createWebHistory } from 'vue-router';
import { NAV_ENTRIES } from '../config/nav';
import HomeView from '../views/HomeView.vue';
import LegacyHandoff from '../views/LegacyHandoff.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    // Every page the strangler has not reached yet hands off to /legacy/.
    // As Phase 5 migrates one, its entry moves in config/nav.ts and gets a
    // real route here instead — this table is the migration's progress display.
    ...NAV_ENTRIES.filter((entry) => entry.path !== '/').map((entry) => ({
      path: entry.path,
      name: entry.path.slice(1),
      component: LegacyHandoff,
      props: { label: entry.label, legacyHref: entry.legacyHref },
    })),
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});
