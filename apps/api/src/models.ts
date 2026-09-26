export interface Trade {
  id: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price?: number | null;
  time: string; // ISO
  profit?: number | null;
}

export interface HistoryPoint {
  id: string;
  t?: string;
  ts?: number;
  v: number;
  i?: number;
  p?: number;
  manual?: boolean;
  note?: string;
  brlusd_rate?: number | null;
}

export interface CashPositions {
  cashReais: number;
  cashDollars: number;
  interestReais: number;
  interestDollars: number;
}

export interface InterestMonth {
  month: string; // YYYY-MM
  amount: number;
}

export interface PriceCache {
  symbol: string;
  price: number;
  ts: number;
  meta?: any;
}

export interface Alert {
  id: string;
  symbol: string;
  alert_type: 'value' | 'percentage';
  threshold: number;
  condition: 'above' | 'below';
  reference_price?: number | null;
  is_active: number;
  created_at: number;
  // Trigger state — null when the alert has never fired or was reset
  current_price?: number | null;
  previous_price?: number | null;
  percentage_change?: number | null;
  triggered_at?: number | null;
  dismissed_at?: number | null;
  is_dismissed?: number;
}

export interface PriceTick {
  id: string;
  symbol: string;
  price: number;
  ts: number;
  source?: string | null;
}

export interface CashHistoryEntry {
  id: string;
  cashReais: number;
  cashDollars: number;
  interestReais: number;
  interestDollars: number;
  ts: number;
  note?: string | null;
}
