import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [
    react({
      // Allow JSX inside .js files (gameState.js uses JSX for GameProvider)
      include: /\.(jsx|js|tsx|ts)$/,
    }),
  ],
  optimizeDeps: {
    // Only scan the root index.html; ignore legacy Equity Empire/ subfolder
    entries: ['index.html'],
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
})
