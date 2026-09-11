import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { backend } from '../services/backend.js'
import { DEFAULT_CONFIG } from '../services/defaults.js'
import { loadStockList, fetchCloses } from '../services/prices.js'
import { makePriceLookup, buildCalendar, rankAll, rankGroups, snapshot, navSeries } from '../lib/portfolio.js'
import { isAdminId } from '../firebase.js'

const AppContext = createContext(null)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp 必須在 AppProvider 內使用')
  return ctx
}

const todayISO = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000) // 以台北時間為準
  return d.toISOString().slice(0, 10)
}

/**
 * 報價查詢的結束日：不超過今天、也不超過結算日。
 * 競賽尚未開始時會等於起始日，避免出現 start > end 的無效區間。
 */
function rangeEnd(config, today = todayISO()) {
  const capped = today < config.endDate ? today : config.endDate
  return capped < config.startDate ? config.startDate : capped
}

/** 台股 13:30 收盤、約 14:00 定案；與 server/twstock.mjs 的判斷一致 */
function marketClosedNow() {
  return new Date(Date.now() + 8 * 3600 * 1000).getUTCHours() >= 14
}

export function AppProvider({ children }) {
  const [authId, setAuthId] = useState(undefined) // undefined = 尚在判斷
  const [booting, setBooting] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  const [config, setConfigState] = useState(DEFAULT_CONFIG)
  const [students, setStudents] = useState([])
  const [trades, setTrades] = useState([])
  const [prices, setPrices] = useState({})
  const [stockList, setStockList] = useState([])
  const [settlements, setSettlements] = useState([])
  const [priceSyncing, setPriceSyncing] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  // 用 ref 讀取最新值，避免非同步流程抓到過期的 closure
  const pricesRef = useRef(prices)
  pricesRef.current = prices
  const configRef = useRef(config)
  configRef.current = config
  const tradesRef = useRef(trades)
  tradesRef.current = trades
  // 查不到報價的代號（例如打錯或已下市），記下來避免無限重試
  const failedCodesRef = useRef(new Set())

  const notify = useCallback((message, kind = 'info') => {
    setToast({ message, kind, at: Date.now() })
    window.clearTimeout(notify._t)
    notify._t = window.setTimeout(() => setToast(null), 4200)
  }, [])

  /* ---------------- 登入狀態 ---------------- */
  useEffect(() => backend.onAuthChange((id) => setAuthId(id)), [])

  /* ---------------- 載入資料 ---------------- */
  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [cfg, studentList, tradeList, priceCache] = await Promise.all([
        backend.loadConfig(),
        backend.loadStudents(),
        backend.loadTrades(),
        backend.loadPrices(),
      ])
      setConfigState({ ...DEFAULT_CONFIG, ...cfg })
      setStudents(studentList)
      setTrades(tradeList)
      setPrices(priceCache)
      return { cfg: { ...DEFAULT_CONFIG, ...cfg }, tradeList, priceCache }
    } catch (err) {
      console.error(err)
      setError(err.message || '資料載入失敗')
      throw err
    } finally {
      setLoading(false)
      setBooting(false)
    }
  }, [])

  useEffect(() => {
    if (authId === undefined) return
    if (!authId) {
      setBooting(false)
      return
    }
    loadAll()
      .then(({ cfg, tradeList, priceCache }) => syncPrices({ cfg, tradeList, priceCache }))
      .catch(() => {})
    loadStockList()
      .then(setStockList)
      .catch((err) => console.warn('代號清單載入失敗', err.message))
    backend.loadSettlements().then(setSettlements).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authId])

  /* ---------------- 報價同步 ---------------- */
  /**
   * 每筆快取都記錄它實際涵蓋的區間 [from, to]，
   * 只要競賽區間往前或往後延伸就會重抓，避免「改了起始日卻補不到前段資料」。
   * 寫入一律使用 setPrices(prev => …)，多個同步同時完成也不會互相覆蓋。
   */
  const syncPrices = useCallback(
    async ({ cfg, tradeList, priceCache, force = false, extraCodes = [] } = {}) => {
      const conf = cfg || configRef.current
      const list = tradeList || tradesRef.current
      // 剛載入完成時 ref 還沒更新，允許呼叫端直接把剛讀到的快取傳進來
      const cache = priceCache || pricesRef.current

      const up = (c) => String(c).trim().toUpperCase()
      const codes = new Set([up(conf.benchmark || '0050'), ...extraCodes.map(up)])
      for (const t of list) if (t.code) codes.add(up(t.code))

      const start = conf.startDate
      const end = rangeEnd(conf)

      if (force) failedCodesRef.current.clear()

      const stale = [...codes].filter((code) => {
        if (force) return true
        if (failedCodesRef.current.has(code)) return false
        const entry = cache[code]
        if (!entry?.closes || !Object.keys(entry.closes).length) return true
        if (!entry.from || !entry.to) return true // 舊版快取沒有區間資訊，重抓一次
        if (entry.from > start || entry.to < end) return true
        // 盤中抓的資料少了「今日收盤價」，收盤後要再補一次
        return Boolean(entry.pending) && marketClosedNow()
      })

      if (!stale.length) {
        setLastSync(new Date())
        return
      }

      setPriceSyncing(true)
      try {
        const { results } = await fetchCloses(stale, start, end)
        const fetched = {}
        for (const [code, data] of Object.entries(results)) {
          if (data.error || !data.closes || !Object.keys(data.closes).length) {
            failedCodesRef.current.add(code)
            console.warn(`[報價] ${code}: ${data.error || '無資料'}`)
            continue
          }
          failedCodesRef.current.delete(code)
          fetched[code] = {
            code,
            name: data.name || '',
            market: data.market || '',
            closes: data.closes,
            from: start,
            to: end,
            // server 因為尚未收盤而保留了今日報價 → 收盤後需要再抓一次
            pending: Boolean(data.intraday),
            intradayDate: data.intraday?.date || null,
          }
        }

        if (Object.keys(fetched).length) {
          const persist = {}
          setPrices((prev) => {
            const next = { ...prev }
            for (const [code, data] of Object.entries(fetched)) {
              const old = prev[code]
              const closes = { ...(old?.closes || {}), ...data.closes }
              // 之前在盤中抓到的當日即時價要清掉，不能混進收盤價
              if (data.intradayDate) delete closes[data.intradayDate]
              const entry = {
                ...data,
                name: data.name || old?.name || '',
                market: data.market || old?.market || '',
                closes,
                from: old?.from && old.from < data.from ? old.from : data.from,
                to: old?.to && old.to > data.to ? old.to : data.to,
                pending: old?.to > data.to ? Boolean(old.pending) : data.pending,
              }
              next[code] = entry
              persist[code] = entry
            }
            return next
          })
          backend.savePrices(persist).catch((err) => console.warn('報價快取寫入失敗', err.message))
        }
        setLastSync(new Date())
      } catch (err) {
        console.error(err)
        notify(`報價更新失敗：${err.message}`, 'error')
      } finally {
        setPriceSyncing(false)
      }
    },
    [notify],
  )

  /** 有交易的股票若還沒有報價，自動補抓（單筆下單與批次匯入都適用） */
  useEffect(() => {
    if (!authId || !trades.length) return
    const missing = [...new Set(trades.map((t) => String(t.code).toUpperCase()))].filter(
      (code) => code && !prices[code] && !failedCodesRef.current.has(code),
    )
    if (!missing.length) return
    const timer = setTimeout(() => syncPrices({ extraCodes: missing }), 400)
    return () => clearTimeout(timer)
  }, [trades, prices, authId, syncPrices])

  /* ---------------- 衍生資料 ---------------- */
  const me = useMemo(
    () => students.find((s) => s.studentId === authId) || null,
    [students, authId],
  )

  const isAdmin = useMemo(
    () => Boolean(authId) && (isAdminId(authId) || me?.role === 'admin'),
    [authId, me],
  )

  const lookup = useMemo(() => makePriceLookup(prices), [prices])

  const today = todayISO()
  const effectiveEnd = rangeEnd(config, today)
  const notStarted = today < config.startDate
  const ended = today > config.endDate

  const calendar = useMemo(
    () => buildCalendar(prices, config.startDate, effectiveEnd, [config.benchmark || '0050', '2330', '0056']),
    [prices, config.startDate, effectiveEnd, config.benchmark],
  )

  const lastTradingDay = calendar[calendar.length - 1] || effectiveEnd

  const tradesByStudent = useMemo(() => {
    const map = {}
    for (const t of trades) {
      ;(map[t.studentId] ||= []).push(t)
    }
    return map
  }, [trades])

  const myTrades = useMemo(() => (authId ? tradesByStudent[authId] || [] : []), [tradesByStudent, authId])

  const myCapital = Number(me?.initialCapital) || Number(config.initialCapital) || 0

  const mySnapshot = useMemo(
    () => snapshot(myTrades, lookup, lastTradingDay, myCapital),
    [myTrades, lookup, lastTradingDay, myCapital],
  )

  const myNav = useMemo(
    () => navSeries(myTrades, lookup, calendar, myCapital),
    [myTrades, lookup, calendar, myCapital],
  )

  const competitors = useMemo(
    () => students.filter((s) => s.role !== 'admin'),
    [students],
  )

  const ranking = useMemo(() => {
    if (!competitors.length || !calendar.length) return []
    return rankAll({
      students: competitors,
      tradesByStudent,
      lookup,
      calendar,
      initialCapital: config.initialCapital,
      asOf: lastTradingDay,
    })
  }, [competitors, tradesByStudent, lookup, calendar, config.initialCapital, lastTradingDay])

  const groupRanking = useMemo(() => rankGroups(ranking), [ranking])

  const myRank = useMemo(() => ranking.find((r) => r.studentId === authId) || null, [ranking, authId])

  const benchmarkSeries = useMemo(() => {
    const entry = prices[config.benchmark || '0050']
    if (!entry?.closes || !calendar.length) return []
    const base = lookup.at(config.benchmark || '0050', calendar[0])
    if (!base) return []
    return calendar.map((d) => {
      const px = lookup.at(config.benchmark || '0050', d)
      return { date: d, returnPct: px != null ? px / base - 1 : 0 }
    })
  }, [prices, calendar, lookup, config.benchmark])

  /* ---------------- 操作 ---------------- */
  const actions = useMemo(
    () => ({
      async signIn(id, password) {
        const result = await backend.signIn(id, password)
        notify('登入成功', 'success')
        return result
      },
      async activate(id, password, extra) {
        const result = await backend.activate(id, password, extra)
        notify('帳號啟用成功', 'success')
        return result
      },
      async signOut() {
        await backend.signOut()
        setTrades([])
        setStudents([])
        setAuthId(null)
      },
      async changePassword(oldPw, newPw) {
        await backend.changePassword(authId, oldPw, newPw)
        notify('密碼已更新', 'success')
      },
      async saveConfig(patch) {
        const next = await backend.saveConfig(patch)
        const merged = { ...DEFAULT_CONFIG, ...next }
        setConfigState(merged)
        notify('設定已儲存', 'success')
        // 競賽區間可能改變，重新確認報價涵蓋範圍
        syncPrices({ cfg: merged })
        return next
      },
      async saveStudents(list) {
        const next = await backend.saveStudents(list)
        setStudents(next)
        notify(`已匯入／更新 ${list.length} 位學生`, 'success')
        return next
      },
      async removeStudent(id) {
        await backend.removeStudent(id)
        setStudents((prev) => prev.filter((s) => s.studentId !== id))
        setTrades((prev) => prev.filter((t) => t.studentId !== id))
        notify('已刪除學生與其交易紀錄', 'success')
      },
      // 新股票的報價由上面的 useEffect 自動補抓，這裡不必再觸發
      async addTrade(trade) {
        const saved = await backend.addTrade(trade)
        setTrades((prev) => [...prev, saved])
        return saved
      },
      async removeTrade(id) {
        await backend.removeTrade(id)
        setTrades((prev) => prev.filter((t) => t.id !== id))
        notify('已刪除該筆交易', 'success')
      },
      async saveSettlements(rows) {
        const next = await backend.saveSettlements(rows)
        setSettlements((prev) => {
          const byDate = new Map(prev.map((r) => [r.date, r]))
          for (const r of next) byDate.set(r.date, r)
          return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
        })
        return next
      },
      refresh: () => loadAll().then(({ cfg, tradeList, priceCache }) => syncPrices({ cfg, tradeList, priceCache })),
      refreshPrices: (opts) => syncPrices({ force: true, ...opts }),
      reloadStockList: () => loadStockList({ force: true }).then(setStockList),
      notify,
    }),
    [authId, notify, loadAll, syncPrices],
  )

  const value = {
    // 狀態
    mode: backend.mode,
    booting,
    loading,
    error,
    toast,
    authId,
    me,
    isAdmin,
    config,
    students,
    competitors,
    trades,
    myTrades,
    prices,
    stockList,
    settlements,
    priceSyncing,
    lastSync,
    // 衍生
    lookup,
    calendar,
    today,
    effectiveEnd,
    notStarted,
    ended,
    lastTradingDay,
    tradesByStudent,
    mySnapshot,
    myNav,
    myCapital,
    ranking,
    groupRanking,
    myRank,
    benchmarkSeries,
    // 操作
    ...actions,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
