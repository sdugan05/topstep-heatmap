export interface LoginRequest {
  userName: string;
  apiKey: string;
}

export interface ProjectXLoginResponse {
  token: string;
  expiration: string;
  success: boolean;
  errorCode?: number;
  errorMessage?: string;
}

export interface ProjectXValidateResponse {
  newToken?: string;
  success: boolean;
  // ... other fields
}

// Internal session stored on server
export interface UserSession {
  userName: string;
  accessToken: string; // The ProjectX JWT
  tokenExpiresAt: number; // timestamp
}

// Websocket messages (Server -> Client)
export interface HeatmapColumn {
  t: number; // timestamp
  midTick: number;
  bids: number[]; // size at [midTick - PRICE_WINDOW/2 + i]
  asks: number[]; // size at [midTick - PRICE_WINDOW/2 + i]
  trades: TradeData[];
}

export interface TradeData {
  priceTick: number;
  price: number;
  volume: number;
  side: 'Buy' | 'Sell' | 'None';
  timestamp: number;
}

export interface StreamStartRequest {
  contractId: string;
  tickSize?: number;
}
