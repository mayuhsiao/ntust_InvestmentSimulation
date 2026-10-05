import { useMemo, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { Card, Empty, RankMedal } from '../components/ui.jsx'
import LineChart from '../components/LineChart.jsx'
import { downloadCSV } from '../lib/csv.js'
import { money, pct, price as fmtPrice, signedMoney, tone, lots } from '../lib/format.js'

const PALETTE = ['#1f4fd8', '#d92b3f', '#0a9a5c', '#b7791f', '#7b3ff2', '#0891b2', '#db2777', '#65a30d']
const MAX_COMPARE = 8
const axisPct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`

export default function Leaderboard() {
  const { ranking, groupRanking } = useApp()
  const [view, setView] = useState('person')

  if (!ranking.length) {
    return (
      <Card title="排行榜">
        <Empty title="還沒有參賽學生">老師可以到「管理」頁面匯入同學名單。</Empty>
      </Card>
    )
  }

  return (
    <div className="stack">
      <div className="seg" style={{ margin: 0, alignSelf: 'flex-start', minWidth: 300 }}>
        <button className={view === 'person' ? 'active' : ''} onClick={() => setView('person')}>
          個人排名
        </button>
        <button className={view === 'group' ? 'active' : ''} onClick={() => setView('group')}>
          分組排名{groupRanking.length ? `（${groupRanking.length} 組）` : ''}
        </button>
      </div>
      {view === 'person' ? <PersonBoard /> : <GroupBoard />}
    </div>
  )
}

/** 走勢比較的勾選狀態：還沒點過就用預設名單，點過之後以使用者的選擇為準 */
function useCompare(defaults) {
  const [picked, setPicked] = useState([])
  const ids = picked.length ? picked : defaults
  function toggle(id) {
    setPicked((prev) => {
      const base = prev.length ? prev : defaults
      return base.includes(id) ? base.filter((x) => x !== id) : [...base, id].slice(0, MAX_COMPARE)
    })
  }
  return { ids, toggle, customized: picked.length > 0, reset: () => setPicked([]) }
}

function useBenchmark() {
  const { benchmarkSeries, config } = useApp()
  const code = config.benchmark || '0050'
  return useMemo(
    () => ({
      name: `${code} 對照`,
      label: `${code} 同期報酬`,
      series: benchmarkSeries,
      last: benchmarkSeries[benchmarkSeries.length - 1]?.returnPct,
    }),
    [benchmarkSeries, code],
  )
}

function benchmarkLine(bench, labels) {
  if (bench.series.length !== labels.length) return []
  return [{ name: bench.name, color: 'var(--text-faint)', values: bench.series.map((p) => p.returnPct * 100), dashed: true }]
}

function SettleDateStat() {
  const { config, lastTradingDay } = useApp()
  return (
    <div className="stat">
      <div className="label">結算日期</div>
      <div className="value sm tabular">{lastTradingDay}</div>
      <div className="foot">
        競賽期間 {config.startDate} ～ {config.endDate}
      </div>
    </div>
  )
}

/* ================================================================== */
/* 個人排名                                                            */
/* ================================================================== */

function PersonBoard() {
  const { ranking, groupOf, calendar, authId, lastTradingDay } = useApp()
  const bench = useBenchmark()
  const [expanded, setExpanded] = useState(null)

  const defaults = useMemo(() => {
    const top = ranking.slice(0, 5).map((r) => r.studentId)
    if (authId && !top.includes(authId) && ranking.some((r) => r.studentId === authId)) top.push(authId)
    return top
  }, [ranking, authId])
  const compare = useCompare(defaults)

  const chart = useMemo(() => {
    const series = compare.ids
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
    return { labels: calendar, series: [...series, ...benchmarkLine(bench, calendar)] }
  }, [compare.ids, ranking, bench, calendar, authId])

  function exportCSV() {
    const header = [
      '名次', '組別', '學號', '姓名', '總資產', '現金', '持股市值', '損益', '報酬率', '持股檔數', '交易次數',
      '組排名', '組內名次',
    ]
    const body = ranking.map((r) => {
      const g = groupOf[r.studentId]
      return [
        r.rank, g?.name || '', r.studentId, r.name,
        Math.round(r.total), Math.round(r.cash), Math.round(r.marketValue),
        Math.round(r.profit), (r.returnPct * 100).toFixed(2) + '%',
        r.holdingCount, r.tradeCount,
        g?.rank ?? '', g?.memberRank ?? '',
      ]
    })
    downloadCSV(`投資競賽成績_${lastTradingDay}`, [header, ...body])
  }

  const best = ranking[0]
  const beatBench = bench.last != null ? ranking.filter((r) => r.returnPct > bench.last).length : null
  const avg = ranking.reduce((s, r) => s + r.returnPct, 0) / ranking.length

  return (
    <>
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
          <div className={`value tabular ${tone(avg)}`}>{pct(avg)}</div>
          <div className="foot">{ranking.length} 位參賽者</div>
        </div>
        <div className="stat">
          <div className="label">{bench.label}</div>
          <div className={`value tabular ${tone(bench.last)}`}>{bench.last != null ? pct(bench.last) : '—'}</div>
          <div className="foot">{beatBench != null ? `${beatBench} 人勝過大盤` : ''}</div>
        </div>
        <SettleDateStat />
      </div>

      <Card
        title="報酬率走勢比較"
        sub={`點下方表格的名字可加入或移除比較對象（最多 ${MAX_COMPARE} 位）`}
        actions={compare.customized ? <button className="tiny" onClick={compare.reset}>回到前五名</button> : null}
      >
        <LineChart labels={chart.labels} series={chart.series} height={300} zeroLine format={axisPct} />
      </Card>

      <Card title="個人排行榜" actions={<button onClick={exportCSV}>匯出成績 CSV</button>} tight>
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
                  group={groupOf[r.studentId]?.name}
                  me={r.studentId === authId}
                  selected={compare.ids.includes(r.studentId)}
                  expanded={expanded === r.studentId}
                  onToggleCompare={() => compare.toggle(r.studentId)}
                  onExpand={() => setExpanded(expanded === r.studentId ? null : r.studentId)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

function RankRow({ row, group, me, selected, expanded, onToggleCompare, onExpand }) {
  return (
    <>
      <tr style={me ? { background: 'var(--brand-soft)' } : undefined}>
        <td className="num">
          <RankMedal rank={row.rank} />
        </td>
        <td>{group || '—'}</td>
        <td className="tabular">{row.studentId}</td>
        <td>
          <CompareButton selected={selected} onClick={onToggleCompare}>
            {row.name || row.studentId}
            {me && ' ★'}
          </CompareButton>
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

function CompareButton({ selected, onClick, children }) {
  return (
    <button
      className="tiny ghost"
      onClick={onClick}
      title="加入／移除走勢比較"
      style={{
        fontWeight: 600,
        borderColor: selected ? 'var(--brand)' : 'transparent',
        color: selected ? 'var(--brand-text)' : 'inherit',
      }}
    >
      {children}
    </button>
  )
}

/* ================================================================== */
/* 分組排名                                                            */
/* ================================================================== */

function GroupBoard() {
  const { groupRanking, ungrouped, myGroup, calendar, authId, isAdmin, lastTradingDay } = useApp()
  const bench = useBenchmark()

  // 預設比較全部的組；超過上限時取前幾名，並保留自己的組
  const defaults = useMemo(() => {
    const keys = groupRanking.slice(0, MAX_COMPARE).map((g) => g.key)
    if (myGroup && !keys.includes(myGroup.key)) keys[keys.length - 1] = myGroup.key
    return keys
  }, [groupRanking, myGroup])
  const compare = useCompare(defaults)

  const chart = useMemo(() => {
    const series = compare.ids
      .map((key, i) => {
        const g = groupRanking.find((x) => x.key === key)
        if (!g) return null
        const mine = key === myGroup?.key
        return {
          name: `${g.name}${mine ? '（我的組）' : ''}`,
          color: PALETTE[i % PALETTE.length],
          values: g.series.map((p) => p.returnPct * 100),
          width: mine ? 3 : 2,
        }
      })
      .filter(Boolean)
    return { labels: calendar, series: [...series, ...benchmarkLine(bench, calendar)] }
  }, [compare.ids, groupRanking, bench, calendar, myGroup])

  function exportCSV() {
    const header = [
      '名次', '組別', '人數', '組總資產', '組本金', '組損益', '平均每人損益', '組報酬率', '當日漲跌', '成員（依報酬率）',
    ]
    const body = groupRanking.map((g) => [
      g.rank, g.name, g.members.length,
      Math.round(g.total), Math.round(g.capital), Math.round(g.profit), Math.round(g.avgProfit),
      (g.returnPct * 100).toFixed(2) + '%', Math.round(g.dayChange),
      g.members.map((m) => `${m.name || m.studentId} ${pct(m.returnPct)}`).join('、'),
    ])
    downloadCSV(`投資競賽分組成績_${lastTradingDay}`, [header, ...body])
  }

  const ungroupedNote = ungrouped.length > 0 && (
    <div className="notice">
      另有 {ungrouped.length} 位同學尚未分組，不列入分組排名：
      {ungrouped.map((r) => r.name || r.studentId).join('、')}。
      {isAdmin ? '可到「管理 → 學生名單」補上組別。' : '需要補登組別請聯絡老師。'}
    </div>
  )

  if (!groupRanking.length) {
    return (
      <Card title="分組排行榜">
        <Empty title="還沒有分組資料">
          {isAdmin
            ? '到「管理 → 學生名單」幫同學填上組別後，就會自動依組別排名。'
            : '名單上還沒有同學填寫組別，請老師設定分組後再來看看。'}
        </Empty>
      </Card>
    )
  }

  const best = groupRanking[0]
  const avg = groupRanking.reduce((s, g) => s + g.returnPct, 0) / groupRanking.length
  const beatBench = bench.last != null ? groupRanking.filter((g) => g.returnPct > bench.last).length : null

  return (
    <>
      <div className="grid cols-4">
        <div className="stat">
          <div className="label">目前第一名組別</div>
          <div className="value sm">{best.name}</div>
          <div className="foot">
            <span className={tone(best.returnPct)}>{pct(best.returnPct)}</span>　{best.members.length} 人　平均每人{' '}
            <span className={tone(best.avgProfit)}>{signedMoney(best.avgProfit)}</span>
          </div>
        </div>
        <div className="stat">
          <div className="label">各組平均報酬率</div>
          <div className={`value tabular ${tone(avg)}`}>{pct(avg)}</div>
          <div className="foot">
            {groupRanking.length} 組參賽{ungrouped.length ? `　${ungrouped.length} 人未分組` : ''}
          </div>
        </div>
        <div className="stat">
          <div className="label">{bench.label}</div>
          <div className={`value tabular ${tone(bench.last)}`}>{bench.last != null ? pct(bench.last) : '—'}</div>
          <div className="foot">{beatBench != null ? `${beatBench} 組勝過大盤` : ''}</div>
        </div>
        {myGroup ? (
          <div className="stat">
            <div className="label">我的組別</div>
            <div className="value sm">
              {myGroup.name}　第 {myGroup.rank} 名
            </div>
            <div className="foot">
              組報酬率 <span className={tone(myGroup.returnPct)}>{pct(myGroup.returnPct)}</span>　組內第{' '}
              {myGroup.memberRank} 名／{myGroup.size} 人
            </div>
          </div>
        ) : (
          <SettleDateStat />
        )}
      </div>

      <Card
        title="各組報酬率走勢"
        sub={`點下方表格的組別可加入或移除比較對象（最多 ${MAX_COMPARE} 組）`}
        actions={compare.customized ? <button className="tiny" onClick={compare.reset}>回到預設</button> : null}
      >
        <LineChart labels={chart.labels} series={chart.series} height={300} zeroLine format={axisPct} />
      </Card>

      <Card
        title="分組排行榜"
        sub="依組報酬率（全組損益 ÷ 全組本金）排名，不受各組人數影響；每人本金相同時，名次與平均每人損益一致"
        actions={<button onClick={exportCSV}>匯出分組成績 CSV</button>}
        tight
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th className="num">名次</th>
                <th>組別</th>
                <th className="num">人數</th>
                <th className="num">組總資產</th>
                <th className="num">組損益</th>
                <th className="num">平均每人損益</th>
                <th className="num">組報酬率</th>
                <th className="num">當日漲跌</th>
                <th>成員（依報酬率）</th>
              </tr>
            </thead>
            <tbody>
              {groupRanking.map((g) => {
                const mine = g.key === myGroup?.key
                return (
                  <tr key={g.key} style={mine ? { background: 'var(--brand-soft)' } : undefined}>
                    <td className="num">
                      <RankMedal rank={g.rank} />
                    </td>
                    <td>
                      <CompareButton selected={compare.ids.includes(g.key)} onClick={() => compare.toggle(g.key)}>
                        {g.name}
                        {mine && ' ★'}
                      </CompareButton>
                    </td>
                    <td className="num">{g.members.length}</td>
                    <td className="num">{money(g.total)}</td>
                    <td className={`num ${tone(g.profit)}`}>{signedMoney(g.profit)}</td>
                    <td className={`num ${tone(g.avgProfit)}`}>{signedMoney(g.avgProfit)}</td>
                    <td className={`num ${tone(g.returnPct)}`}>
                      <b>{pct(g.returnPct)}</b>
                    </td>
                    <td className={`num ${tone(g.dayChange)}`}>{g.dayChange ? signedMoney(g.dayChange) : '—'}</td>
                    <td className="small muted" style={{ whiteSpace: 'normal', minWidth: 240 }}>
                      {g.members.map((m, i) => (
                        <span key={m.studentId}>
                          {i > 0 && '、'}
                          <span style={m.studentId === authId ? { color: 'var(--brand-text)', fontWeight: 700 } : undefined}>
                            {m.name || m.studentId}
                          </span>
                          （{pct(m.returnPct)}）
                        </span>
                      ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {ungroupedNote && <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>{ungroupedNote}</div>}
      </Card>
    </>
  )
}
