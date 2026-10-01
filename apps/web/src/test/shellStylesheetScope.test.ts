// @vitest-environment node
import { describe, expect, test } from 'vitest';

import analyticsCss from '../../../../static/css/analytics.css?raw';
import baseCss from '../../../../static/css/base.css?raw';
import componentsCss from '../../../../static/css/components.css?raw';
import dashboardCss from '../../../../static/css/dashboard.css?raw';
import layoutCss from '../../../../static/css/layout.css?raw';
import simulationCss from '../../../../static/css/simulation.css?raw';
import indexHtml from '../../index.html?raw';

/**
 * The shell owns markup that no page wrapper encloses.
 *
 * `App.vue` renders `.shell > .app-header` and then `<RouterView />` and
 * `<SettingsModal />` as **siblings**. So the header, the nav and both of the
 * shell's modals sit outside `.dashboard-page` / `.analytics-page` /
 * `.simulation-page` entirely — and a page stylesheet scoped to one of those
 * roots cannot style them, however correct the rule looks.
 *
 * That is not hypothetical. `.modal` and `.modal-content` were scoped to
 * `.dashboard-page` until 2026-10-01, and the result was that the settings gear
 * rendered its dialog as unstyled static block content at the bottom of the
 * document. `AGENTS.md` recorded the rule against it, and a later pass over the
 * same selectors removed both the exemption and the comment.
 *
 * The failure hid because it is asymmetric: the scenario modals are rendered by
 * a page, so the page-scoped rule matched them and they kept working. Only the
 * shell's own two modals broke, and only for whoever clicked the gear.
 *
 * `AGENTS.md` tells a maintainer to intersect the page stylesheets' class names
 * by hand. This is that check, run by CI instead.
 *
 * The stylesheets arrive as `?raw` strings rather than through `node:fs`, so the
 * browser app's type graph stays free of Node builtins — `vue-tsc` runs over this
 * file as part of `npm run build`, and adding `"types": ["node"]` to
 * `apps/web/tsconfig.json` to accommodate a test would be the wrong trade.
 */

/** The page roots each view wraps itself in. */
const PAGE_ROOTS = ['dashboard-page', 'analytics-page', 'simulation-page'];

/**
 * Loaded only as a side effect of the view that owns them, so a direct load of a
 * different route never fetches them.
 */
const PAGE_STYLESHEETS: Record<string, string> = {
  'dashboard.css': dashboardCss,
  'analytics.css': analyticsCss,
  'simulation.css': simulationCss,
};

/** Linked from `apps/web/index.html`, so present on every route. */
const GLOBAL_STYLESHEETS: Record<string, string> = {
  'base.css': baseCss,
  'components.css': componentsCss,
  'layout.css': layoutCss,
};

/**
 * Every class the shell subtree renders. From `App.vue` (`.shell`,
 * `.app-header`, `.app-brand`, `.app-logo`, `.app-brand-name`,
 * `.app-header-actions`), `AppNav.vue` (`.app-nav`, `.nav-link`, `.is-active`),
 * `SettingsModal.vue` (`.modal`, `.modal-content`, `.settings-content`,
 * `.modal-close`, `.tool-row`, `.tool-row-top`, `.tool-title`, `.tool-sub`,
 * `.tool-action`, `.confirm-actions`, `.confirm-delete`) and the gear button's
 * own `.btn`.
 *
 * Add to this when the shell grows a component. A class missing here is a class
 * nothing is checking.
 */
const SHELL_CLASSES = [
  'shell',
  'app-header',
  'app-header-actions',
  'app-brand',
  'app-brand-name',
  'app-logo',
  'app-nav',
  'nav-link',
  'is-active',
  'modal',
  'modal-content',
  'settings-content',
  'modal-close',
  'tool-row',
  'tool-row-top',
  'tool-title',
  'tool-sub',
  'tool-action',
  'confirm-actions',
  'confirm-delete',
];

/** Strips `/* ... *\/` comments, whose prose must not be read as selectors. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The selectors a stylesheet declares.
 *
 * Deliberately not a CSS parser: splitting on block boundaries and commas is
 * enough to recover the selector of every rule in these files, and a real parser
 * would be more code than the check is worth.
 */
function selectors(css: string): string[] {
  return stripComments(css)
    .split('}')
    .map((block) => block.split('{')[0] ?? '')
    .flatMap((head) => head.split(','))
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0);
}

/** The class names a selector mentions, in any position. */
function classNames(selector: string): string[] {
  return [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
}

describe('page stylesheets never style shell-owned markup', () => {
  test.each(Object.keys(PAGE_STYLESHEETS))('%s scopes no shell class to a page root', (file) => {
    const offenders = selectors(PAGE_STYLESHEETS[file])
      .filter((selector) => classNames(selector).some((name) => PAGE_ROOTS.includes(name)))
      .map((selector) => ({
        selector,
        shellClasses: classNames(selector).filter((name) => SHELL_CLASSES.includes(name)),
      }))
      .filter((offender) => offender.shellClasses.length > 0);

    expect(
      offenders,
      `${file} styles shell-owned markup, which no page root encloses:\n` +
        offenders.map((o) => `  ${o.selector}  ->  ${o.shellClasses.join(', ')}`).join('\n') +
        '\n\nEither move the rule to components.css, or drop the page-root prefix if it was never needed.',
    ).toEqual([]);
  });
});

describe('the modal is styled on every route, not only on the dashboard', () => {
  test('components.css declares .modal and .modal-content unscoped', () => {
    // The whole point of the location: components.css is linked from index.html,
    // so it is fetched on /analytics and /simulation too. In dashboard.css this
    // rule only arrived as a side effect of DashboardView.vue's import, so a
    // direct load of another route had no modal styling at all.
    const globals = selectors(Object.values(GLOBAL_STYLESHEETS).join('\n'));

    expect(globals).toContain('.modal');
    expect(globals).toContain('.modal-content');
  });

  test('index.html links every globally-available stylesheet', () => {
    for (const file of Object.keys(GLOBAL_STYLESHEETS)) {
      expect(indexHtml, `${file} is treated as globally available but index.html does not link it`).toContain(
        `/static/css/${file}`,
      );
    }
  });

  test('no page stylesheet redefines the modal', () => {
    // Two definitions of "the modal" is the underlying disease: they had already
    // drifted apart on padding and border-radius by the time the shell's copy
    // turned out to be unreachable.
    for (const [file, css] of Object.entries(PAGE_STYLESHEETS)) {
      const modalSelectors = selectors(css).filter((selector) => classNames(selector).includes('modal'));

      expect(modalSelectors, `${file} redefines .modal; it belongs in components.css`).toEqual([]);
    }
  });
});
