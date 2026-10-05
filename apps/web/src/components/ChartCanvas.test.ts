// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import type { ChartConfiguration } from 'chart.js';

const registry = vi.hoisted(() => ({
  created: [] as Array<{ canvas: unknown; config: unknown }>,
  destroyed: [] as unknown[],
}));

vi.mock('chart.js/auto', () => {
  class FakeChart {
    constructor(canvas: unknown, config: unknown) {
      registry.created.push({ canvas, config });
    }

    destroy(): void {
      registry.destroyed.push(this);
    }
  }
  return { default: FakeChart };
});

const lineConfig = {
  type: 'line',
  data: { labels: [], datasets: [] },
  options: {},
} as unknown as ChartConfiguration<'line'>;

const barConfig = {
  type: 'bar',
  data: { labels: [], datasets: [] },
  options: {},
} as unknown as ChartConfiguration<'bar'>;

const CONTEXT = {} as unknown;

// jsdom has no 2D canvas, so the real `getContext('2d')` answers null here.
const stubContext = () => vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(CONTEXT as never);

const loadComponent = async () => (await import('./ChartCanvas.vue')).default;

beforeEach(() => {
  registry.created.length = 0;
  registry.destroyed.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChartCanvas', () => {
  test('shows the empty message and builds nothing when there is no config', async () => {
    const ChartCanvas = await loadComponent();
    const wrapper = mount(ChartCanvas, { props: { config: null, emptyMessage: 'No data yet' } });

    expect(wrapper.find('.chart-empty').text()).toBe('No data yet');
    expect(registry.created).toHaveLength(0);

    wrapper.unmount();
  });

  test('builds exactly one chart on mount from the rendered canvas', async () => {
    const getContext = stubContext();

    const ChartCanvas = await loadComponent();
    const wrapper = mount(ChartCanvas, { props: { config: lineConfig, emptyMessage: 'No data yet' } });

    expect(getContext).toHaveBeenCalledTimes(1);
    expect(getContext).toHaveBeenCalledWith('2d');
    expect(registry.created).toHaveLength(1);
    expect(registry.created[0].config).toEqual(lineConfig);
    expect(registry.created[0].canvas).toBe(CONTEXT);
    expect(wrapper.find('canvas').exists()).toBe(true);
    expect(wrapper.find('.chart-empty').exists()).toBe(false);

    wrapper.unmount();
  });

  test('a new config destroys the previous chart instead of leaking it', async () => {
    stubContext();
    const ChartCanvas = await loadComponent();
    const wrapper = mount(ChartCanvas, { props: { config: lineConfig, emptyMessage: 'No data yet' } });

    await wrapper.setProps({ config: barConfig });

    expect(registry.created).toHaveLength(2);
    expect(registry.destroyed).toHaveLength(1);
    expect(registry.created[1].config).toEqual(barConfig);

    wrapper.unmount();
  });

  test('losing the config tears the chart down and brings the message back', async () => {
    stubContext();
    const ChartCanvas = await loadComponent();
    const wrapper = mount(ChartCanvas, { props: { config: lineConfig, emptyMessage: 'No data yet' } });

    await wrapper.setProps({ config: null });

    expect(registry.destroyed).toHaveLength(1);
    expect(registry.created).toHaveLength(1);
    expect(wrapper.find('.chart-empty').text()).toBe('No data yet');

    wrapper.unmount();
  });

  test('unmounting destroys the chart, so a route change cannot leave one running', async () => {
    stubContext();
    const ChartCanvas = await loadComponent();
    const wrapper = mount(ChartCanvas, { props: { config: lineConfig, emptyMessage: 'No data yet' } });

    wrapper.unmount();

    expect(registry.destroyed).toHaveLength(1);
  });

  test('mounting without a config then unmounting destroys nothing', async () => {
    const ChartCanvas = await loadComponent();
    const wrapper = mount(ChartCanvas, { props: { config: null, emptyMessage: 'No data yet' } });

    wrapper.unmount();

    expect(registry.destroyed).toHaveLength(0);
  });
});
