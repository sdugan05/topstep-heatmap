"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = exports.sessionStore = void 0;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("./config");
// Simple in-memory session store
// In production, use Redis
exports.sessionStore = new Map();
class AuthService {
    static async login(userName, apiKey) {
        try {
            const url = `${config_1.CONFIG.PROJECTX_API_BASE}/api/Auth/loginKey`;
            const response = await axios_1.default.post(url, { userName, apiKey });
            if (response.data.success && response.data.token) {
                const sessionId = uuidv4();
                // Parse expiration if possible, or assume 24h. 
                // ProjectX usually gives expiration in response.
                const userSession = {
                    userName,
                    accessToken: response.data.token,
                    tokenExpiresAt: Date.now() + 23 * 60 * 60 * 1000 // Safety buffer
                };
                exports.sessionStore.set(sessionId, userSession);
                return { sessionId, userSession };
            }
            console.error('Login failed:', response.data.errorMessage);
            return null;
        }
        catch (error) {
            console.error('Login error:', error);
            return null;
        }
    }
    static async validateAndRefresh(sessionId) {
        const session = exports.sessionStore.get(sessionId);
        if (!session)
            return null;
        // Check if we need to refresh (e.g., if token is older than 1 hour or check validity)
        // For now, let's try to validate/refresh.
        try {
            const url = `${config_1.CONFIG.PROJECTX_API_BASE}/api/Auth/validate`;
            const response = await axios_1.default.post(url, {}, {
                headers: { Authorization: `Bearer ${session.accessToken}` }
            });
            if (response.data.success) {
                if (response.data.newToken) {
                    session.accessToken = response.data.newToken;
                    session.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
                    exports.sessionStore.set(sessionId, session);
                }
                return session.accessToken;
            }
        }
        catch (e) {
            console.error('Refresh failed', e);
        }
        return null;
    }
    static logout(sessionId) {
        exports.sessionStore.delete(sessionId);
    }
    static getSession(sessionId) {
        return exports.sessionStore.get(sessionId);
    }
}
exports.AuthService = AuthService;
// Simple UUID generator if we don't want to add another dependency
function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
