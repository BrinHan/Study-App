import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'
import { VitePWA } from 'vite-plugin-pwa'
import { realpathSync } from 'node:fs'

export default defineConfig({
  base: './',
  // realpath: on some Windows setups the project folder is a redirected (virtualized) path.
  server: { fs: { allow: [process.cwd(), realpathSync.native(process.cwd())] } },
  optimizeDeps: { include: ['compromise/two', 'idb'] },
  worker: { format: 'es' },
  plugins: [
    preact(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Margin',
        short_name: 'Margin',
        description: 'Turn your own notes into flashcards and quizzes. Works offline.',
        theme_color: '#1E1E1E',
        background_color: '#1E1E1E',
        display: 'standalone',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
})
