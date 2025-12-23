/**
 * API Service
 * 
 * wrapper around Axios for HTTP communication with the backend.
 * Handles:
 * 1. Auth requests (Login, Logout, Status)
 * 2. Stream control (Start, Stop)
 * 3. Config fetching
 * 
 * Uses 'withCredentials: true' to ensure the HttpOnly session cookie is sent/received.
 */

import axios from 'axios';
import { AuthStatus, LoginResponse } from '../types';

// Points to the backend Express server
const API_BASE = 'http://localhost:3001';

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true // Crucial for session cookies
});

export const authApi = {
  login: async (userName: string, apiKey: string) => {
    const res = await api.post<LoginResponse>('/auth/login', { userName, apiKey });
    return res.data;
  },
  logout: async () => {
    const res = await api.post('/auth/logout');
    return res.data;
  },
  status: async () => {
    const res = await api.get<AuthStatus>('/auth/status');
    return res.data;
  }
};

export const streamApi = {
  start: async (contractId: string | number, tickSize: number) => {
    const res = await api.post('/stream/start', { contractId, tickSize });
    return res.data;
  },
  stop: async () => {
    const res = await api.post('/stream/stop');
    return res.data;
  },
  getConfig: async () => {
    const res = await api.get('/config');
    return res.data;
  }
};