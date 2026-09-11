import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { Card, Empty, Field, MarketBadge } from '../components/ui.jsx'
import StockSearch from '../components/StockSearch.jsx'
import LineChart from '../components/LineChart.jsx'
import { fetchQuote } from '../services/prices.js'
import { settle } from '../lib/fees.js'
import { money, pct, price as fmtPrice, signedMoney, tone, lots } from '../lib/format.js'

export default function Trade() {
  const {
    config,
    stockList,
    mySnapshot: snap,
    calendar,
    lastTradingDay,
    isAdmin,
    authId,
    students,
    addTrade,
    notify,
    notStarted,
    session,
  } = useApp()

  const [stock, setStock] = useState(null)
  const [quote, setQuote] = useState(null)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [quoteError, setQuoteError] = useState('')
  const [side, setSide] = useState('BUY')
  const [lotInput, setLotInput] = useState('1')
  const [oddInput, setOddInput] = useState('0')
  const [tradeDate, setTradeDate] = useState('')
  const [forStudent, setForStudent] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const effectiveDate = tradeDate || lastTradingDay
  const targetStudent = isAdmin && forStudent ? forStudent : authId

  useEffect(() => {
    setTradeDate(lastTradingDay)
  }, [lastTradingDay])

  /* 選到股票就抓該檔的日收盤價 */
  useEffect(() => {
    if (!stock?.code) return setQuote(null)
    let cancelled = false
    setLoadingQuote(true)
    setQuoteError('')
    fetchQuote(stock.code, config.startDate, config.endDate < lastTradingDay ? config.endDate : lastTradingDay)
      .then((q) => {
        if (!cancelled) setQuote(q)
      })
      .catch((err) => {
        if (!cancelled) {
          setQuote(null)
          setQuoteError(err.message)
        }
      })
      .finally(() => !cancelled && setLoadingQuote(false))
    return () => {
      cancelled = true
    }
  }, [stock?.code, config.startDate, config.endDate, lastTradingDay])

  const dates = useMemo(() => (quote?.closes ? Object.keys(quote.closes).sort() : []), [quote])

  const execPrice = useMemo(() => {
    if (!quote?.closes) return null
    if (quote.closes[effectiveDate] != null) return quote.closes[effectiveDate]
    // 該日無報價（停牌或尚未上市）→ 取之前最近的收盤價
    const before = dates.filter((d) => d <= effectiveDate)
    return before.length ? quote.closes[before[before.length - 1]] : null
  }, [quote, effectiveDate, dates])

  const prevPrice = useMemo(() => {
    const before = dates.filter((d) => d < effectiveDate)
    return before.length ? quote.closes[before[before.length - 1]] : null
  }, [dates, quote, effectiveDate])

  const change = execPrice != null && prevPrice != null ? execPrice - prevPrice : null

  const holding = snap.holdings.find((h) => h.code === stock?.code) || null
  const shares = Math.max(0, (Number(lotInput) || 0) * 1000 + (Number(oddInput) || 0))
  const estimate = execPrice != null && shares > 0 ? settle(side, execPrice, shares, config) : null

  const locked = config.lockTrading && !isAdmin
  // 盤中禁止下單；老師不受限，方便上課示範與補單
  const sessionBlocked = session.blocked && !isAdmin
  const outOfRange = effectiveDate < config.startDate || effectiveDate > config.endDate

  const problem = useMemo(() => {
    if (notStarted) return `競賽將於 ${config.startDate} 開始，開賽後才能下單`
    if (locked) return '老師已鎖定交易，目前無法下單'
    if (sessionBlocked) {
      return `現在是${session.label}（${session.time}），本競賽以收盤價成交，盤中不開放下單。今天 ${session.reopenAt} 之後即可用今日收盤價交易。`
    }
    if (!stock) return '請先在上方「選擇股票」搜尋並點選一檔股票（例如輸入 2330 後點台積電）'
    if (loadingQuote) return '報價載入中，請稍候…'
    if (quoteError) return `取得報價失敗：${quoteError}`
    if (execPrice == null) return '這檔股票在所選日期沒有收盤價，請換一天或換一檔'
    if (outOfRange) return `交易日需在競賽期間內（${config.startDate} ～ ${config.endDate}）`
    if (shares <= 0) return '請輸入交易股數'
    if (side === 'BUY' && estimate && estimate.net > snap.cash) {
      return `現金不足：需要 ${money(estimate.net)} 元，目前只有 ${money(snap.cash)} 元`
    }
    if (side === 'SELL') {
      if (!holding) return '你沒有持有這檔股票，無法賣出'
      if (shares > holding.shares) return `賣出股數超過持股（目前 ${lots(holding.shares)}）`
    }
    return null
  }, [
    notStarted, locked, sessionBlocked, session, stock, loadingQuote, quoteError,
    execPrice, outOfRange, shares, side, estimate, snap.cash, holding, config,
  ])

  // 還沒選股票只是「還沒開始」，不是錯誤，用中性樣式提示就好
  const problemTone = (!stock || loadingQuote) && !sessionBlocked ? '' : 'warn'

  async function submit() {
    if (problem || !estimate || !stock) return
    setBusy(true)
    try {
      await addTrade({
        studentId: targetStudent,
        date: effectiveDate,
        side,
        code: stock.code,
        name: stock.name || quote?.name || '',
        market: quote?.market || stock.market || '',
        shares,
        price: execPrice,
        gross: estimate.gross,
        fee: estimate.fee,
        tax: estimate.tax,
        net: estimate.net,
        note: note.trim(),
        createdBy: authId,
      })
      notify(
        `${side === 'BUY' ? '買進' : '賣出'} ${stock.code} ${stock.name} ${lots(shares)} @ ${fmtPrice(execPrice)} 已成交`,
        'success',
      )
      setLotInput('1')
      setOddInput('0')
      setNote('')
    } catch (err) {
      notify(err.message || '下單失敗', 'error')
    } finally {
      setBusy(false)
    }
  }

  const chartLabels = dates.slice(-60)
  const chartValues = chartLabels.map((d) => quote.closes[d])

  return (
    <div className="grid side">
      <div className="stack">
        <Card title="選擇股票" sub="輸入代號或中文名稱，支援上市與上櫃全部股票、ETF">
          <StockSearch list={stockList} onSelect={setStock} autoFocus />

          {stock && (
            <div style={{ marginTop: 18 }}>
              <div className="row" style={{ alignItems: 'baseline' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }} className="tabular">
                  {stock.code}
                </div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{stock.name || quote?.name || ''}</div>
                <MarketBadge market={quote?.market || stock.market} />
                <div className="spacer" />
                {loadingQuote ? (
                  <span className="loader" />
                ) : execPrice != null ? (
                  <div style={{ textAlign: 'right' }}>
                    <div className={`tabular ${tone(change)}`} style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.1 }}>
                      {fmtPrice(execPrice)}
                    </div>
                    <div className={`small tabular ${tone(change)}`}>
                      {change != null
                        ? `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${Math.abs(change).toFixed(2)}　${pct(
                            change / prevPrice,
                          )}`
                        : '—'}
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="small muted" style={{ marginTop: 2 }}>
                {effectiveDate} 收盤價
                {quote?.source ? `　資料來源：${quote.source === 'yahoo' ? 'Yahoo Finance' : '證交所'}` : ''}
              </div>

              {quoteError && <div className="notice error" style={{ marginTop: 12 }}>{quoteError}</div>}

              {quote?.intraday && (
                <div className="notice warn" style={{ marginTop: 12 }}>
                  今日（{quote.intraday.date}）尚未收盤，盤中參考價 <b>{fmtPrice(quote.intraday.price)}</b>。
                  競賽一律以已確認的收盤價成交，所以這筆交易會用 <b>{effectiveDate}</b> 的收盤價{' '}
                  <b>{fmtPrice(execPrice)}</b>；今天收盤後即可用今日收盤價下單。
                </div>
              )}

              {chartLabels.length > 1 && (
                <div style={{ marginTop: 14 }}>
                  <LineChart
                    labels={chartLabels}
                    series={[{ name: '收盤價', color: 'var(--brand)', values: chartValues }]}
                    height={190}
                    area
                    format={(v) => fmtPrice(v)}
                  />
                </div>
              )}
            </div>
          )}

          {!stock && (
            <Empty title="請先搜尋並選擇一檔股票">
              例如輸入 <b>2330</b>、<b>台積電</b>、<b>0050</b> 或 <b>6488</b>
            </Empty>
          )}
        </Card>

        {snap.holdings.length > 0 && (
          <Card title="我的持股" sub="點一下可快速帶入賣出" tight>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>股票</th>
                    <th className="num">股數</th>
                    <th className="num">平均成本</th>
                    <th className="num">現價</th>
                    <th className="num">未實現損益</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {snap.holdings.map((h) => (
                    <tr key={h.code}>
                      <td>
                        <b className="tabular">{h.code}</b>　{h.name}
                      </td>
                      <td className="num">{lots(h.shares)}</td>
                      <td className="num">{fmtPrice(h.avgCost)}</td>
                      <td className="num">{fmtPrice(h.price)}</td>
                      <td className={`num ${tone(h.unrealized)}`}>
                        {signedMoney(h.unrealized)}　{pct(h.returnPct)}
                      </td>
                      <td className="num">
                        <button
                          className="tiny"
                          onClick={() => {
                            setStock({ code: h.code, name: h.name, market: h.market })
                            setSide('SELL')
                            setLotInput(String(Math.floor(h.shares / 1000)))
                            setOddInput(String(h.shares % 1000))
                          }}
                        >
                          賣出
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>

      {/* ---------------- 下單面板 ---------------- */}
      <div className="stack">
        <Card title="下單" sub={`以 ${effectiveDate} 收盤價成交`}>
          <div className="stack sm">
            <div className="seg">
              <button className={side === 'BUY' ? 'active' : ''} onClick={() => setSide('BUY')}>
                買進
              </button>
              <button className={side === 'SELL' ? 'active' : ''} onClick={() => setSide('SELL')}>
                賣出
              </button>
            </div>

            {isAdmin && (
              <>
                <Field label="交易日（老師可回補歷史日期）">
                  <select value={effectiveDate} onChange={(e) => setTradeDate(e.target.value)}>
                    {(calendar.length ? calendar : [lastTradingDay]).slice().reverse().map((d) => (
                      <option key={d} value={d}>
                        {d}
                        {d === lastTradingDay ? '（最新）' : ''}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="代誰下單" hint="留空代表以自己的帳號下單">
                  <select value={forStudent} onChange={(e) => setForStudent(e.target.value)}>
                    <option value="">（我自己 {authId}）</option>
                    {students
                      .filter((s) => s.role !== 'admin')
                      .map((s) => (
                        <option key={s.studentId} value={s.studentId}>
                          {s.studentId} {s.name} {s.group ? `／${s.group}` : ''}
                        </option>
                      ))}
                  </select>
                </Field>
              </>
            )}

            <div className="field-row">
              <Field label="張數（1 張 = 1000 股）">
                <input
                  type="number"
                  min="0"
                  value={lotInput}
                  onChange={(e) => setLotInput(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
              <Field label="零股">
                <input
                  type="number"
                  min="0"
                  max="999"
                  value={oddInput}
                  onChange={(e) => setOddInput(e.target.value)}
                  inputMode="numeric"
                />
              </Field>
            </div>

            <div className="row tight">
              {[1, 5, 10].map((n) => (
                <button
                  key={n}
                  className="tiny"
                  onClick={() => {
                    setLotInput(String(n))
                    setOddInput('0')
                  }}
                >
                  {n} 張
                </button>
              ))}
              {side === 'BUY' && execPrice != null && (
                <button
                  className="tiny"
                  onClick={() => {
                    // 1.002 預留手續費；買不滿一張時自動改買零股
                    const max = Math.max(0, Math.floor(snap.cash / (execPrice * 1.002)))
                    setLotInput(String(Math.floor(max / 1000)))
                    setOddInput(String(max % 1000))
                  }}
                >
                  可買最大量
                </button>
              )}
              {side === 'SELL' && holding && (
                <button
                  className="tiny"
                  onClick={() => {
                    setLotInput(String(Math.floor(holding.shares / 1000)))
                    setOddInput(String(holding.shares % 1000))
                  }}
                >
                  全部賣出
                </button>
              )}
            </div>

            <Field label="備註（選填）">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="例如：看好 AI 伺服器出貨" />
            </Field>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              <div className="kv">
                <span>成交價 × 股數</span>
                <b>
                  {execPrice != null ? fmtPrice(execPrice) : '—'} × {shares.toLocaleString('zh-TW')}
                </b>
              </div>
              <div className="kv">
                <span>成交金額</span>
                <b>{estimate ? money(estimate.gross) : '—'}</b>
              </div>
              <div className="kv">
                <span>手續費（{(config.feeRate * 100).toFixed(4)}% × {config.feeDiscount} 折扣）</span>
                <b>{estimate ? money(estimate.fee) : '—'}</b>
              </div>
              {side === 'SELL' && (
                <div className="kv">
                  <span>證交稅（{(config.taxRate * 100).toFixed(2)}%）</span>
                  <b>{estimate ? money(estimate.tax) : '—'}</b>
                </div>
              )}
              <div className="kv" style={{ fontSize: 15, paddingTop: 8 }}>
                <span>
                  <b>{side === 'BUY' ? '應付金額' : '實收金額'}</b>
                </span>
                <b className={side === 'BUY' ? 'up' : 'down'}>{estimate ? money(estimate.net) : '—'}</b>
              </div>
              <div className="kv">
                <span>交易後現金</span>
                <b>
                  {estimate ? money(side === 'BUY' ? snap.cash - estimate.net : snap.cash + estimate.net) : money(snap.cash)}
                </b>
              </div>
            </div>

            {problem && <div className={`notice ${problemTone}`}>{problem}</div>}

            <button
              className={side === 'BUY' ? 'buy' : 'sell'}
              disabled={Boolean(problem) || busy || !estimate}
              onClick={submit}
              style={{ width: '100%', padding: 12, fontSize: 15 }}
            >
              {busy ? <span className="loader" /> : `確認${side === 'BUY' ? '買進' : '賣出'}`}
            </button>
          </div>
        </Card>

        <Card title="帳戶狀態">
          <div className="kv">
            <span>可用現金</span>
            <b>{money(snap.cash)}</b>
          </div>
          <div className="kv">
            <span>持股市值</span>
            <b>{money(snap.marketValue)}</b>
          </div>
          <div className="kv">
            <span>總資產</span>
            <b>{money(snap.total)}</b>
          </div>
          <div className="kv">
            <span>總報酬率</span>
            <b className={tone(snap.returnPct)}>{pct(snap.returnPct)}</b>
          </div>
        </Card>

        <div className="notice">
          <b>交易規則</b>
          <br />
          • 一律以 <b>{effectiveDate}</b> 的收盤價成交，不可指定價格
          <br />
          • <b>盤中（平日 09:00–14:00）不開放下單</b>，收盤後才能交易
          <br />
          • 六日與休市日全天開放，以最近一個交易日的收盤價成交
          <br />
          • 手續費 {(config.feeRate * 100).toFixed(4)}%（最低 {config.minFee} 元），賣出另收證交稅{' '}
          {(config.taxRate * 100).toFixed(2)}%
          <br />
          • 可買零股，賣出不得超過持股，買進不得超過現金
        </div>
      </div>
    </div>
  )
}
