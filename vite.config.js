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

/** 每次建置的版本號，前端比對 /version.json 就知道網站已經更新 */
const BUILD_ID = Date.now().toString(36)

/** 建置時輸出 version.json（見 src/lib/version.js） */
function versionFilePlugin() {
  return {
    name: 'ntust-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
  }
}

export default defineConfig({
  plugins: [react(), devApiPlugin(), versionFilePlugin()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
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
