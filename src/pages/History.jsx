import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { Card, Empty } from '../components/ui.jsx'
import { downloadCSV } from '../lib/csv.js'
import { sortTrades } from '../lib/portfolio.js'
import { money, pct, price as fmtPrice, signedMoney, tone, lots, dateTime } from '../lib/format.js'

/** 重播交易，為每一筆賣出算出已實現損益 */
function withRealized(trades) {
  const pos = new Map()
  const out = []
  for (const t of sortTrades(trades)) {
    const p = pos.get(t.code) || { shares: 0, cost: 0 }
    let realized = null
    let avgCost = null
    if (t.side === 'SELL') {
      avgCost = p.shares > 0 ? p.cost / p.shares : 0
      const sold = Math.min(t.shares, p.shares)
      realized = (Number(t.net) || 0) - avgCost * sold
      p.shares = Math.max(0, p.shares - t.shares)
      p.cost = p.shares === 0 ? 0 : Math.max(0, p.cost - avgCost * sold)
    } else {
      p.shares += Number(t.shares) || 0
      p.cost += Number(t.net) || 0
    }
    pos.set(t.code, p)
    out.push({ ...t, realized, avgCost })
  }
  return out.reverse()
}

export default function History() {
  const { myTrades, trades, students, isAdmin, authId, removeTrade, config } = useApp()
  const [scope, setScope] = useState('me')
  const [side, setSide] = useState('ALL')
  const [keyword, setKeyword] = useState('')
  const [student, setStudent] = useState('')

  const source = useMemo(() => {
    if (!isAdmin || scope === 'me') return myTrades
    return student ? trades.filter((t) => t.studentId === student) : trades
  }, [isAdmin, scope, student, myTrades, trades])

  const rows = useMemo(() => {
    const kw = keyword.trim().toUpperCase()
    return withRealized(source).filter((t) => {
      if (side !== 'ALL' && t.side !== side) return false
      if (kw && !`${t.code}${t.name}`.toUpperCase().includes(kw)) return false
      return true
    })
  }, [source, side, keyword])

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, t) => {
          acc.gross += Number(t.gross) || 0
          acc.fee += Number(t.fee) || 0
          acc.tax += Number(t.tax) || 0
          acc.realized += Number(t.realized) || 0
          if (t.side === 'BUY') acc.buys += 1
          else acc.sells += 1
          return acc
        },
        { gross: 0, fee: 0, tax: 0, realized: 0, buys: 0, sells: 0 },
      ),
    [rows],
  )

  const nameOf = (id) => students.find((s) => s.studentId === id)?.name || ''

  function exportCSV() {
    const header = [
      '學號', '姓名', '日期', '買賣別', '代號', '股票名稱', '市場',
      '成交價', '股數', '成交金額', '手續費', '證交稅', '淨額', '已實現損益', '備註', '建立時間',
    ]
    const body = rows.map((t) => [
      t.studentId, nameOf(t.studentId), t.date, t.side === 'BUY' ? '買進' : '賣出',
      t.code, t.name, t.market === 'TPEX' ? '上櫃' : '上市',
      t.price, t.shares, Math.round(t.gross), t.fee, t.tax, Math.round(t.net),
      t.realized == null ? '' : Math.round(t.realized), t.note || '', dateTime(t.createdAt),
    ])
    downloadCSV(`交易紀錄_${scope === 'me' ? authId : '全班'}_${new Date().toISOString().slice(0, 10)}`, [header, ...body])
  }

  return (
    <div className="stack">
      <Card title="交易紀錄查詢">
        <div className="field-row">
          {isAdmin && (
            <div>
              <label>查詢範圍</label>
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="me">我的交易</option>
                <option value="all">全班交易</option>
              </select>
            </div>
          )}
          {isAdmin && scope === 'all' && (
            <div>
              <label>指定學生</label>
              <select value={student} onChange={(e) => setStudent(e.target.value)}>
                <option value="">全部學生</option>
                {students
                  .filter((s) => s.role !== 'admin')
                  .map((s) => (
                    <option key={s.studentId} value={s.studentId}>
                      {s.studentId} {s.name}
                    </option>
                  ))}
              </select>
            </div>
          )}
          <div>
            <label>買賣別</label>
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="ALL">全部</option>
              <option value="BUY">只看買進</option>
              <option value="SELL">只看賣出</option>
            </select>
          </div>
          <div>
            <label>股票代號／名稱</label>
            <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="例如 2330" />
          </div>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <span className="badge brand">共 {rows.length} 筆</span>
          <span className="badge buy">買進 {totals.buys}</span>
          <span className="badge sell">賣出 {totals.sells}</span>
          <span className="small muted">
            成交總額 {money(totals.gross)}　手續費 {money(totals.fee)}　證交稅 {money(totals.tax)}
          </span>
          <div className="spacer" />
          <span className="small">
            已實現損益
            <b className={tone(totals.realized)}>{signedMoney(totals.realized)}</b>
          </span>
          <button onClick={exportCSV} disabled={!rows.length}>
            匯出 CSV
          </button>
        </div>
      </Card>

      <Card title="明細" tight>
        {rows.length === 0 ? (
          <Empty title="沒有符合條件的交易紀錄">到「交易下單」頁面買進第一檔股票吧。</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {isAdmin && scope === 'all' && <th>學生</th>}
                  <th>日期</th>
                  <th>別</th>
                  <th>股票</th>
                  <th className="num">成交價</th>
                  <th className="num">股數</th>
                  <th className="num">成交金額</th>
                  <th className="num">手續費</th>
                  <th className="num">證交稅</th>
                  <th className="num">{'淨額'}</th>
                  <th className="num">已實現損益</th>
                  <th>備註</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr key={t.id}>
                    {isAdmin && scope === 'all' && (
                      <td>
                        <span className="tabular">{t.studentId}</span> {nameOf(t.studentId)}
                      </td>
                    )}
                    <td className="tabular">{t.date}</td>
                    <td>
                      <span className={`badge ${t.side === 'BUY' ? 'buy' : 'sell'}`}>
                        {t.side === 'BUY' ? '買進' : '賣出'}
                      </span>
                    </td>
                    <td>
                      <b className="tabular">{t.code}</b>　{t.name}
                    </td>
                    <td className="num">{fmtPrice(t.price)}</td>
                    <td className="num">{lots(t.shares)}</td>
                    <td className="num">{money(t.gross)}</td>
                    <td className="num">{money(t.fee)}</td>
                    <td className="num">{t.side === 'SELL' ? money(t.tax) : '—'}</td>
                    <td className="num">{money(t.net)}</td>
                    <td className={`num ${tone(t.realized)}`}>
                      {t.realized == null ? '—' : (
                        <>
                          {signedMoney(t.realized)}
                          <span className="small muted">
                            {' '}
                            {t.avgCost ? pct(t.realized / (t.avgCost * t.shares)) : ''}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="muted small">{t.note || ''}</td>
                    {isAdmin && (
                      <td className="num">
                        <button
                          className="tiny danger"
                          onClick={() => {
                            if (confirm(`確定刪除 ${t.studentId} 在 ${t.date} ${t.side === 'BUY' ? '買進' : '賣出'} ${t.code} 的紀錄？\n刪除後淨值會重新計算。`)) {
                              removeTrade(t.id)
                            }
                          }}
                        >
                          刪除
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
