/**
 * Main Server Entry Point
 * 
 * This file sets up the Express application and the WebSocket server.
 * It handles:
 * 1. HTTP API routes for Authentication (/auth/login, /auth/logout)
 * 2. HTTP API routes for Stream Management (/stream/start, /stream/stop)
 * 3. WebSocket connections for broadcasting real-time heatmap data to clients.
 * 4. Background tasks like token refreshing.
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cookieSession from 'cookie-session';
import cors from 'cors';
import { CONFIG } from './config';
import { AuthService } from './auth';
import { ProjectXSocket } from './projectx';
import { MarketAggregator } from './aggregator';
import { HeatmapColumn } from './types';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// -- Middleware Setup --

// Enable CORS to allow the Vite frontend (running on a different port) to communicate with this backend.
app.use(cors({
  origin: 'http://localhost:5173', // Vite default port
  credentials: true // Allow cookies to be sent
}));

// Parse JSON bodies for API requests
app.use(express.json());

// Set up cookie-based sessions to store the 'sessionId'.
// The actual session data (JWTs) is stored in-memory on the server (see auth.ts).
app.use(cookieSession({
  name: 'session',
  keys: [CONFIG.SESSION_SECRET],
  maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));

// -- Client & Stream Management --

/**
 * ClientManager
 * Tracks active WebSocket connections associated with a specific sessionId.
 * This allows us to broadcast data to all open tabs/windows for a logged-in user.
 */
class ClientManager {
  private static clients = new Map<string, Set<WebSocket>>();

  static add(sessionId: string, ws: WebSocket) {
    if (!this.clients.has(sessionId)) {
      this.clients.set(sessionId, new Set());
    }
    this.clients.get(sessionId)!.add(ws);
  }

  static remove(sessionId: string, ws: WebSocket) {
    const set = this.clients.get(sessionId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) this.clients.delete(sessionId);
    }
  }

  static getClients(sessionId: string): Set<WebSocket> | undefined {
    return this.clients.get(sessionId);
  }
}

/**
 * ActiveStream Interface
 * Represents a running data stream for a specific user session.
 * Includes the SignalR connection to TopstepX and the Aggregator processing that data.
 */
interface ActiveStream {
  socket: ProjectXSocket;
  aggregator: MarketAggregator;
  contractId: string;
}

// Map to store the active stream for each session ID.
const streams = new Map<string, ActiveStream>();

// -- Authentication Routes --

/**
 * POST /auth/login
 * Exchanges ProjectX credentials (username/apikey) for a session.
 * The actual ProjectX JWT is never sent to the client; only a session ID is returned.
 */
app.post('/auth/login', async (req, res) => {
  const { userName, apiKey } = req.body;
  if (!userName || !apiKey) {
    return res.status(400).json({ error: 'Missing credentials' });
  }

  const result = await AuthService.login(userName, apiKey);
  if (result) {
    // Store the sessionId in the HTTP-only cookie
    req.session!.sessionId = result.sessionId;
    return res.json({ success: true, sessionId: result.sessionId });
  } else {
    return res.status(401).json({ error: 'Login failed' });
  }
});

/**
 * POST /auth/logout
 * Cleans up the user's stream (disconnects SignalR) and removes the session.
 */
app.post('/auth/logout', async (req, res) => {
  const sessionId = req.session?.sessionId;
  if (sessionId) {
    // Cleanup active stream if exists
    const stream = streams.get(sessionId);
    if (stream) {
      await stream.socket.stop();
      stream.aggregator.stop();
      streams.delete(sessionId);
    }
    AuthService.logout(sessionId);
    req.session = null;
  }
  res.json({ success: true });
});

/**
 * GET /auth/status
 * Checks if the user has a valid active session.
 */
app.get('/auth/status', (req, res) => {
  const sessionId = req.session?.sessionId;
  if (sessionId) {
    const session = AuthService.getSession(sessionId);
    if (session) {
      return res.json({ authenticated: true, userName: session.userName });
    }
  }
  return res.json({ authenticated: false });
});

// -- Stream Control Routes --

/**
 * POST /stream/start
 * Initiates the data stream for a requested Contract ID.
 * 1. Checks auth.
 * 2. Connects to TopstepX SignalR.
 * 3. Sets up the MarketAggregator.
 * 4. Starts broadcasting updates to the user's WebSocket clients.
 */
app.post('/stream/start', async (req, res) => {
  const sessionId = req.session?.sessionId;
  if (!sessionId) return res.status(401).json({ error: 'Not authenticated' });

  const session = AuthService.getSession(sessionId);
  if (!session) return res.status(401).json({ error: 'Session expired' });

  const { contractId, tickSize } = req.body;
  if (!contractId || !tickSize) return res.status(400).json({ error: 'Missing contractId or tickSize' });

  // Stop existing stream if user switches contract
  let stream = streams.get(sessionId);
  if (stream) {
    await stream.socket.stop();
    stream.aggregator.stop();
    streams.delete(sessionId);
  }

  // Create new components
  const socket = new ProjectXSocket(session.accessToken);
  
  // The Aggregator receives raw data and emits a 'HeatmapColumn' every BUCKET_MS
  const aggregator = new MarketAggregator(contractId.toString(), tickSize, (col: HeatmapColumn) => {
    // Broadcast the aggregated column to all frontend clients for this session
    const clients = ClientManager.getClients(sessionId);
    if (clients) {
      const msg = JSON.stringify({ type: 'column', data: col });
      for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(msg);
        }
      }
    }
  });

  // Wire up SignalR events to the Aggregator
  socket.onDepth = (msg) => {
    // Ensure loose equality or string comparison for contract IDs
    if (String(msg.contractId) === String(contractId)) aggregator.handleDepth(msg);
  };
  socket.onTrade = (msg) => {
    if (String(msg.contractId) === String(contractId)) aggregator.handleTrade(msg);
  };

  try {
    // Connect and Subscribe
    await socket.start();
    await socket.subscribe(contractId.toString());
    aggregator.start(); // Start the bucketing timer

    streams.set(sessionId, {
      socket,
      aggregator,
      contractId: contractId.toString()
    });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Stream start error', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /stream/stop
 * Stops the data stream without logging out.
 */
app.post('/stream/stop', async (req, res) => {
  const sessionId = req.session?.sessionId;
  if (!sessionId) return res.status(401).json({ error: 'Not authenticated' });

  const stream = streams.get(sessionId);
  if (stream) {
    await stream.socket.stop();
    stream.aggregator.stop();
    streams.delete(sessionId);
  }
  res.json({ success: true });
});

app.get('/config', (req, res) => {
  res.json({
    bucketMs: CONFIG.BUCKET_MS,
    windowTicks: CONFIG.PRICE_WINDOW_TICKS
  });
});

// -- WebSocket Server Handling --

/**
 * Handle new WebSocket connections from the frontend.
 * The frontend must provide the ?sessionId= query param to authenticate.
 */
wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', 'http://localhost');
  const sessionId = url.searchParams.get('sessionId');

  // Validate session
  if (!sessionId || !AuthService.getSession(sessionId)) {
    ws.close(1008, 'Authentication required');
    return;
  }

  console.log(`WS Client connected for session ${sessionId}`);
  ClientManager.add(sessionId, ws);

  ws.on('close', () => {
    ClientManager.remove(sessionId, ws);
  });
});

// -- Background Tasks --

/**
 * Token Refresh Loop
 * Runs every 50 minutes to refresh the TopstepX JWTs for all active sessions.
 * This ensures streams don't die after 24h (or however long the token lasts).
 */
setInterval(async () => {
  console.log('Running token refresh cycle...');
  for (const [sessionId, stream] of streams.entries()) {
    const newToken = await AuthService.validateAndRefresh(sessionId);
    if (newToken) {
      console.log(`Refreshed token for session ${sessionId}`);
      stream.socket.updateToken(newToken);
    } else {
      console.warn(`Failed to refresh token for session ${sessionId}`);
    }
  }
}, 50 * 60 * 1000);

// Start the HTTP server
server.listen(CONFIG.PORT, () => {
  console.log(`Server running on port ${CONFIG.PORT}`);
});
