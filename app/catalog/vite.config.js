import { defineConfig } from 'vite'
import AdmZip from 'adm-zip'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react(), {
      name: 'zip-dist', // zipping ./dist is required for BTP HTML5 repo or Application Frontend deployment
      closeBundle() {
        const zip = new AdmZip()
        zip.addLocalFolder('dist')
        zip.writeZip('dist/catalog.zip')
      }
  }],
  test: {
    environment: 'jsdom',
    globals: true,
    server: {
      deps: {
        inline: [
          /@mui\//,
          /@emotion\//,
          'react-transition-group'
        ]
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/odata': {
        target: 'http://localhost:4004',
        changeOrigin: true
      },
      '/api': {
        target: 'http://localhost:4004',
        changeOrigin: true
      }
    }
  }
})
