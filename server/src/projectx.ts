/**
 * ProjectX SignalR Client
 * 
 * Manages the real-time connection to the TopstepX / ProjectX Market Hub.
 * Uses @microsoft/signalr to connect via WebSockets.
 * 
 * Key Responsibilities:
 * 1. Establish and maintain the SignalR connection.
 * 2. Handle authentication (passing the JWT).
 * 3. Subscribe to contract data (Depth, Trades).
 * 4. Normalize incoming data (arrays vs objects) and dispatch to the Aggregator.
 */

import * as signalR from '@microsoft/signalr';
import WebSocket from 'ws';
import { CONFIG } from './config';
import { DepthMessage, TradeMessage } from './aggregator';

// Polyfill XHR for Node.js environment to avoid native fetch issues during negotiation
// This ensures compatibility with the SignalR client in a server-side environment.
(global as any).XMLHttpRequest = require('xhr2');

export class ProjectXSocket {
  private connection: signalR.HubConnection;
  private token: string;
  private isConnected = false;

  // callbacks for received data
  public onDepth?: (msg: DepthMessage) => void;
  public onTrade?: (msg: TradeMessage) => void;

  constructor(token: string) {
    this.token = token;
    
    // Disable strict SSL checks for this demo to avoid issues with proxies or self-signed certs
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

    // Construct the URL with the access token embedded
    const url = `${CONFIG.PROJECTX_RTC_BASE}/hubs/market?access_token=${this.token}`;

    /**
     * Build the SignalR Connection
     * - skipNegotiation: true -> Direct WebSocket connection, bypasses HTTP negotiation (faster, less firewall issues).
     * - transport: WebSockets -> Enforce WebSocket transport.
     * - WebSocket: WebSocket -> Pass the 'ws' library implementation for Node.js.
     * - headers: User-Agent -> Set a user agent to prevent blocking by WAFs.
     */
    this.connection = new signalR.HubConnectionBuilder()
      .withUrl(url, {
        skipNegotiation: true,
        transport: signalR.HttpTransportType.WebSockets,
        WebSocket: WebSocket as any,
        timeout: 10000,
        headers: {
          'User-Agent': 'NodeTS/1.0',
        }
      } as any)
      .withAutomaticReconnect() // Auto-reconnect if connection drops
      .configureLogging(signalR.LogLevel.Warning)
      .build();

    this.setupListeners();
  }

  /**
   * Sets up the event handlers for messages received from the Hub.
   * "GatewayDepth" and "GatewayTrade" are the event names sent by TopstepX.
   */
  private setupListeners() {
    this.connection.on('GatewayDepth', (contractId: any, data: any) => {
      // Data can be an array of updates or a single object. Normalize to array.
      const items = Array.isArray(data) ? data : [data];
      
      if (this.onDepth) {
        items.forEach((item: any) => {
          // Normalize and pass to callback
          this.onDepth!({
            contractId,
            domType: Number(item.domType ?? item.type), // Parse to number to be safe
            price: item.price,
            volume: item.volume,
            timestamp: item.timestamp
          });
        });
      }
    });

    this.connection.on('GatewayTrade', (contractId: any, data: any) => {
      const items = Array.isArray(data) ? data : [data];
      
      if (this.onTrade) {
        items.forEach((item: any) => {
          this.onTrade!({
            contractId,
            price: item.price,
            quantity: item.volume, // Map 'volume' field to 'quantity'
            aggressorSide: item.type, // Map 'type' field to 'aggressorSide'
            timestamp: item.timestamp
          });
        });
      }
    });
  }

  /**
   * Starts the SignalR connection.
   */
  public async start(): Promise<void> {
    if (this.isConnected) return;
    try {
      await this.connection.start();
      this.isConnected = true;
      console.log('SignalR Connected');
    } catch (err) {
      console.error('SignalR Connection Error', err);
      throw err;
    }
  }

  /**
   * Stops the connection.
   */
  public async stop(): Promise<void> {
    if (!this.isConnected) return;
    await this.connection.stop();
    this.isConnected = false;
    console.log('SignalR Disconnected');
  }

  /**
   * Invokes the server-side methods to subscribe to specific contract data streams.
   */
  public async subscribe(contractId: string) {
    if (!this.isConnected) await this.start();
    
    // Call Hub methods to subscribe
    await this.connection.invoke('SubscribeContractMarketDepth', contractId);
    await this.connection.invoke('SubscribeContractTrades', contractId);
    console.log(`Subscribed to ${contractId}`);
  }

  public async unsubscribe(contractId: string) {
    if (!this.isConnected) return;
     // Implement if needed: await this.connection.invoke('Unsubscribe...', contractId);
  }
  
  /**
   * Updates the internal token (used for re-connection logic).
   */
  public updateToken(newToken: string) {
    this.token = newToken;
  }
}