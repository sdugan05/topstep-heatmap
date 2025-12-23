"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONFIG = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.CONFIG = {
    PORT: process.env.PORT || 3001,
    PROJECTX_API_BASE: process.env.PROJECTX_API_BASE || 'https://gateway-api-demo.s2f.projectx.com',
    PROJECTX_RTC_BASE: process.env.PROJECTX_RTC_BASE || 'https://gateway-rtc-demo.s2f.projectx.com',
    // Default aggregation settings
    BUCKET_MS: parseInt(process.env.BUCKET_MS || '100', 10),
    PRICE_WINDOW_TICKS: parseInt(process.env.PRICE_WINDOW_TICKS || '200', 10), // Window around mid price
    SESSION_SECRET: process.env.SESSION_SECRET || 'dev_secret_key_change_me'
};
