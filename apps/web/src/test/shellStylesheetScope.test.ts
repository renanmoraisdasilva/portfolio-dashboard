// @vitest-environment node
import { describe, expect, test } from 'vitest';

import analyticsCss from '../../../../static/css/analytics.css?raw';
import baseCss from '../../../../static/css/base.css?raw';
import componentsCss from '../../../../static/css/components.css?raw';
import dashboardCss from '../../../../static/css/dashboard.css?raw';
import layoutCss from '../../../../static/css/layout.css?raw';
import simulationCss from '../../../../static/css/simulation.css?raw';
import indexHtml from '../../index.html?raw';

const PAGE_ROOTS = ['dashboard-page', 'analytics-page', 'simulation-page'];

const PAGE_STYLESHEETS: Record<string, string> = {
  'dashboard.css': dashboardCss,
  'analytics.css': analyticsCss,
  'simulation.css': simulationCss,
};

const GLOBAL_STYLESHEETS: Record<string, string> = {
  'base.css': baseCss,
  'components.css': componentsCss,
  'layout.css': layoutCss,
};

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

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function selectors(css: string): string[] {
  return stripComments(css)
    .split('}')
    .map((block) => block.split('{')[0] ?? '')
    .flatMap((head) => head.split(','))
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0);
}

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
    for (const [file, css] of Object.entries(PAGE_STYLESHEETS)) {
      const modalSelectors = selectors(css).filter((selector) => classNames(selector).includes('modal'));

      expect(modalSelectors, `${file} redefines .modal; it belongs in components.css`).toEqual([]);
    }
  });
});
