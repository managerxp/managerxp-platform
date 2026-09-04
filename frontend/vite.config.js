import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'


// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  build: {
    rollupOptions: {
      output: {
        /*
         * The entry chunk was 540 kB because React, the router and
         * framer-motion sat in it alongside every eagerly-imported page.
         *
         * Splitting the vendor libraries out means they carry their own
         * content hash: an edit to a marketing page no longer invalidates
         * 160 kB of gzipped framework that has not changed, so a returning
         * visitor re-downloads only what actually moved.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          motion: ['framer-motion'],
        },
      },
    },
  },
})
