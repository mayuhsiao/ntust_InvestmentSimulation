/**
 * 共用 API 路由
 * ------------------------------------------------------------------
 * Netlify Functions 與 Vite dev server 都呼叫 handleApi()，
 * 確保本機開發與線上行為完全一致。
 */

import {
  getStockList,
  getDailyCloses,
  getDailyClosesBatch,
  searchGlobal,
  todayInTaipei,
  marketClosedInTaipei,
} from './twstock.mjs'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function bad(message, status = 400) {
  const e = new Error(message)
  e.statusCode = status
  return e
}

function readRange(params) {
  const today = todayInTaipei()
  const start = params.get('start') || today
  const end = params.get('end') || today
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) throw bad('start / end 需為 YYYY-MM-DD 格式')
  if (start > end) throw bad('start 不可晚於 end')
  return { start, end }
}

/**
 * @param {string} pathname 例如 '/api/stock-price'
 * @param {URLSearchParams} params
 * @returns {Promise<{status:number, body:object, cache:string}>}
 */
export async function handleApi(pathname, params) {
  const route = pathname.replace(/^.*\/(api|functions)\//, '').replace(/^\/+|\/+$/g, '')

  try {
    switch (route) {
      case 'health':
        return { status: 200, cache: 'no-store', body: { ok: true, today: todayInTaipei() } }

      case 'stock-list': {
        const data = await getStockList()
        // 全市場清單一天只變一次，讓 CDN 快取 30 分鐘
        return { status: 200, cache: 'public, max-age=600, s-maxage=1800', body: data }
      }

      case 'stock-search': {
        const q = params.get('q')
        if (!q) throw bad('請提供 q 參數')
        const data = await searchGlobal(q)
        return { status: 200, cache: 'public, max-age=3600, s-maxage=86400', body: data }
      }

      case 'stock-price': {
        const { start, end } = readRange(params)
        const codesParam = params.get('codes')
        const today = todayInTaipei()
        // 查詢區間已經結束 → 資料不會再變，可以放心長快取
        const cache =
          end < today
            ? 'public, max-age=3600, s-maxage=86400'
            : 'public, max-age=180, s-maxage=300'

        if (codesParam) {
          const codes = codesParam.split(',').map((c) => c.trim()).filter(Boolean)
          if (!codes.length) throw bad('codes 不可為空')
          const data = await getDailyClosesBatch({ codes, start, end })
          return { status: 200, cache, body: data }
        }

        const code = params.get('code')
        if (!code) throw bad('請提供 code 或 codes 參數')
        const data = await getDailyCloses({ code, start, end })
        return {
          status: 200,
          cache,
          body: { ...data, today, marketClosed: marketClosedInTaipei() },
        }
      }

      default:
        return { status: 404, cache: 'no-store', body: { error: `未知的 API 路徑：${route}` } }
    }
  } catch (err) {
    const status = err.statusCode || 502
    return { status, cache: 'no-store', body: { error: err.message || '伺服器錯誤' } }
  }
}

/** 包成標準 Response（Netlify Functions v2 / Vite dev 都能用） */
export async function handleApiRequest(request) {
  const url = new URL(request.url)
  const { status, body, cache } = await handleApi(url.pathname, url.searchParams)
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cache,
      'Access-Control-Allow-Origin': '*',
    },
  })
}
