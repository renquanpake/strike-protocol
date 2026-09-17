import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    allowedHosts: ['.monkeycode-ai.online'],
  },
  preview: {
    port: 3000,
  },
})
