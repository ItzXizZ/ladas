import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // data/ and tools/ change constantly during renders; never reload the app for them.
    watch: { ignored: ['**/data/**', '**/tools/**'] },
  },
})
