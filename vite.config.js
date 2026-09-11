import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { handleApi } from './server/api.mjs'

/**
 * 本機開發時直接在 dev server 內掛上 /api/*，
 * 行為與 Netlify Functions 相同，所以 `npm run dev` 就能完整測試，
 * 不必另外安裝 netlify-cli。
 */
function devApiPlugin() {
  return {
    name: 'ntust-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url || !req.url.startsWith('/api/')) return next()
        const url = new URL(req.url, 'http://localhost')
        const started = Date.now()
        try {
          const { status, body } = await handleApi(url.pathname, url.searchParams)
          const payload = JSON.stringify(body)
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(payload)
          server.config.logger.info(
            `  api  ${url.pathname}${url.search} → ${status} (${Date.now() - started}ms)`,
          )
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ error: err.message }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  server: { port: 5173, open: false },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // firebase SDK 是延遲載入的獨立 chunk，不需要為它跳警告
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
  },
})
