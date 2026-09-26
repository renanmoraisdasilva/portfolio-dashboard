/* eslint-disable @typescript-eslint/no-var-requires */
jest.mock('../financeDb', () => ({
  runF: jest.fn(),
  allF: jest.fn(),
  getF: jest.fn(),
  currentYear: jest.fn(),
  yearFilter: jest.fn(),
}));

import * as db from '../financeDb';
import * as svc from './financeService';

const mockedDb = db as unknown as {
  runF: jest.Mock<any, any>;
  allF: jest.Mock<any, any>;
  getF: jest.Mock<any, any>;
  currentYear: jest.Mock<any, any>;
  yearFilter: jest.Mock<any, any>;
};

const DATA_TABLES = ['incomes', 'tithes', 'fixed_expenses', 'eventual_expenses', 'credit_card_expenses'];

beforeEach(() => {
  mockedDb.runF.mockClear();
  mockedDb.allF.mockClear();
  mockedDb.getF.mockClear();
  mockedDb.currentYear.mockReset();
  mockedDb.yearFilter.mockReset();
  mockedDb.currentYear.mockReturnValue(new Date().getFullYear());
  mockedDb.yearFilter.mockImplementation((y?: number) => ({ clause: typeof y === 'number' ? ' AND year = ?' : '', params: typeof y === 'number' ? [y] : [] }));
});

describe('financeService (unit)', () => {
  test('addIncome calls runF and returns inserted row', async () => {
    mockedDb.runF.mockResolvedValue(undefined);
    const expected = { id: 'abc', month: 1, year: 2026, source: 'Job', value: 100, description: 'd' };
    mockedDb.getF.mockResolvedValue(expected);

    const res = await svc.addIncome(1, 'Job', 100, 'd', 2026);
    expect(mockedDb.runF).toHaveBeenCalled();
    expect(res).toEqual(expected);
  });

  test('updateIncome updates and returns row', async () => {
    mockedDb.runF.mockResolvedValue(undefined);
    const updated = { id: 'u1', month: 2, year: 2026, source: 'X', value: 50, description: 'u' };
    mockedDb.getF.mockResolvedValue(updated);

    const res = await svc.updateIncome('u1', 'X', 50, 'u');
    expect(mockedDb.runF).toHaveBeenCalledWith(expect.stringContaining('UPDATE incomes SET'), expect.any(Array));
    expect(res).toEqual(updated);
  });

  test('deleteIncome calls runF with delete statement', async () => {
    mockedDb.runF.mockResolvedValue(undefined);
    await svc.deleteIncome('del1');
    expect(mockedDb.runF).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM incomes WHERE id=?'), ['del1']);
  });

  test('createFinanceYear validates and inserts', async () => {
    mockedDb.runF.mockResolvedValue(undefined);
    const year = await svc.createFinanceYear(2025);
    expect(year).toBe(2025);
    expect(mockedDb.runF).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO finance_years'), expect.any(Array));
  });

  test('resetFinanceYear deletes tables for given year', async () => {
    mockedDb.runF.mockResolvedValue(undefined);
    const ok = await svc.resetFinanceYear(2025);
    expect(ok).toBe(true);
    // should call DELETE FROM for multiple data tables
    expect(mockedDb.runF).toHaveBeenCalled();
    const hadDelete = mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('DELETE FROM'));
    expect(hadDelete).toBe(true);
  });

  test('importFinanceJSON inserts provided rows', async () => {
    mockedDb.runF.mockResolvedValue(undefined);
    const months = Array.from({ length: 12 }, () => [] as any[]);
    months[1] = [{ source: 'Job', value: 123 }];
    const json = {
      year: 2022,
      incomes: months,
      tithes: Array.from({ length: 12 }, () => []),
      fixedExpenses: Array.from({ length: 12 }, () => []),
      eventualExpenses: Array.from({ length: 12 }, () => []),
      creditCards: { nuRenan: Array.from({ length: 12 }, () => []), nuJu: Array.from({ length: 12 }, () => []), nomad: Array.from({ length: 12 }, () => []) }
    };

    await svc.importFinanceJSON(json as any);
    // Expect at least one INSERT into incomes
    const inserted = mockedDb.runF.mock.calls.some(call => typeof call[0] === 'string' && call[0].includes('INSERT INTO incomes'));
    expect(inserted).toBe(true);
  });

  test('exportFinanceJSON returns object with 12 months', async () => {
    mockedDb.allF.mockResolvedValue([]);
    const out = await svc.exportFinanceJSON(2022);
    expect(out.year).toBe(2022);
    expect(Array.isArray(out.incomes)).toBe(true);
    expect(out.incomes.length).toBe(12);
    expect(mockedDb.allF).toHaveBeenCalledWith(
      'SELECT id,source,value,description FROM incomes WHERE month=? AND year = ?',
      [0, 2022],
    );
    expect(mockedDb.allF).toHaveBeenCalledWith(
      'SELECT id,category,value,description,paymentMethod,paidOnDate FROM credit_card_expenses WHERE month=? AND card=? AND year = ?',
      [0, 'nuRenan', 2022],
    );
  });

  test('fixed expense CRUD functions call DB helpers', async () => {
    mockedDb.allF.mockResolvedValue([{ id: 'f1' }]);
    const fe = await svc.getFixedExpenses(3, 2022);
    expect(fe).toEqual([{ id: 'f1' }]);
    expect(mockedDb.allF).toHaveBeenCalledWith(expect.stringContaining('fixed_expenses'), expect.any(Array));

    mockedDb.runF.mockResolvedValue(undefined);
    mockedDb.getF.mockResolvedValue({ id: 'fx', name: 'Rent', month: 3 });
    const added = await svc.addFixedExpense(3, 'Rent', 'Housing', 1200, 'card', 2022);
    expect(added).toEqual({ id: 'fx', name: 'Rent', month: 3 });

    mockedDb.getF.mockResolvedValue({ id: 'fx', name: 'Rent Updated' });
    const updated = await svc.updateFixedExpense('fx', { name: 'Rent Updated' });
    expect(updated).toEqual({ id: 'fx', name: 'Rent Updated' });

    await svc.deleteFixedExpense('fx');
    expect(mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('DELETE FROM'))).toBe(true);
  });

  test('updateFixedExpense with no fields only updates ts and returns row', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'fx', name: 'Rent', month: 3 });

    const res = await svc.updateFixedExpense('fx', {});

    expect(mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('UPDATE fixed_expenses SET'))).toBe(false);
    expect(mockedDb.getF).toHaveBeenCalledWith('SELECT * FROM fixed_expenses WHERE id=?', ['fx']);
    expect(res).toEqual({ id: 'fx', name: 'Rent', month: 3 });
  });

  test('updateFixedExpense normalizes normallyDueDay when provided', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'fx', name: 'Rent', month: 3 });

    await svc.updateFixedExpense('fx', { normallyDueDay: 0 });

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE fixed_expenses SET'));
    expect(call).toBeDefined();
    expect(call![1]).toContain(null);
  });

  test('updateFixedExpense normalizes nullish fields and accepts valid due day values', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'fx', name: null, category: null, value: 0, paymentMethod: null, normallyDueDay: 15 });

    await svc.updateFixedExpense('fx', {
      name: null as any,
      category: null as any,
      value: null as any,
      paymentMethod: null as any,
      normallyDueDay: '15' as any,
    });

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE fixed_expenses SET'));
    expect(call).toBeDefined();
    expect(call![1][0]).toBeNull();
    expect(call![1][1]).toBeNull();
    expect(call![1][2]).toBe(0);
    expect(call![1][3]).toBeNull();
    expect(call![1][4]).toBe(15);
  });

  test('updateFixedExpense rejects non-integer due day values', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'fx', normallyDueDay: null });

    await svc.updateFixedExpense('fx', { normallyDueDay: '15.5' as any });

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE fixed_expenses SET'));
    expect(call).toBeDefined();
    expect(call![1]).toContain(null);
  });

  test('createFinanceYear throws for invalid years', async () => {
    await expect(svc.createFinanceYear(1899)).rejects.toThrow('Invalid year');
    await expect(svc.createFinanceYear(3001)).rejects.toThrow('Invalid year');
    await expect(svc.createFinanceYear(NaN)).rejects.toThrow('Invalid year');
  });

  test('resetFinanceYear throws for invalid year', async () => {
    await expect(svc.resetFinanceYear(Number.NaN)).rejects.toThrow('Invalid year');
    expect(mockedDb.runF).not.toHaveBeenCalled();
  });

  test('getAvailableYears filters out invalid year values', async () => {
    mockedDb.allF.mockResolvedValue([{ year: 2022 }, { year: null }, { year: NaN } as any]);
    const yrs = await svc.getAvailableYears();
    expect(yrs).toEqual([2022]);
  });

  test('addCreditExpense stores null for missing optional fields', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'cnew', card: 'nuRenan', month: 2 });

    await svc.addCreditExpense('nuRenan', 2, 'Shopping', 200);

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO credit_card_expenses'));
    expect(call).toBeDefined();
    expect(call![1][6]).toBeNull();
    expect(call![1][7]).toBeNull();
    expect(call![1][8]).toBeNull();
  });

  test('updateCreditExpense with no fields only updates ts and returns row', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'cx', card: 'nuRenan', month: 3 });

    const res = await svc.updateCreditExpense('cx', {});

    expect(mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('UPDATE credit_card_expenses SET'))).toBe(false);
    expect(mockedDb.getF).toHaveBeenCalledWith('SELECT * FROM credit_card_expenses WHERE id=?', ['cx']);
    expect(res).toEqual({ id: 'cx', card: 'nuRenan', month: 3 });
  });

  test('updateCreditExpense can update paidOnDate explicitly to null', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'cx', card: 'nuRenan', month: 3 });

    await svc.updateCreditExpense('cx', { paidOnDate: null });

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE credit_card_expenses SET'));
    expect(call).toBeDefined();
    expect(call![1]).toContain(null);
  });

  test('getFixedExpenses supports year filter clause', async () => {
    mockedDb.allF.mockResolvedValue([{ id: 'f1' }]);
    await svc.getFixedExpenses(1);
    expect(mockedDb.allF).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM fixed_expenses WHERE month=?'), expect.any(Array));
  });

  test('getCreditExpenses supports year filter clause', async () => {
    mockedDb.allF.mockResolvedValue([{ id: 'c1' }]);
    await svc.getCreditExpenses('nuRenan', 2);
    expect(mockedDb.allF).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM credit_card_expenses WHERE card=? AND month=?'), expect.any(Array));
  });

  test('getFixedExpenses supports no year filter', async () => {
    mockedDb.allF.mockResolvedValue([{ id: 'f1' }]);
    await svc.getFixedExpenses(1);
    expect(mockedDb.allF).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM fixed_expenses WHERE month=?'), expect.any(Array));
  });

  test('getEventualExpenses supports no year filter', async () => {
    mockedDb.allF.mockResolvedValue([{ id: 'ev1' }]);
    await svc.getEventualExpenses(4);
    expect(mockedDb.allF).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM eventual_expenses WHERE month=?'), expect.any(Array));
  });

  test('addFixedExpense stores null for missing optional values', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'fx', name: 'Rent', month: 3 });

    await svc.addFixedExpense(3, 'Rent', 'Housing', 1200);

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO fixed_expenses'));
    expect(call).toBeDefined();
    expect(call![1][6]).toBeNull();
    expect(call![1][7]).toBeNull();
    expect(call![1][8]).toBeNull();
  });

  test('updateFixedExpense can set paidOnDate explicitly to null', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'fx', name: 'Rent', month: 3 });

    await svc.updateFixedExpense('fx', { paidOnDate: null });

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE fixed_expenses SET'));
    expect(call).toBeDefined();
    expect(call![1]).toContain(null);
  });

  test('resetFinanceYear deletes tables for valid year', async () => {
    mockedDb.runF.mockClear();
    const result = await svc.resetFinanceYear(2025);
    expect(result).toBe(true);
    expect(mockedDb.runF.mock.calls).toEqual(
      DATA_TABLES.map((table) => [`DELETE FROM ${table} WHERE year=?`, [2025]]),
    );
  });

  test('createFinanceYear inserts for valid year', async () => {
    mockedDb.runF.mockClear();
    mockedDb.runF.mockResolvedValue(undefined);
    const year = await svc.createFinanceYear(2025);
    expect(year).toBe(2025);
    expect(mockedDb.runF).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO finance_years'), expect.any(Array));
  });

  test('eventual expense CRUD functions call DB helpers', async () => {
    mockedDb.allF.mockResolvedValue([{ id: 'e1' }]);
    const ev = await svc.getEventualExpenses(4, 2022);
    expect(ev).toEqual([{ id: 'e1' }]);
    expect(mockedDb.allF).toHaveBeenCalledWith(expect.stringContaining('eventual_expenses'), expect.any(Array));

    mockedDb.runF.mockResolvedValue(undefined);
    mockedDb.getF.mockResolvedValue({ id: 'evx', category: 'Food', month: 4 });
    const added = await svc.addEventualExpense(4, 'Food', 50, 'lunch', 'card', 2022);
    expect(added).toEqual({ id: 'evx', category: 'Food', month: 4 });

    mockedDb.getF.mockResolvedValue({ id: 'evx', category: 'Food Updated' });
    const updated = await svc.updateEventualExpense('evx', { category: 'Food Updated' });
    expect(updated).toEqual({ id: 'evx', category: 'Food Updated' });

    await svc.deleteEventualExpense('evx');
    expect(mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('DELETE FROM'))).toBe(true);
  });

  test('addEventualExpense stores null optional fields and falls back to current year', async () => {
    mockedDb.runF.mockClear();
    mockedDb.currentYear.mockReturnValue(2042);
    mockedDb.getF.mockResolvedValue({ id: 'ev-null', category: 'Food', month: 4, year: 2042 });

    await svc.addEventualExpense(4, 'Food', 50);

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO eventual_expenses'));
    expect(call).toBeDefined();
    expect(call![1][2]).toBe(2042);
    expect(call![1][5]).toBeNull();
    expect(call![1][6]).toBeNull();
  });

  test('updateEventualExpense normalizes nullish fields to DB-safe defaults', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'evx', category: null, value: 0, description: null, paymentMethod: null });

    await svc.updateEventualExpense('evx', {
      category: null as any,
      value: null as any,
      description: null as any,
      paymentMethod: null as any,
    });

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE eventual_expenses SET'));
    expect(call).toBeDefined();
    expect(call![1][0]).toBeNull();
    expect(call![1][1]).toBe(0);
    expect(call![1][2]).toBeNull();
    expect(call![1][3]).toBeNull();
  });

  test('credit card expense CRUD functions call DB helpers', async () => {
    mockedDb.allF.mockResolvedValue([{ id: 'c1' }]);
    const ce = await svc.getCreditExpenses('nuRenan', 2, 2022);
    expect(ce).toEqual([{ id: 'c1' }]);
    expect(mockedDb.allF).toHaveBeenCalledWith(expect.stringContaining('credit_card_expenses'), expect.any(Array));

    mockedDb.runF.mockResolvedValue(undefined);
    mockedDb.getF.mockResolvedValue({ id: 'cnew', card: 'nuRenan', month: 2 });
    const added = await svc.addCreditExpense('nuRenan', 2, 'Shopping', 200, 'card', 'desc', 2022);
    expect(added).toEqual({ id: 'cnew', card: 'nuRenan', month: 2 });

    mockedDb.getF.mockResolvedValue({ id: 'cnew', category: 'Shopping Updated' });
    const updated = await svc.updateCreditExpense('cnew', { category: 'Shopping Updated' });
    expect(updated).toEqual({ id: 'cnew', category: 'Shopping Updated' });

    await svc.deleteCreditExpense('cnew');
    expect(mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('DELETE FROM credit_card_expenses'))).toBe(true);
  });

  test('updateCreditExpense normalizes nullish fields while still updating provided keys', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'cx', category: null, value: 0, paymentMethod: null, description: null, paidOnDate: null });

    await svc.updateCreditExpense('cx', {
      category: null as any,
      value: null as any,
      paymentMethod: null as any,
      description: null as any,
      paidOnDate: null,
    });

    const call = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE credit_card_expenses SET'));
    expect(call).toBeDefined();
    expect(call![0]).toContain('category=?');
    expect(call![0]).toContain('value=?');
    expect(call![0]).toContain('paymentMethod=?');
    expect(call![0]).toContain('description=?');
    expect(call![0]).toContain('paidOnDate=?');
    expect(call![1][0]).toBeNull();
    expect(call![1][1]).toBe(0);
    expect(call![1][2]).toBeNull();
    expect(call![1][3]).toBeNull();
    expect(call![1][4]).toBeNull();
  });

  test('getAvailableYears returns distinct years', async () => {
    mockedDb.allF.mockResolvedValue([{ year: 2022 }, { year: 2021 }]);
    const yrs = await svc.getAvailableYears();
    expect(yrs).toEqual([2022, 2021]);
  });

  test('initFinanceDB creates tables and handles missing year column', async () => {
    // simulate PRAGMA returning that year column exists
    mockedDb.runF.mockResolvedValue(undefined);
    mockedDb.allF.mockResolvedValue([{ name: 'year' }]);
    await svc.initFinanceDB();
    expect(mockedDb.runF).toHaveBeenCalled();
    expect(mockedDb.allF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('PRAGMA table_info'))).toBe(true);

    // simulate missing year column to trigger ALTER TABLE path
    mockedDb.runF.mockClear();
    mockedDb.allF.mockResolvedValue([]);
    await svc.initFinanceDB();
    const hadAlter = mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('ALTER TABLE'));
    expect(hadAlter).toBe(true);
  });

  test('importFinanceJSON legacy mode (no year) clears full tables and inserts tithes and credit cards', async () => {
    mockedDb.runF.mockClear();
    mockedDb.currentYear.mockReturnValue(2045);
    // Create a JSON payload without year (legacy)
    const months = Array.from({ length: 12 }, () => [] as any[]);
    months[2] = [{ source: 'Job', value: 500 }];
    const tithes = Array.from({ length: 12 }, () => [] as any[]);
    tithes[2] = [{ source: 'Tithe', value: 50, breakdown: 'b' }];
    const ccMonths = Array.from({ length: 12 }, () => [] as any[]);
    ccMonths[2] = [{ category: 'Fuel', value: 30 }];
    const json = {
      incomes: months,
      tithes,
      fixedExpenses: Array.from({ length: 12 }, () => []),
      eventualExpenses: Array.from({ length: 12 }, () => []),
      creditCards: { nuRenan: ccMonths, nuJu: Array.from({ length: 12 }, () => []), nomad: Array.from({ length: 12 }, () => []) }
    } as any;

    await svc.importFinanceJSON(json);
    expect(mockedDb.runF.mock.calls.slice(0, DATA_TABLES.length)).toEqual(
      DATA_TABLES.map((table) => [`DELETE FROM ${table}`, []]),
    );

    const incomeInsert = mockedDb.runF.mock.calls.find(c => c[0] === 'INSERT INTO incomes (id,month,year,source,value,description,ts) VALUES (?,?,?,?,?,?,?)');
    expect(incomeInsert).toBeDefined();
    expect(incomeInsert![1][1]).toBe(2);
    expect(incomeInsert![1][2]).toBe(2045);
    expect(incomeInsert![1][3]).toBe('Job');
    expect(incomeInsert![1][4]).toBe(500);

    const titheInsert = mockedDb.runF.mock.calls.find(c => c[0] === 'INSERT INTO tithes (id,month,year,source,value,breakdown,ts) VALUES (?,?,?,?,?,?,?)');
    expect(titheInsert).toBeDefined();
    expect(titheInsert![1][1]).toBe(2);
    expect(titheInsert![1][2]).toBe(2045);
    expect(titheInsert![1][3]).toBe('Tithe');
    expect(titheInsert![1][4]).toBe(50);
    expect(titheInsert![1][5]).toBe('b');

    const creditInsert = mockedDb.runF.mock.calls.find(c => c[0] === 'INSERT INTO credit_card_expenses (id,card,month,year,category,value,paymentMethod,description,paidOnDate,ts) VALUES (?,?,?,?,?,?,?,?,?,?)');
    expect(creditInsert).toBeDefined();
    expect(creditInsert![1][1]).toBe('nuRenan');
    expect(creditInsert![1][2]).toBe(2);
    expect(creditInsert![1][3]).toBe(2045);
    expect(creditInsert![1][4]).toBe('Fuel');
    expect(creditInsert![1][5]).toBe(30);
  });

  test('initFinanceDB handles runF throwing when altering table (catch branch)', async () => {
    // simulate no year column and runF throwing when ALTER TABLE is attempted
    mockedDb.allF.mockResolvedValue([]);
    mockedDb.runF.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('ALTER TABLE')) return Promise.reject(new Error('alter-fail'));
      return Promise.resolve(undefined);
    });

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(svc.initFinanceDB()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test('importFinanceJSON handles missing arrays and non-array creditCards entries', async () => {
    mockedDb.runF.mockClear();
    mockedDb.runF.mockResolvedValue(undefined);

    const json = {
      // no year (legacy) and several missing sections
      incomes: undefined,
      tithes: undefined,
      fixedExpenses: undefined,
      eventualExpenses: undefined,
      creditCards: { nuRenan: null, nuJu: 'not-array', nomad: [] }
    } as any;

    await expect(svc.importFinanceJSON(json)).resolves.toBeUndefined();
    expect(mockedDb.runF.mock.calls).toEqual(
      DATA_TABLES.map((table) => [`DELETE FROM ${table}`, []]),
    );
  });

  test('importFinanceJSON covers defaults and missing fields', async () => {
    mockedDb.runF.mockClear();
    mockedDb.runF.mockResolvedValue(undefined);

    const incomes = Array.from({ length: 12 });
    incomes[0] = [{}, { source: 'HasSource', value: 0 }];

    const tithes = Array.from({ length: 12 });
    tithes[0] = [{}, { source: 'T', value: 0 }];

    const fixedExpenses = Array.from({ length: 12 });
    fixedExpenses[0] = [{}, { name: 'Fixed', category: 'C', value: 0 }];

    const eventualExpenses = Array.from({ length: 12 });
    eventualExpenses[0] = [{}, { category: 'E', value: 0 }];

    const ccMonths = Array.from({ length: 12 });
    ccMonths[0] = [{}, { category: 'CC', value: 0 }];

    const json = {
      year: 2022,
      incomes,
      tithes,
      fixedExpenses,
      eventualExpenses,
      creditCards: { nuRenan: ccMonths, nuJu: Array.from({ length: 12 }), nomad: Array.from({ length: 12 }) }
    } as any;

    await svc.importFinanceJSON(json);

    const hadIncomeDefault = mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO incomes') && c[1][3] === null && c[1][4] === 0);
    expect(hadIncomeDefault).toBe(true);

    const hadTitheDefault = mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO tithes') && c[1][4] === 0);
    expect(hadTitheDefault).toBe(true);

    const hadEventualDefault = mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO eventual_expenses') && c[1][4] === 0);
    expect(hadEventualDefault).toBe(true);

    const hadCcDefault = mockedDb.runF.mock.calls.some(c => typeof c[0] === 'string' && c[0].includes('INSERT INTO credit_card_expenses') && c[1][4] === null && c[1][5] === 0);
    expect(hadCcDefault).toBe(true);
  });

  test('exportFinanceJSON defaults to currentYear when no year provided', async () => {
    mockedDb.allF.mockResolvedValue([]);
    mockedDb.currentYear.mockReturnValue(2033);
    const out = await svc.exportFinanceJSON();
    expect(out.year).toBe(2033);
  });

  test('addIncome without year uses currentYear default', async () => {
    mockedDb.runF.mockResolvedValue(undefined);
    mockedDb.getF.mockResolvedValue({ id: 'abc', month: 1, year: 2040, source: 'Job', value: 10 });
    mockedDb.currentYear.mockReturnValue(2040);
    const res = await svc.addIncome(1, 'Job', 10);
    expect(res.year).toBe(2040);
  });

  test('updateIncome with no description sets null in DB call', async () => {
    mockedDb.runF.mockClear();
    mockedDb.getF.mockResolvedValue({ id: 'u1' });
    mockedDb.runF.mockResolvedValue(undefined);
    await svc.updateIncome('u1', 'X', 10);
    const runCall = mockedDb.runF.mock.calls.find(c => typeof c[0] === 'string' && c[0].includes('UPDATE incomes SET'));
    expect(runCall).toBeDefined();
    expect(runCall[1][2]).toBeNull();
  });
});
