/**
 * 報價服務（前端）
 * ------------------------------------------------------------------
 * 呼叫 /api/*（Netlify Function 或 Vite dev middleware），
 * 並在瀏覽器端快取全市場代號清單，減少重複下載。
 */

const API = '/api'
const LIST_KEY = 'ntust-invest:stocklist'
const LIST_TTL = 6 * 60 * 60 * 1000 // 6 小時

let listMemo = null

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  let body = null
  try {
    body = await res.json()
  } catch {
    throw new Error(`報價服務回應異常（HTTP ${res.status}）`)
  }
  if (!res.ok) throw new Error(body?.error || `報價服務錯誤（HTTP ${res.status}）`)
  return body
}

/* ---------------- 全市場代號清單 ---------------- */

function packList(stocks) {
  return stocks.map((s) => `${s.code}\t${s.name}\t${s.market}\t${s.close ?? ''}`).join('\n')
}

function unpackList(text) {
  return text
    .split('\n')
    .map((line) => {
      const [code, name, market, close] = line.split('\t')
      if (!code) return null
      return { code, name, market, close: close === '' ? null : Number(close) }
    })
    .filter(Boolean)
}

/** 上市 + 上櫃全部代號（含最新收盤價） */
export async function loadStockList({ force = false } = {}) {
  if (listMemo && !force) return listMemo

  if (!force) {
    try {
      const raw = localStorage.getItem(LIST_KEY)
      if (raw) {
        const { at, data } = JSON.parse(raw)
        if (Date.now() - at < LIST_TTL) {
          listMemo = unpackList(data)
          return listMemo
        }
      }
    } catch {
      /* 快取壞掉就重抓 */
    }
  }

  const body = await getJson(`${API}/stock-list`)
  listMemo = body.stocks || []
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify({ at: Date.now(), data: packList(listMemo) }))
  } catch {
    /* 容量不足就不快取，不影響功能 */
  }
  return listMemo
}

/** 代號或名稱模糊搜尋，代號完全符合的排最前面 */
export function searchStocks(list, keyword, limit = 20) {
  const q = String(keyword || '').trim().toUpperCase()
  if (!q) return []
  const exact = []
  const byCode = []
  const byName = []
  for (const s of list) {
    if (s.code === q) exact.push(s)
    else if (s.code.startsWith(q)) byCode.push(s)
    else if (s.name.includes(q)) byName.push(s)
    if (exact.length + byCode.length + byName.length >= limit * 3) break
  }
  return [...exact, ...byCode, ...byName].slice(0, limit)
}

export function findStock(list, code) {
  const c = String(code || '').trim().toUpperCase()
  return list.find((s) => s.code === c) || null
}

/* ---------------- 日收盤價 ---------------- */

/**
 * 取多檔股票在 [start, end] 的日收盤價。
 * @returns {Promise<{results:Object, calendar:string[], today:string}>}
 */
export async function fetchCloses(codes, start, end) {
  const unique = [...new Set(codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
  if (!unique.length) return { results: {}, calendar: [], today: '' }

  const chunks = []
  for (let i = 0; i < unique.length; i += 40) chunks.push(unique.slice(i, i + 40))

  const results = {}
  const calendar = new Set()
  let today = ''

  for (const chunk of chunks) {
    const qs = new URLSearchParams({ codes: chunk.join(','), start, end })
    const body = await getJson(`${API}/stock-price?${qs}`)
    Object.assign(results, body.results || {})
    for (const d of body.calendar || []) calendar.add(d)
    today = body.today || today
  }

  return { results, calendar: [...calendar].sort(), today }
}

/** 單檔查詢（下單頁即時帶出收盤價用） */
export async function fetchQuote(code, start, end) {
  const qs = new URLSearchParams({ code, start, end })
  return getJson(`${API}/stock-price?${qs}`)
}
