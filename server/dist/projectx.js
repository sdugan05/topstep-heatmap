"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectXSocket = void 0;
const signalR = __importStar(require("@microsoft/signalr"));
const ws_1 = __importDefault(require("ws"));
const config_1 = require("./config");
// Polyfill XHR for Node.js environment to avoid native fetch issues
global.XMLHttpRequest = require('xhr2');
class ProjectXSocket {
    constructor(token) {
        this.isConnected = false;
        this.token = token;
        // Allow self-signed certs or strict firewalls for this demo
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
        const url = `${config_1.CONFIG.PROJECTX_RTC_BASE}/hubs/market?access_token=${this.token}`;
        this.connection = new signalR.HubConnectionBuilder()
            .withUrl(url, {
            skipNegotiation: true,
            transport: signalR.HttpTransportType.WebSockets,
            WebSocket: ws_1.default,
            timeout: 10000,
            headers: {
                'User-Agent': 'NodeTS/1.0',
            }
        })
            .withAutomaticReconnect()
            .configureLogging(signalR.LogLevel.Warning)
            .build();
        this.setupListeners();
    }
    setupListeners() {
        this.connection.on('GatewayDepth', (contractId, data) => {
            const items = Array.isArray(data) ? data : [data];
            if (this.onDepth) {
                items.forEach((item) => {
                    this.onDepth({
                        contractId,
                        domType: Number(item.domType ?? item.type), // Ensure number
                        price: item.price,
                        volume: item.volume,
                        timestamp: item.timestamp
                    });
                });
            }
        });
        this.connection.on('GatewayTrade', (contractId, data) => {
            // console.log('Raw Trade:', contractId, data);
            if (this.onTrade) {
                const items = Array.isArray(data) ? data : [data];
                items.forEach((item) => {
                    this.onTrade({
                        contractId,
                        price: item.price,
                        quantity: item.volume, // Map volume -> quantity
                        aggressorSide: item.type, // Map type -> aggressorSide
                        timestamp: item.timestamp
                    });
                });
            }
        });
        // Handle others if needed like GatewayQuote
    }
    async start() {
        if (this.isConnected)
            return;
        try {
            await this.connection.start();
            this.isConnected = true;
            console.log('SignalR Connected');
        }
        catch (err) {
            console.error('SignalR Connection Error', err);
            throw err;
        }
    }
    async stop() {
        if (!this.isConnected)
            return;
        await this.connection.stop();
        this.isConnected = false;
        console.log('SignalR Disconnected');
    }
    async subscribe(contractId) {
        if (!this.isConnected)
            await this.start();
        // TopstepX/ProjectX Hub methods often look like this:
        await this.connection.invoke('SubscribeContractMarketDepth', contractId);
        await this.connection.invoke('SubscribeContractTrades', contractId);
        // await this.connection.invoke('SubscribeContractQuotes', contractId);
        console.log(`Subscribed to ${contractId}`);
    }
    async unsubscribe(contractId) {
        if (!this.isConnected)
            return;
        // If there are unsubscribe methods, invoke them. 
        // Usually UnsubscribeContractMarketDepth etc.
        // For now, we assume stopping the stream implies we might just disconnect or ignore.
    }
    updateToken(newToken) {
        this.token = newToken;
        // Note: SignalR doesn't update token on the fly easily without reconnect.
        // .withAutomaticReconnect uses the factory, so if we update the variable
        // the factory uses, it should work on *reconnect*.
    }
}
exports.ProjectXSocket = ProjectXSocket;
