/**
 * Market Aggregator
 * 
 * This is the core logic engine. It receives raw market events (Depth, Trades) and:
 * 1. Maintains an in-memory Order Book (Bids/Asks maps).
 * 2. Buffers recent trades.
 * 3. periodically "Buckets" this state into a snapshot (HeatmapColumn).
 * 
 * The output is a series of "Columns" sent to the frontend, representing vertical slices of the heatmap.
 */

import { HeatmapColumn, TradeData } from './types';
import { CONFIG } from './config';

// -- Incoming Message Interfaces --

export interface DepthMessage {
  contractId: string;
  domType: number; // Enum: 1=Ask, 2=Bid, 6=Reset, etc.
  price: number;
  volume: number;
  timestamp: string;
}

export interface TradeMessage {
  contractId: string;
  price: number;
  quantity: number;
  aggressorSide: number; // Enum: 0=Buy, 1=Sell
  timestamp: string;
}

export class MarketAggregator {
  private contractId: string;
  private tickSize: number;
  
  // Order Book State: Key = Tick Index (Price / TickSize), Value = Volume
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  
  // Buffer for trades that happened in the current time bucket
  private currentBucketTrades: TradeData[] = [];
  
  // Timer for generating buckets
  private intervalId: NodeJS.Timeout | null = null;
  private onColumnGenerated: (col: HeatmapColumn) => void;

  // Track the last known mid-tick to stabilize view if data pauses
  private lastMidTick: number = 0;

  constructor(contractId: string, tickSize: number, onColumnGenerated: (col: HeatmapColumn) => void) {
    this.contractId = contractId;
    this.tickSize = tickSize;
    this.onColumnGenerated = onColumnGenerated;
  }

  public start() {
    if (this.intervalId) return;
    // Start the bucketing loop
    this.intervalId = setInterval(() => this.bucket(), CONFIG.BUCKET_MS);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Processes an incoming Market Depth update.
   * Maps TopstepX/ProjectX DomTypes to our internal Order Book state.
   */
  public handleDepth(msg: DepthMessage) {
    const tick = Math.round(msg.price / this.tickSize);
    
    // Official DomType Enum Mapping:
    // 6: Reset -> Clear book
    // 1, 3, 10: Ask types -> Update Asks
    // 2, 4, 9: Bid types -> Update Bids
    
    switch (msg.domType) {
      case 6: // Reset
        this.bids.clear();
        this.asks.clear();
        break;
        
      case 1:  // Ask
      case 3:  // BestAsk
      case 10: // NewBestAsk
        if (msg.volume === 0) this.asks.delete(tick);
        else this.asks.set(tick, msg.volume);
        break;

      case 2:  // Bid
      case 4:  // BestBid
      case 9:  // NewBestBid
        if (msg.volume === 0) this.bids.delete(tick);
        else this.bids.set(tick, msg.volume);
        break;
        
      default:
        // Ignore other types (Trade=5, Low=7, High=8, Fill=11, Unknown=0) for heatmap construction
        break;
    }
  }

  /**
   * Processes an incoming Trade execution.
   */
  public handleTrade(msg: TradeMessage) {
    const tick = Math.round(msg.price / this.tickSize);
    
    // Official TradeLogType Enum:
    // 0 = Buy
    // 1 = Sell
    
    let side: 'Buy' | 'Sell' | 'None' = 'None';
    if (msg.aggressorSide === 0) side = 'Buy';
    else if (msg.aggressorSide === 1) side = 'Sell';

    this.currentBucketTrades.push({
      priceTick: tick,
      price: msg.price,
      volume: msg.quantity,
      side,
      timestamp: new Date(msg.timestamp).getTime()
    });
  }

  /**
   * Generates a "HeatmapColumn" (snapshot) for the current time slice.
   * This is called every BUCKET_MS (e.g., 100ms).
   */
  private bucket() {
    // 1. Determine Mid Price for this bucket
    // Find best bid and best ask in current book
    let bestBid = -Infinity;
    let bestAsk = Infinity;

    for (const t of this.bids.keys()) if (t > bestBid) bestBid = t;
    for (const t of this.asks.keys()) if (t < bestAsk) bestAsk = t;
    
    // Debug logging for sanity check
    if (this.bids.size > 0 || this.asks.size > 0) {
      // console.log(`Bucket Stats: Bids=${this.bids.size} (Best=${bestBid}) Asks=${this.asks.size} (Best=${bestAsk})`);
    }

    // Calculate Mid
    let midTick = this.lastMidTick;
    if (bestBid !== -Infinity && bestAsk !== Infinity) {
      midTick = Math.round((bestBid + bestAsk) / 2);
    } else if (this.currentBucketTrades.length > 0) {
      // Fallback to last trade price if book is empty/crossed/invalid
      midTick = this.currentBucketTrades[this.currentBucketTrades.length - 1].priceTick;
    } else if (bestBid !== -Infinity) {
       midTick = bestBid;
    } else if (bestAsk !== Infinity) {
       midTick = bestAsk;
    }
    
    // Fallback if we have absolutely no data yet (start of stream)
    if (midTick === 0 && (bestBid !== -Infinity)) midTick = bestBid;
    if (midTick === 0 && (bestAsk !== Infinity)) midTick = bestAsk;

    // If still 0, we have no data at all. Skip emitting to avoid rendering bugs (zooming to 0).
    if (midTick === 0) {
      return;
    }

    this.lastMidTick = midTick;

    // 2. Build the Heatmap Window Arrays
    // We only send a fixed window around the mid price to save bandwidth.
    const windowSize = CONFIG.PRICE_WINDOW_TICKS;
    const halfWindow = Math.floor(windowSize / 2);
    const startTick = midTick - halfWindow;
    
    const bidArray = new Array(windowSize).fill(0);
    const askArray = new Array(windowSize).fill(0);

    // Populate arrays relative to the startTick
    // bidArray[0] represents liquidity at `startTick`
    for (let i = 0; i < windowSize; i++) {
      const t = startTick + i;
      bidArray[i] = this.bids.get(t) || 0;
      askArray[i] = this.asks.get(t) || 0;
    }

    // 3. Create the Column Object
    const column: HeatmapColumn = {
      t: Date.now(),
      midTick, // The center anchor for this column
      bids: bidArray,
      asks: askArray,
      trades: [...this.currentBucketTrades] // Trades happened in this bucket
    };

    // 4. Clear trade buffer for next bucket
    this.currentBucketTrades = [];

    // 5. Emit to listeners (index.ts will broadcast this via WebSocket)
    this.onColumnGenerated(column);
  }
}