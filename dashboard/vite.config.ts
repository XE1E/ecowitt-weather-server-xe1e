import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    // Sin mapas de código fuente en producción: nginx servía el .map (5.8 MB) y
    // cualquiera podía leer el código original del sitio. En `npm run dev` Vite
    // los genera igual, así que depurar en local no cambia.
    sourcemap: false,
    rollupOptions: {
      output: {
        // Librerías en archivos propios: cambian mucho menos que el código del sitio,
        // así que tras cada deploy el navegador las sigue teniendo en caché y sólo
        // baja lo nuevo.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          recharts: ['recharts'],
          posthog: ['posthog-js'],
        },
      },
    },
  }
})
