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
  build: {
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mui/x-date-pickers') || id.includes('dayjs')) {
              return 'vendor-date-pickers'
            }
            if (id.includes('@mui/material') || id.includes('@mui/system') || id.includes('@emotion')) {
              return 'vendor-mui'
            }
            if (id.includes('lucide-react') || id.includes('@mui/icons-material')) {
              return 'vendor-icons'
            }
            if (id.includes('react-dom') || id.includes('react/')) {
              return 'vendor-react'
            }
          }
        }
      }
    }
  },
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
