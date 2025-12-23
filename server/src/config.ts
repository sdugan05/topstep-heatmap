import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  PORT: process.env.PORT || 3001,
  PROJECTX_API_BASE: process.env.PROJECTX_API_BASE || 'https://gateway-api-demo.s2f.projectx.com',
  PROJECTX_RTC_BASE: process.env.PROJECTX_RTC_BASE || 'https://gateway-rtc-demo.s2f.projectx.com',
  // Default aggregation settings
  BUCKET_MS: parseInt(process.env.BUCKET_MS || '100', 10),
  PRICE_WINDOW_TICKS: parseInt(process.env.PRICE_WINDOW_TICKS || '200', 10), // Window around mid price
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev_secret_key_change_me'
};
