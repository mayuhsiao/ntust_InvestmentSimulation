/**
 * 台股報價資料層
 * ------------------------------------------------------------------
 * 這支模組同時被 Netlify Functions（正式站）與 Vite dev server（本機開發）
 * 匯入使用，所以只能依賴 Node 內建功能（Node 18+ 的全域 fetch）。
 *
 * 資料來源：
 *   1. Yahoo Finance chart API — 一次取回整段區間的日收盤價，
 *      上市用 .TW、上櫃用 .TWO。速度最快，為主要來源。
 *   2. 證交所 STOCK_DAY — 官方逐月「各日成交資訊」，Yahoo 失敗時備援。
 *   3. 證交所 / 櫃買中心 OpenAPI — 全市場代號清單，
 *      用來判斷上市或上櫃、補股票名稱、以及提供最新收盤價。
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const TWSE_LIST_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL'
const TPEX_LIST_URL = 'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'
const TWSE_STOCK_DAY = 'https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY'
const YAHOO_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com']

/** 收盤價往前多抓幾天，讓起始日剛好遇到休市時仍有前一個收盤價可用 */
const LOOKBACK_DAYS = 14

/* ------------------------------------------------------------------ */
/* 共用小工具                                                           */
/* ------------------------------------------------------------------ */

async function getJson(url, { timeout = 15000, headers } = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 'YYYY-MM-DD' -> UTC epoch 秒 */
function dayToEpoch(isoDate) {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000)
}

/** epoch 秒 + 時區位移 -> 當地的 'YYYY-MM-DD' */
function epochToDay(epochSec, gmtOffset = 0) {
  const d = new Date((epochSec + gmtOffset) * 1000)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

function shiftDays(isoDate, days) {
  return epochToDay(dayToEpoch(isoDate) + days * 86400)
}

function todayInTaipei() {
  return epochToDay(Math.floor(Date.now() / 1000), 8 * 3600)
}

/**
 * 台股 13:30 收盤，官方與 Yahoo 約 14:00 前後才會定案。
 * 在這之前「當天」那一筆其實是盤中即時價，不能當成收盤價使用，
 * 否則同一天不同時間下單會成交在不同價格，競賽就不公平了。
 */
function marketClosedInTaipei() {
  const taipei = new Date(Date.now() + 8 * 3600 * 1000)
  return taipei.getUTCHours() >= 14
}

/** 民國日期 '115/09/10' -> '2026-09-10' */
function rocToIso(roc) {
  const m = String(roc).trim().match(/^(\d{2,3})\/(\d{1,2})\/(\d{1,2})$/)
  if (!m) return null
  return `${Number(m[1]) + 1911}-${pad2(m[2])}-${pad2(m[3])}`
}

/** '1150910' -> '2026-09-10' */
function rocCompactToIso(s) {
  const m = String(s).trim().match(/^(\d{3})(\d{2})(\d{2})$/)
  if (!m) return null
  return `${Number(m[1]) + 1911}-${m[2]}-${m[3]}`
}

function toNumber(v) {
  if (v == null) return null
  const n = Number(String(v).replace(/[,\s%]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** 併發上限，避免一次打爆外部 API */
async function mapWithLimit(items, limit, fn) {
  const out = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}

/* ------------------------------------------------------------------ */
/* 全市場代號清單（上市 + 上櫃）                                          */
/* ------------------------------------------------------------------ */

const universeCache = { at: 0, list: null, byCode: null, promise: null }
const UNIVERSE_TTL = 6 * 60 * 60 * 1000 // 6 小時

async function fetchTwseUniverse() {
  const rows = await getJson(TWSE_LIST_URL, { timeout: 20000 })
  return rows
    .filter((r) => r && r.Code && r.Name)
    .map((r) => ({
      code: String(r.Code).trim(),
      name: String(r.Name).trim(),
      market: 'TWSE',
      close: toNumber(r.ClosingPrice),
      date: rocCompactToIso(r.Date),
    }))
}

async function fetchTpexUniverse() {
  const rows = await getJson(TPEX_LIST_URL, { timeout: 25000 })
  return rows
    .filter((r) => r && r.SecuritiesCompanyCode && r.CompanyName)
    .map((r) => ({
      code: String(r.SecuritiesCompanyCode).trim(),
      name: String(r.CompanyName).trim(),
      market: 'TPEX',
      close: toNumber(r.Close),
      date: rocCompactToIso(r.Date),
    }))
}

/**
 * 取得（並快取）全市場代號清單。
 * 兩個來源任一成功就回傳，兩個都掛才丟錯；若記憶體中有舊資料則沿用舊資料。
 */
export async function loadUniverse() {
  const fresh = universeCache.list && Date.now() - universeCache.at < UNIVERSE_TTL
  if (fresh) return universeCache
  if (universeCache.promise) return universeCache.promise

  universeCache.promise = (async () => {
    const [twse, tpex] = await Promise.allSettled([fetchTwseUniverse(), fetchTpexUniverse()])
    const list = []
    if (twse.status === 'fulfilled') list.push(...twse.value)
    if (tpex.status === 'fulfilled') list.push(...tpex.value)

    if (!list.length) {
      if (universeCache.list) return universeCache // 兩邊都失敗 → 沿用舊快取
      throw new Error('無法取得台股代號清單（證交所與櫃買中心皆無回應）')
    }

    list.sort((a, b) => a.code.localeCompare(b.code))
    const byCode = new Map()
    for (const s of list) if (!byCode.has(s.code)) byCode.set(s.code, s)

    universeCache.at = Date.now()
    universeCache.list = list
    universeCache.byCode = byCode
    return universeCache
  })().finally(() => {
    universeCache.promise = null
  })

  return universeCache.promise
}

export async function getStockList() {
  const { list, at } = await loadUniverse()
  return { updatedAt: new Date(at).toISOString(), count: list.length, stocks: list }
}

/**
 * 把使用者輸入的代號轉成 Yahoo 代號。
 *   '2330'     -> { symbol: '2330.TW',  market: 'TWSE' }
 *   '6488'     -> { symbol: '6488.TWO', market: 'TPEX' }
 *   'AAPL'     -> { symbol: 'AAPL',     market: 'US'   }
 *   'TWD=X'    -> 原樣沿用（匯率）
 *   '7709.HK'  -> 原樣沿用（允許直接指定 Yahoo 代號）
 */
export async function resolveSymbol(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase()
  if (!code) throw new Error('缺少股票代號')
  // 匯率與指數等特殊代號（TWD=X、^GSPC）
  if (/[=^]/.test(code)) return { code, symbol: code, market: 'FX', name: '' }
  // 台股代號一定含數字，純英文字母視為美股（BRK-B、BF.B 也支援）
  if (!/\d/.test(code) && /^[A-Z]{1,5}([.-][A-Z]{1,3})?$/.test(code)) {
    return { code, symbol: code, market: 'US', name: '' }
  }
  if (code.includes('.')) return { code: code.split('.')[0], symbol: code, market: 'OTHER', name: '' }

  let entry = null
  try {
    const { byCode } = await loadUniverse()
    entry = byCode?.get(code) || null
  } catch {
    /* 清單抓不到就走下面的猜測邏輯 */
  }
  if (entry) {
    return {
      code,
      symbol: `${code}.${entry.market === 'TPEX' ? 'TWO' : 'TW'}`,
      market: entry.market,
      name: entry.name,
      lastClose: entry.close,
    }
  }
  // 不在清單內（可能是當天無成交或剛上市）：預設當成上市，抓不到時再試上櫃
  return { code, symbol: `${code}.TW`, market: 'TWSE', name: '', fallbackSymbol: `${code}.TWO` }
}

/* ------------------------------------------------------------------ */
/* 來源 1：Yahoo Finance                                                */
/* ------------------------------------------------------------------ */

async function fetchYahoo(symbol, start, end) {
  const period1 = dayToEpoch(shiftDays(start, -LOOKBACK_DAYS))
  const period2 = dayToEpoch(shiftDays(end, 2))
  const qs = `period1=${period1}&period2=${period2}&interval=1d&includePrePost=false&events=div%2Csplit`

  let lastErr = null
  for (const host of YAHOO_HOSTS) {
    try {
      const json = await getJson(`${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${qs}`)
      const result = json?.chart?.result?.[0]
      if (!result) throw new Error(json?.chart?.error?.description || '無資料')

      const meta = result.meta || {}
      const offset = Number(meta.gmtoffset ?? 28800)
      const stamps = result.timestamp || []
      const quote = result.indicators?.quote?.[0] || {}
      const closes = {}
      for (let i = 0; i < stamps.length; i++) {
        const px = quote.close?.[i]
        if (px == null || !Number.isFinite(px)) continue
        closes[epochToDay(stamps[i], offset)] = Math.round(px * 10000) / 10000
      }
      if (!Object.keys(closes).length) throw new Error('回傳區間內沒有收盤價')

      return {
        closes,
        name: meta.longName || meta.shortName || '',
        currency: meta.currency || 'TWD',
        exchangeTz: meta.exchangeTimezoneName || '',
        gmtOffset: offset,
        // 該交易所目前這一盤的起訖時間，用來判斷最後一筆是不是「還沒收盤」
        session: meta.currentTradingPeriod?.regular
          ? { start: Number(meta.currentTradingPeriod.regular.start), end: Number(meta.currentTradingPeriod.regular.end) }
          : null,
        source: 'yahoo',
      }
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr || new Error(`Yahoo 查無 ${symbol}`)
}

/* ------------------------------------------------------------------ */
/* 來源 2：證交所 STOCK_DAY（官方，逐月）                                 */
/* ------------------------------------------------------------------ */

function monthsBetween(start, end) {
  const out = []
  let y = Number(start.slice(0, 4))
  let m = Number(start.slice(5, 7))
  const ey = Number(end.slice(0, 4))
  const em = Number(end.slice(5, 7))
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}${pad2(m)}01`)
    if (++m > 12) {
      m = 1
      y++
    }
    if (out.length > 36) break // 保險絲
  }
  return out
}

async function fetchTwseOfficial(stockNo, start, end) {
  const months = monthsBetween(shiftDays(start, -LOOKBACK_DAYS), end)
  const closes = {}
  let name = ''

  const pages = await mapWithLimit(months, 3, async (ym) => {
    try {
      return await getJson(`${TWSE_STOCK_DAY}?date=${ym}&stockNo=${stockNo}&response=json`, {
        timeout: 20000,
      })
    } catch {
      return null
    }
  })

  for (const page of pages) {
    if (!page || page.stat !== 'OK' || !Array.isArray(page.data)) continue
    if (!name && page.title) {
      // '114年09月 2330 台積電 各日成交資訊'
      const m = String(page.title).match(/\d+\s+(\S+)\s+各日成交資訊/)
      if (m) name = m[1]
    }
    const idx = (page.fields || []).indexOf('收盤價')
    const closeIdx = idx >= 0 ? idx : 6
    for (const row of page.data) {
      const iso = rocToIso(row[0])
      const px = toNumber(row[closeIdx])
      if (iso && px != null) closes[iso] = px
    }
  }

  if (!Object.keys(closes).length) throw new Error(`證交所查無 ${stockNo} 的日收盤價`)
  return { closes, name, currency: 'TWD', source: 'twse' }
}

/* ------------------------------------------------------------------ */
/* 對外：取單一檔股票的日收盤價                                           */
/* ------------------------------------------------------------------ */

/** 收盤後還要等資料定案的緩衝（台股 13:30 收盤、約 14:00 定案） */
const SETTLE_BUFFER_SEC = 30 * 60

/**
 * 把「該盤還沒收完」的那一筆從收盤價中移除，改放到 intraday。
 *
 * 以 Yahoo 回報的該交易所目前盤別（currentTradingPeriod.regular）判斷，
 * 所以台股、美股、其他市場都適用，不必自己維護各地收盤時間。
 * 取不到盤別資訊時（例如證交所備援來源）退回台股 14:00 的判斷。
 *
 * @returns {{date:string, price:number}|null} 被移除的那一筆
 */
function withholdUnsettledBar(closes, data) {
  const nowSec = Math.floor(Date.now() / 1000)

  if (data.session?.end) {
    // 盤別尚未結束（含定案緩衝）→ 該盤當天的那一筆還不算數
    if (nowSec < data.session.end + SETTLE_BUFFER_SEC) {
      const sessionDay = epochToDay(data.session.start, data.gmtOffset || 0)
      if (closes[sessionDay] != null) {
        const price = closes[sessionDay]
        delete closes[sessionDay]
        return { date: sessionDay, price }
      }
    }
    return null
  }

  const today = todayInTaipei()
  if (closes[today] != null && !marketClosedInTaipei()) {
    const price = closes[today]
    delete closes[today]
    return { date: today, price }
  }
  return null
}

export async function getDailyCloses({ code, start, end }) {
  const resolved = await resolveSymbol(code)
  const errors = []

  const attempts = [
    () => fetchYahoo(resolved.symbol, start, end),
    resolved.fallbackSymbol ? () => fetchYahoo(resolved.fallbackSymbol, start, end) : null,
    resolved.market !== 'OTHER' ? () => fetchTwseOfficial(resolved.code, start, end) : null,
  ].filter(Boolean)

  for (const attempt of attempts) {
    try {
      const data = await attempt()
      // 只留下 [start-lookback, end] 範圍內的資料
      const lower = shiftDays(start, -LOOKBACK_DAYS)
      const closes = {}
      for (const [d, px] of Object.entries(data.closes)) {
        if (d >= lower && d <= end) closes[d] = px
      }

      // 尚未收盤的那一筆不列入收盤價，另外放在 intraday 供參考
      const intraday = withholdUnsettledBar(closes, data)

      const dates = Object.keys(closes).sort()
      return {
        code: resolved.code,
        symbol: resolved.symbol,
        market: resolved.market,
        name: resolved.name || data.name || '',
        currency: data.currency || 'TWD',
        source: data.source,
        closes,
        intraday,
        marketOpen: Boolean(intraday),
        firstDate: dates[0] || null,
        lastDate: dates[dates.length - 1] || null,
        lastClose: dates.length ? closes[dates[dates.length - 1]] : null,
      }
    } catch (err) {
      errors.push(err.message)
    }
  }

  // 詳細原因留在伺服器日誌，畫面上只給使用者看得懂的說明
  console.warn(`[報價] ${resolved.code} 取得失敗：${errors.join('；')}`)
  const looksChinese = /[一-鿿]/.test(resolved.code)
  const e = new Error(
    looksChinese
      ? `「${resolved.code}」不是股票代號。請在搜尋框輸入後，從下拉選單點選要交易的股票。`
      : `查無代號 ${resolved.code} 的收盤價，請確認代號是否正確（台股為數字代號，美股為英文代號）。`,
  )
  e.statusCode = 404
  throw e
}

/** 一次取多檔（給排行榜／重算淨值用） */
export async function getDailyClosesBatch({ codes, start, end }) {
  const unique = [...new Set(codes.map((c) => String(c).trim().toUpperCase()).filter(Boolean))]
  if (unique.length > 120) {
    const e = new Error('一次最多查詢 120 檔股票')
    e.statusCode = 400
    throw e
  }

  const rows = await mapWithLimit(unique, 6, async (code) => {
    try {
      return await getDailyCloses({ code, start, end })
    } catch (err) {
      return { code, error: err.message, closes: {} }
    }
  })

  const results = {}
  const calendar = new Set()
  for (const r of rows) {
    results[r.code] = r
    for (const d of Object.keys(r.closes || {})) if (d >= start) calendar.add(d)
  }

  return {
    start,
    end,
    today: todayInTaipei(),
    marketClosed: marketClosedInTaipei(),
    calendar: [...calendar].sort(),
    results,
  }
}

/* ------------------------------------------------------------------ */
/* 美股代號搜尋                                                          */
/* ------------------------------------------------------------------ */

/**
 * 代號搜尋：台股查伺服器端快取的全市場清單，美股即時問 Yahoo。
 *
 * 台股也在伺服器搜尋一次是刻意的 —— 手機或網路不佳時，
 * 前端那份 12,000 筆的清單可能還沒下載完，
 * 這時仍然要能用「台積電」這種中文名稱找到股票。
 */
export async function searchGlobal(keyword) {
  const q = String(keyword || '').trim()
  if (!q) return { query: q, results: [] }

  const [tw, us] = await Promise.all([searchTaiwan(q), searchYahoo(q)])
  const seen = new Set()
  const results = []
  for (const row of [...tw, ...us]) {
    if (seen.has(row.code)) continue
    seen.add(row.code)
    results.push(row)
  }
  return { query: q, results: results.slice(0, 16) }
}

/** 台股：代號完全相符 → 代號開頭相符 → 名稱包含 */
async function searchTaiwan(q) {
  let list = []
  try {
    list = (await loadUniverse()).list || []
  } catch {
    return []
  }
  const key = q.toUpperCase()
  const exact = []
  const byCode = []
  const byName = []
  for (const s of list) {
    if (s.code === key) exact.push(s)
    else if (s.code.startsWith(key)) byCode.push(s)
    else if (s.name.includes(q)) byName.push(s)
    if (exact.length + byCode.length + byName.length >= 30) break
  }
  return [...exact, ...byCode, ...byName].slice(0, 10).map((s) => ({
    code: s.code,
    name: s.name,
    market: s.market,
    exchange: s.market === 'TPEX' ? '上櫃' : '上市',
    close: s.close,
    type: 'EQUITY',
  }))
}

/** 美股：中文查詢沒有意義，直接略過 */
async function searchYahoo(q) {
  if (/[一-鿿]/.test(q) || /^\d+$/.test(q)) return []

  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}` +
    '&quotesCount=12&newsCount=0&enableFuzzyQuery=false&quotesQueryId=tss_match_phrase_query'

  let quotes = []
  try {
    const json = await getJson(url, { timeout: 12000 })
    quotes = json?.quotes || []
  } catch {
    return []
  }

  const ALLOWED = new Set(['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX'])
  const US_EXCHANGES = /NASDAQ|NYSE|NYSEArca|BATS|AMEX|NMS|NGM|PCX/i

  return quotes
    .filter((x) => x.symbol && ALLOWED.has(x.quoteType))
    // 只留美國本土掛牌，避免出現一堆維也納、多倫多的重複掛牌
    .filter((x) => US_EXCHANGES.test(String(x.exchDisp || x.exchange || '')))
    .map((x) => ({
      code: x.symbol,
      name: x.shortname || x.longname || x.symbol,
      market: 'US',
      exchange: x.exchDisp || x.exchange || '',
      type: x.quoteType,
    }))
}

export { todayInTaipei, marketClosedInTaipei }
