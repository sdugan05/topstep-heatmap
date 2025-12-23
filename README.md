# Heatmap / Bookmap Clone

A real-time market data visualization tool connecting to TopstepX / ProjectX.

## Features
- **Rolling Heatmap**: Visualizes market depth history.
- **Trade Bubbles**: Overlays executed trades with size and side.
- **Secure Auth**: Proxies ProjectX Auth via local backend; JWT never exposed to browser.
- **Performance**: Canvas-based rendering for high-frequency updates.

## Prerequisites
- Node.js (v18+)
- TopstepX / ProjectX Account (Username + API Key)

## Setup

1. **Install Dependencies**
   ```bash
   # Root contains server and client folders
   cd server
   npm install
   
   cd ../client
   npm install
   ```

2. **Configuration**
   - In `server/`, copy `.env.example` to `.env`.
   - The default values are usually sufficient for demo environments.
   - `PROJECTX_API_BASE` and `PROJECTX_RTC_BASE` should point to the correct environment (Demo or Live).

3. **Running the Application**

   **Start Server:**
   ```bash
   cd server
   npm run dev
   ```
   Server runs on port 3001.

   **Start Client:**
   ```bash
   cd client
   npm run dev
   ```
   Client runs on port 5173.

4. **Usage**
   - Open `http://localhost:5173`.
   - Login with your ProjectX Username and API Key.
   - Enter a Contract ID (e.g., `3309650` for a demo contract, check your dashboard for IDs).
   - Click "Start Data".
   - Adjust "Tick Size" if the heatmap scale looks wrong (too compressed or expanded).

## Architecture
- **Backend (Node/Express/SignalR)**: Authenticates with ProjectX, holds the JWT session, connects to SignalR market hub, aggregates data into time buckets (100ms), and broadcasts "columns" to the frontend via WebSocket.
- **Frontend (React/Vite/Canvas)**: Connects to backend WebSocket, buffers columns, and renders them on an HTML5 Canvas using a rolling window approach.

## Notes
- This is a Market-By-Price visualization.
- `DomType.Reset` clears the book.
- `DomType.Bid`/`Ask` updates are absolute levels.
- Login session is stored in memory on the backend (lost on server restart).
