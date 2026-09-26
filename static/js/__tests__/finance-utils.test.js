const { normalizeFinanceData, computeTithesForMonth, ensureAnnualTithes, computeMonthlySummary, computeAnnualSummary } = require('../finance-utils');

describe('finance-utils', () => {
  test('computeTithesForMonth returns expected tithes for known incomes', () => {
    const data = {
      incomes: [
        [
          { source: 'Stefanini', value: 1000 },
          { source: 'Mission Dev', value: 500 },
          { source: 'Number 8', value: 200 }
        ]
      ],
      tithes: [[]]
    };

    const tithes = computeTithesForMonth(0, data);

    expect(tithes.length).toBe(1);
    expect(tithes[0].source).toBe('Dízimo - Total');
    expect(tithes[0].value).toBeCloseTo(137.0, 2);
    expect(tithes[0].breakdown).toContain('10% de metade Mission Dev: R$ 25,00');
  });

  test('ensureAnnualTithes fills missing monthly tithes before annual calculations', () => {
    const data = {
      incomes: Array.from({ length: 12 }, () => []),
      tithes: Array.from({ length: 12 }, () => [])
    };

    data.incomes[0] = [
      { source: 'Stefanini', value: 1000 },
      { source: 'Mission Dev', value: 500 }
    ];
    data.incomes[1] = [
      { source: 'Number 8', value: 200 }
    ];

    ensureAnnualTithes(data);

    expect(data.tithes[0]).toHaveLength(1);
    expect(data.tithes[1]).toHaveLength(1);
    expect(data.tithes[0][0].value).toBeCloseTo(125.0, 2);
    expect(data.tithes[1][0].value).toBeCloseTo(12.0, 2);
    // Validate that months with no incomes still receive default tithes entries.
    expect(Array.isArray(data.tithes[2])).toBe(true);
    expect(data.tithes[2]).toHaveLength(1);
    expect(data.tithes[2][0].value).toBeCloseTo(0, 2);
  });

  test('computeMonthlySummary returns totals and tithes for a given month', () => {
    const data = {
      incomes: [
        [
          { source: 'Stefanini', value: 1000 },
          { source: 'Mission Dev', value: 500 }
        ]
      ],
      tithes: [[]],
      fixedExpenses: [[], ...Array.from({ length: 11 }, () => [])],
      eventualExpenses: [[], ...Array.from({ length: 11 }, () => [])],
      creditCards: { nuRenan: Array.from({ length: 12 }, () => []), nuJu: Array.from({ length: 12 }, () => []), nomad: Array.from({ length: 12 }, () => []) }
    };

    normalizeFinanceData(data);
    const summary = computeMonthlySummary(data, 0);

    expect(summary.totalIncomes).toBe(1500);
    expect(summary.totalTithes).toBeCloseTo(125, 2);
    expect(summary.entradasLiquidas).toBeCloseTo(1375, 2);
    expect(summary.despesas).toBe(0);
    expect(summary.saldo).toBeCloseTo(1375, 2);
    expect(summary.tithes).toHaveLength(1);
  });

  test('normalizeFinanceData seeds missing months and normalizes legacy categories', () => {
    const data = {
      incomes: [[]],
      tithes: [[]],
      fixedExpenses: [[{ name: 'Mercado', category: 'mercado', value: 100, paymentMethod: 'boleto' }]],
      eventualExpenses: [[]],
      creditCards: { nuRenan: [[]], nuJu: [[]], nomad: [[]] }
    };

    normalizeFinanceData(data);

    expect(data.incomes.length).toBe(12);
    expect(data.fixedExpenses.length).toBe(12);
    expect(data.creditCards.nuRenan.length).toBe(12);
    expect(data.fixedExpenses[0].some(item => item.category === 'alimentacao')).toBe(true);
    expect(data.fixedExpenses[0].some(item => item.name === 'Aluguel')).toBe(true);
  });
});