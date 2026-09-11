import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { Card, Empty, RankMedal } from '../components/ui.jsx'
import LineChart from '../components/LineChart.jsx'
import { downloadCSV } from '../lib/csv.js'
import { money, pct, price as fmtPrice, signedMoney, tone, lots } from '../lib/format.js'

const PALETTE = ['#1f4fd8', '#d92b3f', '#0a9a5c', '#b7791f', '#7b3ff2', '#0891b2', '#db2777', '#65a30d']

export default function Leaderboard() {
  const { ranking, groupRanking, benchmarkSeries, calendar, config, authId, lastTradingDay } = useApp()
  const [view, setView] = useState('person')
  const [expanded, setExpanded] = useState(null)
  const [picked, setPicked] = useState([])

  const compareIds = useMemo(() => {
    if (picked.length) return picked
    const top = ranking.slice(0, 5).map((r) => r.studentId)
    if (authId && !top.includes(authId) && ranking.some((r) => r.studentId === authId)) top.push(authId)
    return top
  }, [picked, ranking, authId])

  const chart = useMemo(() => {
    const labels = calendar
    const series = compareIds
      .map((id, i) => {
        const row = ranking.find((r) => r.studentId === id)
        if (!row) return null
        return {
          name: `${row.name || row.studentId}${id === authId ? '（我）' : ''}`,
          color: PALETTE[i % PALETTE.length],
          values: row.series.map((p) => p.returnPct * 100),
          width: id === authId ? 3 : 2,
        }
      })
      .filter(Boolean)
    if (benchmarkSeries.length === labels.length) {
      series.push({
        name: `${config.benchmark || '0050'} 對照`,
        color: 'var(--text-faint)',
        values: benchmarkSeries.map((p) => p.returnPct * 100),
        dashed: true,
      })
    }
    return { labels, series }
  }, [compareIds, ranking, benchmarkSeries, calendar, authId, config.benchmark])

  function toggle(id) {
    setPicked((prev) => {
      const base = prev.length ? prev : compareIds
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id].slice(0, 8)
    })
  }

  function exportCSV() {
    const header = ['名次', '組別', '學號', '姓名', '總資產', '現金', '持股市值', '損益', '報酬率', '持股檔數', '交易次數']
    const body = ranking.map((r) => [
      r.rank, r.group, r.studentId, r.name,
      Math.round(r.total), Math.round(r.cash), Math.round(r.marketValue),
      Math.round(r.profit), (r.returnPct * 100).toFixed(2) + '%',
      r.holdingCount, r.tradeCount,
    ])
    downloadCSV(`投資競賽成績_${lastTradingDay}`, [header, ...body])
  }

  if (!ranking.length) {
    return (
      <Card title="排行榜">
        <Empty title="還沒有參賽學生">老師可以到「管理」頁面匯入同學名單。</Empty>
      </Card>
    )
  }

  const best = ranking[0]
  const benchLast = benchmarkSeries[benchmarkSeries.length - 1]?.returnPct
  const beatBench = benchLast != null ? ranking.filter((r) => r.returnPct > benchLast).length : null

  return (
    <div className="stack">
      <div className="grid cols-4">
        <div className="stat">
          <div className="label">目前第一名</div>
          <div className="value sm">{best.name || best.studentId}</div>
          <div className="foot">
            <span className={tone(best.returnPct)}>{pct(best.returnPct)}</span>　{money(best.total)}
          </div>
        </div>
        <div className="stat">
          <div className="label">全班平均報酬率</div>
          <div className={`value tabular ${tone(ranking.reduce((s, r) => s + r.returnPct, 0))}`}>
            {pct(ranking.reduce((s, r) => s + r.returnPct, 0) / ranking.length)}
          </div>
          <div className="foot">{ranking.length} 位參賽者</div>
        </div>
        <div className="stat">
          <div className="label">{config.benchmark || '0050'} 同期報酬</div>
          <div className={`value tabular ${tone(benchLast)}`}>{benchLast != null ? pct(benchLast) : '—'}</div>
          <div className="foot">{beatBench != null ? `${beatBench} 人勝過大盤` : ''}</div>
        </div>
        <div className="stat">
          <div className="label">結算日期</div>
          <div className="value sm tabular">{lastTradingDay}</div>
          <div className="foot">
            競賽期間 {config.startDate} ～ {config.endDate}
          </div>
        </div>
      </div>

      <Card
        title="報酬率走勢比較"
        sub="點下方表格的名字可加入或移除比較對象（最多 8 位）"
        actions={picked.length ? <button className="tiny" onClick={() => setPicked([])}>回到前五名</button> : null}
      >
        <LineChart
          labels={chart.labels}
          series={chart.series}
          height={300}
          zeroLine
          format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
        />
      </Card>

      <Card
        title="排行榜"
        actions={
          <div className="row tight">
            <div className="seg" style={{ margin: 0 }}>
              <button className={view === 'person' ? 'active' : ''} onClick={() => setView('person')}>
                個人
              </button>
              <button className={view === 'group' ? 'active' : ''} onClick={() => setView('group')}>
                分組
              </button>
            </div>
            <button onClick={exportCSV}>匯出成績 CSV</button>
          </div>
        }
        tight
      >
        {view === 'person' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">名次</th>
                  <th>組別</th>
                  <th>學號</th>
                  <th>姓名</th>
                  <th className="num">總資產</th>
                  <th className="num">損益</th>
                  <th className="num">報酬率</th>
                  <th className="num">當日漲跌</th>
                  <th className="num">持股</th>
                  <th className="num">交易</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r) => (
                  <RankRow
                    key={r.studentId}
                    row={r}
                    me={r.studentId === authId}
                    selected={compareIds.includes(r.studentId)}
                    expanded={expanded === r.studentId}
                    onToggleCompare={() => toggle(r.studentId)}
                    onExpand={() => setExpanded(expanded === r.studentId ? null : r.studentId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="num">名次</th>
                  <th>組別</th>
                  <th className="num">人數</th>
                  <th className="num">組總資產</th>
                  <th className="num">組損益</th>
                  <th className="num">組報酬率</th>
                  <th>成員</th>
                </tr>
              </thead>
              <tbody>
                {groupRanking.map((g) => (
                  <tr key={g.group}>
                    <td className="num">
                      <RankMedal rank={g.rank} />
                    </td>
                    <td>
                      <b>{g.group}</b>
                    </td>
                    <td className="num">{g.members.length}</td>
                    <td className="num">{money(g.total)}</td>
                    <td className={`num ${tone(g.profit)}`}>{signedMoney(g.profit)}</td>
                    <td className={`num ${tone(g.returnPct)}`}>
                      <b>{pct(g.returnPct)}</b>
                    </td>
                    <td className="small muted" style={{ whiteSpace: 'normal' }}>
                      {g.members
                        .slice()
                        .sort((a, b) => b.returnPct - a.returnPct)
                        .map((m) => `${m.name || m.studentId}（${pct(m.returnPct)}）`)
                        .join('、')}
                    </td>
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

function RankRow({ row, me, selected, expanded, onToggleCompare, onExpand }) {
  return (
    <>
      <tr style={me ? { background: 'var(--brand-soft)' } : undefined}>
        <td className="num">
          <RankMedal rank={row.rank} />
        </td>
        <td>{row.group || '—'}</td>
        <td className="tabular">{row.studentId}</td>
        <td>
          <button
            className="tiny ghost"
            onClick={onToggleCompare}
            title="加入／移除走勢比較"
            style={{
              fontWeight: 600,
              borderColor: selected ? 'var(--brand)' : 'transparent',
              color: selected ? 'var(--brand-text)' : 'inherit',
            }}
          >
            {row.name || row.studentId}
            {me && ' ★'}
          </button>
        </td>
        <td className="num">{money(row.total)}</td>
        <td className={`num ${tone(row.profit)}`}>{signedMoney(row.profit)}</td>
        <td className={`num ${tone(row.returnPct)}`}>
          <b>{pct(row.returnPct)}</b>
        </td>
        <td className={`num ${tone(row.dayChange)}`}>{row.dayChange ? signedMoney(row.dayChange) : '—'}</td>
        <td className="num">
          <button className="tiny ghost" onClick={onExpand}>
            {row.holdingCount} 檔 {expanded ? '▴' : '▾'}
          </button>
        </td>
        <td className="num">{row.tradeCount}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} style={{ background: 'var(--surface-2)', whiteSpace: 'normal' }}>
            {row.snapshot.holdings.length === 0 ? (
              <span className="muted small">目前空手，現金 {money(row.cash)}</span>
            ) : (
              <div className="row" style={{ gap: 18 }}>
                {row.snapshot.holdings.map((h) => (
                  <div key={h.code} className="small">
                    <b className="tabular">{h.code}</b> {h.name}
                    <div className="muted">
                      {lots(h.shares)} @ {fmtPrice(h.avgCost)} → {fmtPrice(h.price)}{' '}
                      <span className={tone(h.unrealized)}>{pct(h.returnPct)}</span>
                    </div>
                  </div>
                ))}
                <div className="small">
                  <b>現金</b>
                  <div className="muted">{money(row.cash)}</div>
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
