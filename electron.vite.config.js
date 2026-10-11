import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index:  resolve('src/main/index.js'),
          db:     resolve('src/main/db.js'),
          auth:   resolve('src/main/auth.js'),
          drive:  resolve('src/main/drive.js'),
          sync:   resolve('src/main/sync.js'),
          config: resolve('src/main/config.js')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
