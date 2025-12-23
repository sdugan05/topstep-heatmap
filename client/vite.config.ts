import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Proxy API requests to backend
      '/auth': 'http://localhost:3001',
      '/stream': 'http://localhost:3001',
      '/config': 'http://localhost:3001'
    }
  }
})
