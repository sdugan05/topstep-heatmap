export interface HeatmapColumn {
  t: number;
  midTick: number;
  bids: number[];
  asks: number[];
  trades: TradeData[];
}

export interface TradeData {
  priceTick: number;
  price: number;
  volume: number;
  side: 'Buy' | 'Sell' | 'None';
  timestamp: number;
}

export interface LoginResponse {
  success: boolean;
  sessionId: string;
}

export interface AuthStatus {
  authenticated: boolean;
  userName?: string;
}
