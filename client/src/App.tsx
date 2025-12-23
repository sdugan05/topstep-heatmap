/**
 * Main Application Component
 * 
 * Manages global state:
 * - Authentication (Session ID, Username)
 * - Configuration (Contract ID, Tick Size)
 * - WebSocket Connection (via DataStream service)
 * - Data Buffer (Ring buffer of heatmap columns)
 */

import { useEffect, useState } from 'react';
import { LoginForm } from './components/LoginForm';
import { HeatmapCanvas } from './components/HeatmapCanvas';
import { authApi, streamApi } from './services/api';
import { DataStream } from './services/socket';
import { HeatmapColumn } from './types';

function App() {
  // -- Auth State --
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  
  // -- Stream State --
  const [streaming, setStreaming] = useState(false);
  
  // -- Data Buffer --
  // Stores the recent history of market columns to be rendered.
  const [dataBuffer, setDataBuffer] = useState<HeatmapColumn[]>([]);

  // -- Configuration Inputs --
  // contractId: The ID of the instrument to trade (e.g. "CON.F.US.RTY.H25")
  // tickSize: Minimum price movement (e.g. 0.25 for MNQ/NQ/ES)
  const [contractId, setContractId] = useState<string>('3309650'); // Default example
  const [tickSize, setTickSize] = useState<number>(0.25);

  /**
   * On Mount: Check if user is already authenticated (session cookie exists).
   */
  useEffect(() => {
    authApi.status().then(s => {
      if (s.authenticated && s.userName) {
        setUserName(s.userName);
      }
    });
    
    // Recover sessionId from sessionStorage if page was refreshed
    const storedSession = sessionStorage.getItem('sessionId');
    if (storedSession) setSessionId(storedSession);
  }, []);

  /**
   * Handler for successful login form submission.
   */
  const handleLogin = (sid: string, user: string) => {
    setSessionId(sid);
    setUserName(user);
    sessionStorage.setItem('sessionId', sid);
  };

  /**
   * Handler for logout. Clears session and stops stream.
   */
  const handleLogout = async () => {
    await authApi.logout();
    setSessionId(null);
    setUserName(null);
    setStreaming(false);
    sessionStorage.removeItem('sessionId');
  };

  /**
   * Starts the data stream.
   * 1. Calls API to start server-side aggregation.
   * 2. Opens WebSocket connection to receive updates.
   */
  const startStream = async () => {
    if (!sessionId) return;
    try {
      // Tell backend to start processing this contract
      await streamApi.start(contractId, tickSize);
      
      // Initialize WebSocket connection
      const ws = new DataStream(sessionId, (col) => {
        // Callback for new data columns
        setDataBuffer(prev => {
          const next = [...prev, col];
          // Limit buffer size to prevent memory leaks (keep ~8-10 minutes of history at 100ms)
          if (next.length > 5000) next.shift(); 
          return next;
        });
      });
      ws.connect();
      
      // Save WS instance to window for debugging/cleanup access
      (window as any).wsInstance = ws;

      setStreaming(true);
    } catch (e: any) {
      console.error(e);
      // Handle Session Expiry
      if (e.response && e.response.status === 401) {
        alert('Session expired. Please login again.');
        handleLogout();
      } else {
        alert('Failed to start stream: ' + (e.response?.data?.error || e.message));
      }
    }
  };

  /**
   * Stops the stream.
   * 1. Calls API to stop server-side aggregation.
   * 2. Closes WebSocket.
   */
  const stopStream = async () => {
    try {
      await streamApi.stop();
      if ((window as any).wsInstance) {
        ((window as any).wsInstance as DataStream).disconnect();
      }
      setStreaming(false);
    } catch (e) {
      console.error(e);
    }
  };

  // If not logged in, show Login Form
  if (!sessionId) {
    return <LoginForm onLoginSuccess={handleLogin} />;
  }

  // If logged in, show Main UI
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top Bar: User Info & Controls */}
      <div style={{ padding: '10px', background: '#eee', display: 'flex', gap: '20px', alignItems: 'center' }}>
        <span>User: <strong>{userName}</strong></span>
        <button onClick={handleLogout}>Logout</button>
        
        <div style={{ borderLeft: '1px solid #ccc', paddingLeft: '20px', display: 'flex', gap: '10px' }}>
          <label>
            Contract ID:
            <input type="text" value={contractId} onChange={e => setContractId(e.target.value)} style={{width: '100px', marginLeft: '5px'}}/>
          </label>
          <label>
            Tick Size:
            <input type="number" value={tickSize} step="0.01" onChange={e => setTickSize(Number(e.target.value))} style={{width: '60px', marginLeft: '5px'}}/>
          </label>
          
          {!streaming ? (
            <button onClick={startStream} style={{ background: 'green', color: 'white' }}>Start Data</button>
          ) : (
            <button onClick={stopStream} style={{ background: 'red', color: 'white' }}>Stop Data</button>
          )}
        </div>
      </div>
      
      {/* Main Content: Heatmap Canvas */}
      <div style={{ flex: 1, position: 'relative', background: 'black' }}>
        <HeatmapCanvas data={dataBuffer} tickSize={tickSize} />
      </div>
    </div>
  );
}

export default App;