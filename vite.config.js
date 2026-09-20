import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

const frontendPort = process.env.PORT
  ? parseInt(process.env.PORT, 10)
  : (process.env.VITE_PORT ? parseInt(process.env.VITE_PORT, 10) : 5173);

const backendPort = process.env.BACKEND_PORT || '8000';
const backendTarget = process.env.BACKEND_URL || `http://127.0.0.1:${backendPort}`;
const wsBackendTarget = process.env.WS_BACKEND_URL || `ws://127.0.0.1:${backendPort}`;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    host: '0.0.0.0',
    port: frontendPort,
    strictPort: false,
    watch: {
      ignored: [
        '**/backend/**',
        '**/models/**',
        '**/snapshots/**',
        '**/snapshots - Copy/**',
        '**/snapshots*/**',
        '**/*.db*',
        '**/*.pt',
        '**/*.onnx',
        '**/*.jpg',
        '**/*.jpeg',
        '**/*.png',
        '**/*.mp4',
        '**/*.avi',
      ],
    },
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/ws': {
        target: wsBackendTarget,
        ws: true,
      },
      '/snapshots': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
