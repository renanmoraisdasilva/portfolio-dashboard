import { yearFilter, currentYear, runF, getF, allF, financeDb } from './financeDb';

describe('financeDb helpers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('yearFilter returns clause and params when given a number', () => {
    const yf = yearFilter(2023);
    expect(yf).toEqual({ clause: ' AND year = ?', params: [2023] });
  });

  test('yearFilter returns empty clause when not given', () => {
    const yf = yearFilter();
    expect(yf).toEqual({ clause: '', params: [] });
  });

  test('currentYear returns a reasonable number', () => {
    const y = currentYear();
    expect(typeof y).toBe('number');
    expect(y).toBeGreaterThanOrEqual(2000);
  });

  test('runF resolves on success and rejects on error', async () => {
    const run = jest.fn();
    const prepareSpy = jest.spyOn(financeDb, 'prepare').mockImplementation(() => ({ run } as any));

    await expect(runF('CREATE TABLE test (id INTEGER)')).resolves.toBeUndefined();
    expect(prepareSpy).toHaveBeenCalledWith('CREATE TABLE test (id INTEGER)');
    expect(run).toHaveBeenCalledWith();

    prepareSpy.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(runF('CREATE TABLE test (id INTEGER)')).rejects.toThrow('boom');
  });

  test('getF returns a row or rejects on error', async () => {
    const get = jest.fn().mockReturnValue({ id: 1 });
    const prepareSpy = jest.spyOn(financeDb, 'prepare').mockImplementation(() => ({ get } as any));

    await expect(getF('SELECT 1')).resolves.toEqual({ id: 1 });
    expect(prepareSpy).toHaveBeenCalledWith('SELECT 1');
    expect(get).toHaveBeenCalledWith();

    prepareSpy.mockImplementation(() => {
      throw new Error('nope');
    });

    await expect(getF('SELECT 1')).rejects.toThrow('nope');
  });

  test('allF returns rows or rejects on error', async () => {
    const all = jest.fn().mockReturnValue([{ id: 1 }, { id: 2 }]);
    const prepareSpy = jest.spyOn(financeDb, 'prepare').mockImplementation(() => ({ all } as any));

    await expect(allF('SELECT *')).resolves.toEqual([{ id: 1 }, { id: 2 }]);
    expect(prepareSpy).toHaveBeenCalledWith('SELECT *');
    expect(all).toHaveBeenCalledWith();

    prepareSpy.mockImplementation(() => {
      throw new Error('err');
    });

    await expect(allF('SELECT *')).rejects.toThrow('err');
  });
});
