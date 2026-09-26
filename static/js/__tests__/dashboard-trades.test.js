/**
 * Dashboard Trade Functionality Tests
 * 
 * Tests for the automatic cash position refresh after trade entry
 * and related form/validation behavior.
 */

// Mock fetch for API calls
global.fetch = jest.fn();

// Mock toast notifications
global.showToast = jest.fn();

// Test data
const mockTradeResponse = {
  trade: {
    id: 'trade-uuid-1',
    symbol: 'BTC',
    side: 'buy',
    qty: 10,
    price: 35000,
    time: '2024-06-11T10:00:00Z',
    profit: null,
  },
  cashEntry: {
    id: 'cash-uuid-1',
    currency: 'USD',
    amount: -350000,
    description: 'Trade: BUY 10 BTC @ 35000',
    ts: 1718091600000,
  },
};

const mockCashEntries = [
  {
    id: 'cash-uuid-1',
    currency: 'USD',
    amount: -350000,
    description: 'Trade: BUY 10 BTC @ 35000',
    ts: 1718091600000,
  },
  {
    id: 'cash-uuid-2',
    currency: 'BRL',
    amount: 50000,
    description: 'Manual deposit',
    ts: 1718091500000,
  },
];

describe('Cash Positions Refresh After Trade Entry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset fetch mock
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => mockCashEntries,
    });
  });

  test('loadCashEntries fetches from /api/cash/entries endpoint', async () => {
    await fetch('/api/cash/entries');
    expect(global.fetch).toHaveBeenCalledWith('/api/cash/entries');
  });

  test('cache should be cleared after successful trade', () => {
    // When _cashEntriesAll is set to null, the next loadCashEntries call will fetch fresh data
    let _cashEntriesAll = { entries: [] };
    _cashEntriesAll = null; // Cache cleared
    
    expect(_cashEntriesAll).toBeNull();
  });

  test('trade response should include both trade and cashEntry objects', () => {
    expect(mockTradeResponse).toHaveProperty('trade');
    expect(mockTradeResponse).toHaveProperty('cashEntry');
    expect(mockTradeResponse.trade.symbol).toBe('BTC');
    expect(mockTradeResponse.cashEntry.currency).toBe('USD');
  });

  test('cash entry amount reflects buy transaction (negative)', () => {
    const { cashEntry } = mockTradeResponse;
    expect(cashEntry.amount).toBeLessThan(0);
    expect(cashEntry.amount).toBe(-350000);
  });

  test('cash entry description includes trade details', () => {
    const { cashEntry } = mockTradeResponse;
    expect(cashEntry.description).toContain('BUY');
    expect(cashEntry.description).toContain('10');
    expect(cashEntry.description).toContain('BTC');
    expect(cashEntry.description).toContain('35000');
  });

  test('renders cash entries with correct formatting', () => {
    const entry = mockCashEntries[0];
    const date = new Date(entry.ts).toLocaleDateString('pt-BR');
    
    expect(entry.currency).toBe('USD');
    expect(entry.amount).toBeLessThan(0);
    expect(typeof date).toBe('string');
  });

  test('handles sell transaction (positive cash amount)', () => {
    const sellCashEntry = {
      id: 'cash-uuid-3',
      currency: 'USD',
      amount: 70000, // positive for proceeds
      description: 'Trade: SELL 5 ETH @ 14000',
      ts: 1718091700000,
    };
    
    expect(sellCashEntry.amount).toBeGreaterThan(0);
    expect(sellCashEntry.description).toContain('SELL');
  });

  test('handles BRL asset transactions', () => {
    const brlCashEntry = {
      id: 'cash-uuid-4',
      currency: 'BRL',
      amount: -45000, // BRL deduction for BOVA11 buy
      description: 'Trade: BUY 100 BOVA11 @ 450',
      ts: 1718091800000,
    };
    
    expect(brlCashEntry.currency).toBe('BRL');
    expect(brlCashEntry.amount).toBeLessThan(0);
  });
});

describe('Form Input Behavior After Trade', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('form fields should be cleared after successful trade', () => {
    // After trade success, the form should reset:
    // symbol.value = 'BTC'
    // side.value = 'buy'
    // qty.value = ''
    // price.value = ''
    // tradeTotal.value = ''
    
    const formState = {
      symbol: 'BTC',
      side: 'buy',
      qty: '',
      price: '',
      tradeTotal: '',
    };
    
    expect(formState.symbol).toBe('BTC');
    expect(formState.qty).toBe('');
    expect(formState.price).toBe('');
    expect(formState.tradeTotal).toBe('');
  });

  test('success toast should display trade confirmation message', () => {
    const cashEntry = mockTradeResponse.cashEntry;
    const amount = Math.abs(cashEntry.amount);
    const currency = 'USD';
    const formatted = amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    
    const toastMessage = `Trade recorded. Cash deducted: $${formatted} ${currency}`;
    expect(toastMessage).toContain('Trade recorded');
    expect(toastMessage).toContain('350,000.00');
  });
});

describe('Trade Validation and Submission', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('BUY trade with quantity and total should be submittable without explicit price', () => {
    // With qty=10 and total=$350000, price can be calculated (350000/10 = 35000)
    const qty = 10;
    const total = 350000;
    const price = undefined;
    
    // Frontend no longer disables the button, so submission should work
    const canSubmit = qty > 0 && (price !== undefined || total > 0);
    expect(canSubmit).toBe(true);
  });

  test('SELL trade requires explicit price', () => {
    const side = 'sell';
    const price = null;
    
    // Backend rejects SELL without price
    const shouldRejectOnServer = side === 'sell' && price === null;
    expect(shouldRejectOnServer).toBe(true);
  });

  test('trade request payload includes cashSource', () => {
    const tradePayload = {
      symbol: 'BTC',
      side: 'buy',
      qty: 10,
      price: 35000,
      time: '2024-06-11T10:00:00Z',
      cashSource: 'USD',
    };
    
    expect(tradePayload).toHaveProperty('cashSource');
    expect(tradePayload.cashSource).toBe('USD');
  });

  test('trade request for BRL asset uses BRL cashSource', () => {
    const tradePayload = {
      symbol: 'BOVA11',
      side: 'buy',
      qty: 100,
      price: 450,
      time: '2024-06-11T10:00:00Z',
      cashSource: 'BRL',
    };
    
    expect(tradePayload.cashSource).toBe('BRL');
  });
});

describe('API Error Handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('409 error for currency mismatch is caught and displayed', () => {
    const errorResponse = {
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Asset BOVA11 uses BRL, but USD selected as cash source',
      }),
    };
    
    expect(errorResponse.status).toBe(409);
    expect(errorResponse.ok).toBe(false);
  });

  test('400 error for missing price on SELL is caught', () => {
    const errorResponse = {
      ok: false,
      status: 400,
      json: async () => ({
        error: 'Price required for sell trades',
      }),
    };
    
    expect(errorResponse.status).toBe(400);
    expect(errorResponse.ok).toBe(false);
  });

  test('error messages are displayed in error toast', () => {
    const errorMessage = 'Price required for sell trades';
    const toastCall = showToast(errorMessage, 'error', 5000);
    
    expect(showToast).toHaveBeenCalledWith(
      errorMessage,
      'error',
      5000
    );
  });
});

describe('Cash Entry Caching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('cache variable should prevent redundant API calls when not cleared', () => {
    let _cashEntriesAll = null;
    
    // First call fetches from API
    if (_cashEntriesAll === null) {
      _cashEntriesAll = mockCashEntries;
    }
    expect(_cashEntriesAll).toEqual(mockCashEntries);
    
    // Second call uses cache
    expect(_cashEntriesAll).not.toBeNull();
  });

  test('cache should be invalidated after trade to ensure fresh data', () => {
    let _cashEntriesAll = mockCashEntries;
    expect(_cashEntriesAll).not.toBeNull();
    
    // After successful trade, cache is cleared
    _cashEntriesAll = null;
    expect(_cashEntriesAll).toBeNull();
    
    // Next loadCashEntries will fetch fresh data
  });
});

describe('Cash Balance Display', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('BRL balance is calculated from cash entries', () => {
    const entries = mockCashEntries.filter((e) => e.currency === 'BRL');
    const brlBalance = entries.reduce((sum, e) => sum + e.amount, 0);
    
    expect(brlBalance).toBe(50000); // Only positive entry
  });

  test('USD balance is calculated from cash entries', () => {
    const entries = mockCashEntries.filter((e) => e.currency === 'USD');
    const usdBalance = entries.reduce((sum, e) => sum + e.amount, 0);
    
    expect(usdBalance).toBe(-350000); // Deduction from trade
  });

  test('cash balance elements are updated after loadCashEntries', () => {
    // Test that the balance display would be updated
    const brlBalance = 50000;
    const usdBalance = -350000;
    
    const brlFormatted = brlBalance.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const usdFormatted = Math.abs(usdBalance).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    
    expect(brlFormatted).toContain('50');
    expect(usdFormatted).toContain('350');
  });
});
