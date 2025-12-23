"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const ws_1 = require("ws");
const cookie_session_1 = __importDefault(require("cookie-session"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const auth_1 = require("./auth");
const projectx_1 = require("./projectx");
const aggregator_1 = require("./aggregator");
const app = (0, express_1.default)();
const server = (0, http_1.createServer)(app);
const wss = new ws_1.WebSocketServer({ server });
// Middleware
app.use((0, cors_1.default)({
    origin: 'http://localhost:5173', // Vite default
    credentials: true
}));
app.use(express_1.default.json());
app.use((0, cookie_session_1.default)({
    name: 'session',
    keys: [config_1.CONFIG.SESSION_SECRET],
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
}));
// Client Manager to track WS connections per session
class ClientManager {
    static add(sessionId, ws) {
        if (!this.clients.has(sessionId)) {
            this.clients.set(sessionId, new Set());
        }
        this.clients.get(sessionId).add(ws);
    }
    static remove(sessionId, ws) {
        const set = this.clients.get(sessionId);
        if (set) {
            set.delete(ws);
            if (set.size === 0)
                this.clients.delete(sessionId);
        }
    }
    static getClients(sessionId) {
        return this.clients.get(sessionId);
    }
}
ClientManager.clients = new Map();
const streams = new Map();
// Auth Routes
app.post('/auth/login', async (req, res) => {
    const { userName, apiKey } = req.body;
    if (!userName || !apiKey) {
        return res.status(400).json({ error: 'Missing credentials' });
    }
    const result = await auth_1.AuthService.login(userName, apiKey);
    if (result) {
        req.session.sessionId = result.sessionId;
        return res.json({ success: true, sessionId: result.sessionId });
    }
    else {
        return res.status(401).json({ error: 'Login failed' });
    }
});
app.post('/auth/logout', async (req, res) => {
    const sessionId = req.session?.sessionId;
    if (sessionId) {
        // Cleanup stream
        const stream = streams.get(sessionId);
        if (stream) {
            await stream.socket.stop();
            stream.aggregator.stop();
            streams.delete(sessionId);
        }
        auth_1.AuthService.logout(sessionId);
        req.session = null;
    }
    res.json({ success: true });
});
app.get('/auth/status', (req, res) => {
    const sessionId = req.session?.sessionId;
    if (sessionId) {
        const session = auth_1.AuthService.getSession(sessionId);
        if (session) {
            return res.json({ authenticated: true, userName: session.userName });
        }
    }
    return res.json({ authenticated: false });
});
// Stream Routes
app.post('/stream/start', async (req, res) => {
    const sessionId = req.session?.sessionId;
    if (!sessionId)
        return res.status(401).json({ error: 'Not authenticated' });
    const session = auth_1.AuthService.getSession(sessionId);
    if (!session)
        return res.status(401).json({ error: 'Session expired' });
    const { contractId, tickSize } = req.body;
    if (!contractId || !tickSize)
        return res.status(400).json({ error: 'Missing contractId or tickSize' });
    // If stream exists, stop it first
    let stream = streams.get(sessionId);
    if (stream) {
        await stream.socket.stop();
        stream.aggregator.stop();
        streams.delete(sessionId);
    }
    // Create new stream components
    const socket = new projectx_1.ProjectXSocket(session.accessToken);
    const aggregator = new aggregator_1.MarketAggregator(contractId.toString(), tickSize, (col) => {
        // Broadcast to this session's WS clients
        const clients = ClientManager.getClients(sessionId);
        if (clients) {
            const msg = JSON.stringify({ type: 'column', data: col });
            for (const client of clients) {
                if (client.readyState === ws_1.WebSocket.OPEN) {
                    client.send(msg);
                }
            }
        }
    });
    // Wire up
    socket.onDepth = (msg) => {
        // Ensure loose equality or string comparison
        if (String(msg.contractId) === String(contractId))
            aggregator.handleDepth(msg);
    };
    socket.onTrade = (msg) => {
        if (String(msg.contractId) === String(contractId))
            aggregator.handleTrade(msg);
    };
    try {
        await socket.start();
        await socket.subscribe(contractId.toString());
        aggregator.start();
        streams.set(sessionId, {
            socket,
            aggregator,
            contractId: contractId.toString()
        });
        res.json({ success: true });
    }
    catch (err) {
        console.error('Stream start error', err);
        res.status(500).json({ error: err.message });
    }
});
app.post('/stream/stop', async (req, res) => {
    const sessionId = req.session?.sessionId;
    if (!sessionId)
        return res.status(401).json({ error: 'Not authenticated' });
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
        bucketMs: config_1.CONFIG.BUCKET_MS,
        windowTicks: config_1.CONFIG.PRICE_WINDOW_TICKS
    });
});
// WebSocket Handling
wss.on('connection', (ws, req) => {
    // Parse sessionId from url params: /?sessionId=...
    const url = new URL(req.url || '', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !auth_1.AuthService.getSession(sessionId)) {
        ws.close(1008, 'Authentication required');
        return;
    }
    console.log(`WS Client connected for session ${sessionId}`);
    ClientManager.add(sessionId, ws);
    ws.on('close', () => {
        ClientManager.remove(sessionId, ws);
    });
});
// Token Refresh Loop (Every 50 minutes)
setInterval(async () => {
    console.log('Running token refresh cycle...');
    for (const [sessionId, stream] of streams.entries()) {
        const newToken = await auth_1.AuthService.validateAndRefresh(sessionId);
        if (newToken) {
            console.log(`Refreshed token for session ${sessionId}`);
            stream.socket.updateToken(newToken);
        }
        else {
            console.warn(`Failed to refresh token for session ${sessionId}`);
        }
    }
}, 50 * 60 * 1000);
server.listen(config_1.CONFIG.PORT, () => {
    console.log(`Server running on port ${config_1.CONFIG.PORT}`);
});
