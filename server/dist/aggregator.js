"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketAggregator = exports.DomType = void 0;
const config_1 = require("./config");
// Enums based on typical ProjectX
var DomType;
(function (DomType) {
    DomType[DomType["Reset"] = 0] = "Reset";
    DomType[DomType["Bid"] = 1] = "Bid";
    DomType[DomType["Ask"] = 2] = "Ask";
})(DomType || (exports.DomType = DomType = {}));
class MarketAggregator {
    constructor(contractId, tickSize, onColumnGenerated) {
        // State: TickIndex -> Size
        this.bids = new Map();
        this.asks = new Map();
        this.currentBucketTrades = [];
        // Timer for bucketing
        this.intervalId = null;
        this.lastMidTick = 0;
        this.contractId = contractId;
        this.tickSize = tickSize;
        this.onColumnGenerated = onColumnGenerated;
    }
    start() {
        if (this.intervalId)
            return;
        this.intervalId = setInterval(() => this.bucket(), config_1.CONFIG.BUCKET_MS);
    }
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
    }
    handleDepth(msg) {
        const tick = Math.round(msg.price / this.tickSize);
        // Official DomType Enum:
        // Unknown=0, Ask=1, Bid=2, BestAsk=3, BestBid=4, Trade=5, Reset=6, 
        // Low=7, High=8, NewBestBid=9, NewBestAsk=10, Fill=11
        switch (msg.domType) {
            case 6: // Reset
                this.bids.clear();
                this.asks.clear();
                break;
            case 1: // Ask
            case 3: // BestAsk
            case 10: // NewBestAsk
                if (msg.volume === 0)
                    this.asks.delete(tick);
                else
                    this.asks.set(tick, msg.volume);
                break;
            case 2: // Bid
            case 4: // BestBid
            case 9: // NewBestBid
                if (msg.volume === 0)
                    this.bids.delete(tick);
                else
                    this.bids.set(tick, msg.volume);
                break;
            default:
                // Ignore Trade(5), Low(7), High(8), Fill(11), Unknown(0) for Heatmap
                break;
        }
    }
    handleTrade(msg) {
        const tick = Math.round(msg.price / this.tickSize);
        // Official TradeLogType Enum:
        // Buy = 0
        // Sell = 1
        let side = 'None';
        if (msg.aggressorSide === 0)
            side = 'Buy';
        else if (msg.aggressorSide === 1)
            side = 'Sell';
        this.currentBucketTrades.push({
            priceTick: tick,
            price: msg.price,
            volume: msg.quantity,
            side,
            timestamp: new Date(msg.timestamp).getTime()
        });
    }
    bucket() {
        // 1. Determine mid price
        // Best Bid / Best Ask
        let bestBid = -Infinity;
        let bestAsk = Infinity;
        for (const t of this.bids.keys())
            if (t > bestBid)
                bestBid = t;
        for (const t of this.asks.keys())
            if (t < bestAsk)
                bestAsk = t;
        // DEBUG LOG: Check if we have Bids/Asks and what the prices are
        if (this.bids.size > 0 || this.asks.size > 0) {
            console.log(`Bucket Stats: Bids=${this.bids.size} (Best=${bestBid}) Asks=${this.asks.size} (Best=${bestAsk})`);
        }
        let midTick = this.lastMidTick;
        if (bestBid !== -Infinity && bestAsk !== Infinity) {
            midTick = Math.round((bestBid + bestAsk) / 2);
        }
        else if (this.currentBucketTrades.length > 0) {
            midTick = this.currentBucketTrades[this.currentBucketTrades.length - 1].priceTick;
        }
        else if (bestBid !== -Infinity) {
            midTick = bestBid;
        }
        else if (bestAsk !== Infinity) {
            midTick = bestAsk;
        }
        // Fallback if we have absolutely no data yet
        if (midTick === 0 && (bestBid !== -Infinity))
            midTick = bestBid;
        if (midTick === 0 && (bestAsk !== Infinity))
            midTick = bestAsk;
        // If still 0, we have no data at all, skip emitting to avoid zooming issues
        if (midTick === 0) {
            return;
        }
        this.lastMidTick = midTick;
        // 2. Build window arrays
        const windowSize = config_1.CONFIG.PRICE_WINDOW_TICKS;
        const halfWindow = Math.floor(windowSize / 2);
        const startTick = midTick - halfWindow;
        const bidArray = new Array(windowSize).fill(0);
        const askArray = new Array(windowSize).fill(0);
        for (let i = 0; i < windowSize; i++) {
            const t = startTick + i;
            bidArray[i] = this.bids.get(t) || 0;
            askArray[i] = this.asks.get(t) || 0;
        }
        // 3. Create column
        const column = {
            t: Date.now(),
            midTick,
            bids: bidArray,
            asks: askArray,
            trades: [...this.currentBucketTrades]
        };
        // console.log(`Bucket emitted. Mid: ${midTick}, Trades: ${this.currentBucketTrades.length}`);
        // 4. Reset trades
        this.currentBucketTrades = [];
        // 5. Emit
        this.onColumnGenerated(column);
    }
}
exports.MarketAggregator = MarketAggregator;
