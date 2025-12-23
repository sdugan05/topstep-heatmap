/**
 * Authentication Service
 * 
 * Handles user login and session management.
 * 
 * Security Note:
 * This implementation uses an IN-MEMORY session store (Map).
 * In a production environment with multiple server instances, this must be replaced
 * with a distributed store like Redis.
 */

import axios from 'axios';
import { CONFIG } from './config';
import { ProjectXLoginResponse, ProjectXValidateResponse, UserSession } from './types';

// In-Memory Session Store: SessionID -> UserSession Object
export const sessionStore = new Map<string, UserSession>();

export class AuthService {
  /**
   * Authenticates a user against the ProjectX API.
   * If successful, creates a local session and returns the session ID.
   * 
   * @param userName ProjectX Username
   * @param apiKey ProjectX API Key
   * @returns { sessionId, userSession } or null if failed
   */
  static async login(userName: string, apiKey: string): Promise<{ sessionId: string, userSession: UserSession } | null> {
    try {
      const url = `${CONFIG.PROJECTX_API_BASE}/api/Auth/loginKey`;
      const response = await axios.post<ProjectXLoginResponse>(url, { userName, apiKey });
      
      if (response.data.success && response.data.token) {
        const sessionId = uuidv4(); // Generate a new Session ID
        
        // Create session object
        const userSession: UserSession = {
          userName,
          accessToken: response.data.token,
          // Store token expiration time (approximate, usually 24h)
          tokenExpiresAt: Date.now() + 23 * 60 * 60 * 1000 
        };
        
        // Save to store
        sessionStore.set(sessionId, userSession);
        return { sessionId, userSession };
      }
      console.error('Login failed:', response.data.errorMessage);
      return null;
    } catch (error) {
      console.error('Login error:', error);
      return null;
    }
  }

  /**
   * Validates the current token and refreshes it if necessary/possible.
   * Called by the background job in index.ts.
   */
  static async validateAndRefresh(sessionId: string): Promise<string | null> {
    const session = sessionStore.get(sessionId);
    if (!session) return null;

    try {
      const url = `${CONFIG.PROJECTX_API_BASE}/api/Auth/validate`;
      // Call validate endpoint with current token
      const response = await axios.post<ProjectXValidateResponse>(url, {}, {
        headers: { Authorization: `Bearer ${session.accessToken}` }
      });

      if (response.data.success) {
        // If API returns a new token, update our session
        if (response.data.newToken) {
          session.accessToken = response.data.newToken;
          session.tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000;
          sessionStore.set(sessionId, session);
        }
        return session.accessToken;
      }
    } catch (e) {
      console.error('Refresh failed', e);
    }
    return null;
  }
  
  static logout(sessionId: string) {
    sessionStore.delete(sessionId);
  }
  
  static getSession(sessionId: string): UserSession | undefined {
    return sessionStore.get(sessionId);
  }
}

/**
 * Simple UUID generator helper.
 * Generates a random v4-like UUID string.
 */
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}