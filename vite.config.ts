import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        mobile: 'mobile.html',
      },
    },
  },
  server: {
    port: 3000,
    allowedHosts: ['.monkeycode-ai.online'],
  },
  preview: {
    port: 3000,
  },
  plugins: [
      // #39 PWA 离线缓存：precache 全部 public 资源（模型/贴图/纹理/CC0 音效）
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['models/*', 'textures/*', 'sounds/*', 'char_preview.html'],
      manifest: {
        name: 'STRIKE PROTOCOL',
        short_name: 'Strike',
        description: '浏览器 FPS · 5v5 爆破 · 单机 Bot',
        theme_color: '#3a6ea8',
        background_color: '#000000',
        start_url: '',
        display: 'fullscreen',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,glb,png,woff2,ogg}'],
        navigateFallback: 'index.html',
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
})
