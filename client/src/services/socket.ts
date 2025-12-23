/**
 * DataStream Service
 * 
 * Wrapper around the native WebSocket API.
 * Handles:
 * 1. Connecting to the backend WebSocket server.
 * 2. Authenticating via the Session ID query param.
 * 3. Parsing incoming JSON messages (Heatmap Columns).
 * 4. Dispatching data to the React application via callback.
 */

import { HeatmapColumn } from '../types';

export class DataStream {
  private ws: WebSocket | null = null;
  private url: string;
  private onData: (col: HeatmapColumn) => void;

  constructor(sessionId: string, onData: (col: HeatmapColumn) => void) {
    // Backend is on localhost:3001
    this.url = `ws://localhost:3001?sessionId=${sessionId}`;
    this.onData = onData;
  }

  connect() {
    if (this.ws) return;
    this.ws = new WebSocket(this.url);
    
    this.ws.onopen = () => {
      console.log('WS Connected');
    };
    
    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        // Expecting { type: 'column', data: HeatmapColumn }
        if (msg.type === 'column') {
          this.onData(msg.data);
        }
      } catch (e) {
        console.error('WS Parse Error', e);
      }
    };

    this.ws.onclose = () => {
      console.log('WS Closed');
      this.ws = null;
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}