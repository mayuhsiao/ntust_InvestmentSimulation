/**
 * 投資組合計算（純函式，方便單獨驗證）
 * ------------------------------------------------------------------
 * 交易紀錄格式：
 *   { id, studentId, date:'YYYY-MM-DD', side:'BUY'|'SELL',
 *     code, name, market, shares, price, gross, fee, tax, net, createdAt }
 *   net：買進為實際扣款（含手續費），賣出為實際入帳（已扣費稅）
 */

export function sortTrades(trades) {
  return [...trades].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    const ca = toMillis(a.createdAt)
    const cb = toMillis(b.createdAt)
    if (ca !== cb) return ca - cb
    return String(a.id).localeCompare(String(b.id))
  })
}

function toMillis(v) {
  if (!v) return 0
  if (typeof v === 'number') return v
  if (v?.toMillis) return v.toMillis()
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

/**
 * 依序重播交易，得到現金、持股與已實現損益。
 * 平均成本採「含手續費」的移動平均。
 */
export function replay(trades, initialCapital) {
  let cash = Number(initialCapital) || 0
  let realized = 0
  let feesPaid = 0
  let taxPaid = 0
  let turnover = 0
  const positions = new Map()

  for (const t of sortTrades(trades)) {
    const shares = Number(t.shares) || 0
    if (shares <= 0) continue
    const key = t.code
    const p = positions.get(key) || { code: key, name: t.name || '', market: t.market || '', shares: 0, cost: 0 }
    if (!p.name && t.name) p.name = t.name

    if (t.side === 'SELL') {
      const sellable = Math.min(shares, p.shares)
      const avg = p.shares > 0 ? p.cost / p.shares : 0
      const costOut = avg * sellable
      cash += Number(t.net) || 0
      realized += (Number(t.net) || 0) - costOut
      p.shares = Math.max(0, p.shares - shares)
      p.cost = p.shares === 0 ? 0 : Math.max(0, p.cost - costOut)
    } else {
      cash -= Number(t.net) || 0
      p.shares += shares
      p.cost += Number(t.net) || 0
    }

    feesPaid += Number(t.fee) || 0
    taxPaid += Number(t.tax) || 0
    turnover += Number(t.gross) || 0
    positions.set(key, p)
  }

  return { cash, positions, realized, feesPaid, taxPaid, turnover }
}

/**
 * 收盤價查詢器：取「小於等於指定日期」的最近一筆收盤價，
 * 這樣遇到停牌或該股尚未有當日報價時仍能合理估值。
 */
export function makePriceLookup(priceMap) {
  const sortedDates = new Map()

  function datesOf(code) {
    if (!sortedDates.has(code)) {
      const closes = priceMap?.[code]?.closes || {}
      sortedDates.set(code, Object.keys(closes).sort())
    }
    return sortedDates.get(code)
  }

  return {
    has: (code) => Boolean(priceMap?.[code]),
    name: (code) => priceMap?.[code]?.name || '',
    market: (code) => priceMap?.[code]?.market || '',
    latest(code) {
      const d = datesOf(code)
      return d.length ? priceMap[code].closes[d[d.length - 1]] : null
    },
    latestDate(code) {
      const d = datesOf(code)
      return d.length ? d[d.length - 1] : null
    },
    /** 指定日期的收盤價（找不到則往前找最近一個交易日） */
    at(code, date) {
      const entry = priceMap?.[code]
      if (!entry) return null
      const closes = entry.closes || {}
      if (closes[date] != null) return closes[date]
      const dates = datesOf(code)
      let lo = 0
      let hi = dates.length - 1
      let best = null
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (dates[mid] <= date) {
          best = dates[mid]
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      return best ? closes[best] : null
    },
  }
}

/** 某一天收盤後的完整資產快照 */
export function snapshot(trades, lookup, asOf, initialCapital) {
  const inRange = trades.filter((t) => t.date <= asOf)
  const state = replay(inRange, initialCapital)

  const holdings = []
  for (const p of state.positions.values()) {
    if (p.shares <= 0) continue
    const close = lookup.at(p.code, asOf)
    const avgCost = p.cost / p.shares
    // 尚未有報價時暫以成本計價，避免資產憑空消失
    const marketValue = close != null ? close * p.shares : p.cost
    holdings.push({
      code: p.code,
      name: p.name || lookup.name(p.code) || p.code,
      market: p.market || lookup.market(p.code),
      shares: p.shares,
      avgCost,
      cost: p.cost,
      price: close,
      priceDate: close != null ? asOf : null,
      marketValue,
      unrealized: marketValue - p.cost,
      returnPct: p.cost > 0 ? (marketValue - p.cost) / p.cost : 0,
      weight: 0,
    })
  }

  holdings.sort((a, b) => b.marketValue - a.marketValue)
  const marketValue = holdings.reduce((s, h) => s + h.marketValue, 0)
  const total = state.cash + marketValue
  for (const h of holdings) h.weight = total > 0 ? h.marketValue / total : 0

  const capital = Number(initialCapital) || 0
  return {
    asOf,
    cash: state.cash,
    marketValue,
    total,
    initialCapital: capital,
    profit: total - capital,
    returnPct: capital > 0 ? (total - capital) / capital : 0,
    realized: state.realized,
    unrealized: holdings.reduce((s, h) => s + h.unrealized, 0),
    feesPaid: state.feesPaid,
    taxPaid: state.taxPaid,
    turnover: state.turnover,
    tradeCount: inRange.length,
    holdings,
  }
}

/**
 * 每日結算：走訪競賽期間每個交易日，用當日收盤價計算淨值。
 * calendar 為交易日陣列（由指標成分股的報價日期推得）。
 */
export function navSeries(trades, lookup, calendar, initialCapital) {
  const ordered = sortTrades(trades)
  const capital = Number(initialCapital) || 0
  const out = []
  let cursor = 0
  let cash = capital
  const positions = new Map()

  for (const date of calendar) {
    while (cursor < ordered.length && ordered[cursor].date <= date) {
      const t = ordered[cursor++]
      const shares = Number(t.shares) || 0
      if (shares <= 0) continue
      const p = positions.get(t.code) || { shares: 0, cost: 0 }
      if (t.side === 'SELL') {
        const avg = p.shares > 0 ? p.cost / p.shares : 0
        const sellable = Math.min(shares, p.shares)
        cash += Number(t.net) || 0
        p.shares = Math.max(0, p.shares - shares)
        p.cost = p.shares === 0 ? 0 : Math.max(0, p.cost - avg * sellable)
      } else {
        cash -= Number(t.net) || 0
        p.shares += shares
        p.cost += Number(t.net) || 0
      }
      positions.set(t.code, p)
    }

    let marketValue = 0
    for (const [code, p] of positions) {
      if (p.shares <= 0) continue
      const close = lookup.at(code, date)
      marketValue += close != null ? close * p.shares : p.cost
    }

    const total = cash + marketValue
    out.push({
      date,
      cash,
      marketValue,
      total,
      returnPct: capital > 0 ? (total - capital) / capital : 0,
    })
  }

  return out
}

/**
 * 交易日曆
 * 取所有已快取股票的報價日期「聯集」，而不是單押某一檔指標股。
 * 資料來源偶爾會漏掉個股某一天（例如 ETF 除息日），
 * 用聯集就不會因為一檔缺資料而讓全班的結算日整個往前退。
 */
export function buildCalendar(priceMap, start, end, benchmarks = ['0050', '2330']) {
  const all = new Set()
  for (const entry of Object.values(priceMap || {})) {
    for (const d of Object.keys(entry?.closes || {})) if (d >= start && d <= end) all.add(d)
  }
  if (all.size) return [...all].sort()

  // 完全沒有快取時，退回指標股
  for (const code of benchmarks) {
    const closes = priceMap?.[code]?.closes
    if (!closes) continue
    const days = Object.keys(closes).filter((d) => d >= start && d <= end).sort()
    if (days.length) return days
  }
  return []
}

/** 全班排名 */
export function rankAll({ students, tradesByStudent, lookup, calendar, initialCapital, asOf }) {
  const day = asOf || calendar[calendar.length - 1] || ''
  const rows = students.map((s) => {
    const trades = tradesByStudent[s.studentId] || []
    const capital = Number(s.initialCapital) || Number(initialCapital) || 0
    const snap = snapshot(trades, lookup, day, capital)
    const series = navSeries(trades, lookup, calendar, capital)
    const last = series[series.length - 1]
    const prev = series[series.length - 2]
    return {
      studentId: s.studentId,
      name: s.name,
      group: s.group || '',
      total: snap.total,
      cash: snap.cash,
      marketValue: snap.marketValue,
      profit: snap.profit,
      returnPct: snap.returnPct,
      realized: snap.realized,
      unrealized: snap.unrealized,
      tradeCount: snap.tradeCount,
      holdingCount: snap.holdings.length,
      dayChange: last && prev ? last.total - prev.total : 0,
      dayChangePct: last && prev && prev.total ? (last.total - prev.total) / prev.total : 0,
      series,
      snapshot: snap,
    }
  })

  rows.sort((a, b) => b.returnPct - a.returnPct || b.total - a.total)
  rows.forEach((r, i) => {
    r.rank = i + 1
  })
  return rows
}

/** 分組排名（以組內成員平均報酬率排序） */
export function rankGroups(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = r.group || '未分組'
    const g = map.get(key) || { group: key, members: [], total: 0, profit: 0, capital: 0 }
    g.members.push(r)
    g.total += r.total
    g.profit += r.profit
    g.capital += r.total - r.profit
    map.set(key, g)
  }
  const groups = [...map.values()].map((g) => ({
    ...g,
    returnPct: g.capital > 0 ? g.profit / g.capital : 0,
    avgReturnPct: g.members.reduce((s, m) => s + m.returnPct, 0) / (g.members.length || 1),
  }))
  groups.sort((a, b) => b.returnPct - a.returnPct)
  groups.forEach((g, i) => {
    g.rank = i + 1
  })
  return groups
}
