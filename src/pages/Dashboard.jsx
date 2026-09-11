import { useMemo } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { Card, Stat, Empty, MarketBadge } from '../components/ui.jsx'
import LineChart from '../components/LineChart.jsx'
import { money, pct, price, signedMoney, tone, lots, shortDate } from '../lib/format.js'
import { sortTrades } from '../lib/portfolio.js'

export default function Dashboard({ onNavigate }) {
  const {
    me,
    authId,
    config,
    mySnapshot: snap,
    myNav,
    myTrades,
    myRank,
    ranking,
    benchmarkSeries,
    lastTradingDay,
    calendar,
    notStarted,
    today,
  } = useApp()

  const daysUntilStart = Math.max(
    0,
    Math.round((Date.parse(config.startDate) - Date.parse(today)) / 86400000),
  )

  const chart = useMemo(() => {
    const labels = myNav.map((p) => p.date)
    const mine = myNav.map((p) => p.returnPct * 100)
    const bench = benchmarkSeries.map((p) => p.returnPct * 100)
    return {
      labels,
      series: [
        { name: '我的報酬率', color: 'var(--brand)', values: mine, width: 2.4 },
        ...(bench.length === labels.length
          ? [{ name: `${config.benchmark || '0050'} 對照`, color: 'var(--text-faint)', values: bench, dashed: true }]
          : []),
      ],
    }
  }, [myNav, benchmarkSeries, config.benchmark])

  const recent = useMemo(() => sortTrades(myTrades).slice(-6).reverse(), [myTrades])
  const benchLast = benchmarkSeries[benchmarkSeries.length - 1]?.returnPct ?? null
  const yesterday = myNav[myNav.length - 2]
  const todayRow = myNav[myNav.length - 1]
  const dayChange = todayRow && yesterday ? todayRow.total - yesterday.total : 0

  const started = calendar.length > 0

  return (
    <div className="stack">
      {notStarted ? (
        <div className="notice info">
          🗓️ 競賽將於 <b>{config.startDate}</b> 開始（還有 {daysUntilStart} 天），結算日為 <b>{config.endDate}</b>。
          開賽後即可下單，系統會以每日收盤價結算淨值。
        </div>
      ) : !started ? (
        <div className="notice warn">
          競賽期間為 <b>{config.startDate}</b> ～ <b>{config.endDate}</b>，但尚未取得此區間的交易日報價。
          請到「管理 → 每日結算與報價」按「強制更新全部報價」。
        </div>
      ) : null}

      <div className="grid cols-4">
        <Stat
          label="總資產淨值"
          value={money(snap.total)}
          foot={
            <>
              截至 {lastTradingDay} 收盤
              {dayChange !== 0 && (
                <span className={tone(dayChange)}>　當日 {signedMoney(dayChange)}</span>
              )}
            </>
          }
        />
        <Stat
          label="總報酬率"
          value={pct(snap.returnPct)}
          delta={snap.returnPct}
          foot={
            <>
              損益 <span className={tone(snap.profit)}>{signedMoney(snap.profit)}</span>
              {benchLast != null && <span className="muted">　大盤對照 {pct(benchLast)}</span>}
            </>
          }
        />
        <Stat
          label="可用現金"
          value={money(snap.cash)}
          foot={`本金 ${money(snap.initialCapital)}　持股 ${snap.holdings.length} 檔`}
        />
        <Stat
          label="目前名次"
          value={myRank ? `第 ${myRank.rank} 名` : '—'}
          foot={ranking.length ? `全班 ${ranking.length} 人${me?.group ? `　${me.group}` : ''}` : '尚無其他參賽者'}
        />
      </div>

      <div className="grid side">
        <Card
          title="每日淨值走勢"
          sub={`以每日收盤價結算　${config.startDate} ～ ${config.endDate}`}
        >
          <LineChart
            labels={chart.labels}
            series={chart.series}
            height={280}
            zeroLine
            format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
          />
        </Card>

        <Card title="損益拆解">
          <div className="stack sm">
            <div className="kv">
              <span>期初本金</span>
              <b>{money(snap.initialCapital)}</b>
            </div>
            <div className="kv">
              <span>持股市值</span>
              <b>{money(snap.marketValue)}</b>
            </div>
            <div className="kv">
              <span>現金餘額</span>
              <b>{money(snap.cash)}</b>
            </div>
            <div className="kv">
              <span>已實現損益</span>
              <b className={tone(snap.realized)}>{signedMoney(snap.realized)}</b>
            </div>
            <div className="kv">
              <span>未實現損益</span>
              <b className={tone(snap.unrealized)}>{signedMoney(snap.unrealized)}</b>
            </div>
            <div className="kv">
              <span>累計手續費</span>
              <b>{money(snap.feesPaid)}</b>
            </div>
            <div className="kv">
              <span>累計證交稅</span>
              <b>{money(snap.taxPaid)}</b>
            </div>
            <div className="kv">
              <span>累計成交金額</span>
              <b>{money(snap.turnover)}</b>
            </div>
            <div className="kv">
              <span>交易筆數</span>
              <b>{snap.tradeCount} 筆</b>
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="目前持股"
        sub={`${snap.holdings.length} 檔　以 ${lastTradingDay} 收盤價計算`}
        actions={
          <button className="primary" onClick={() => onNavigate('trade')}>
            下單交易
          </button>
        }
        tight
      >
        {snap.holdings.length === 0 ? (
          <Empty title="目前沒有持股">
            到「交易下單」頁面搜尋股票代號即可買進，例如 2330 台積電。
          </Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>股票</th>
                  <th className="num">股數</th>
                  <th className="num">平均成本</th>
                  <th className="num">收盤價</th>
                  <th className="num">市值</th>
                  <th className="num">未實現損益</th>
                  <th className="num">報酬率</th>
                  <th className="num">持股比重</th>
                </tr>
              </thead>
              <tbody>
                {snap.holdings.map((h) => (
                  <tr key={h.code}>
                    <td>
                      <b className="tabular">{h.code}</b>　{h.name}　<MarketBadge market={h.market} />
                    </td>
                    <td className="num">{lots(h.shares)}</td>
                    <td className="num">{price(h.avgCost)}</td>
                    <td className="num">{price(h.price)}</td>
                    <td className="num">{money(h.marketValue)}</td>
                    <td className={`num ${tone(h.unrealized)}`}>{signedMoney(h.unrealized)}</td>
                    <td className={`num ${tone(h.unrealized)}`}>{pct(h.returnPct)}</td>
                    <td className="num">
                      <div className="row tight" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                        <span>{(h.weight * 100).toFixed(1)}%</span>
                        <div className="weight-bar" style={{ width: Math.max(2, h.weight * 60) }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card
        title="最近交易"
        actions={
          <button className="ghost" onClick={() => onNavigate('history')}>
            查看完整紀錄
          </button>
        }
        tight
      >
        {recent.length === 0 ? (
          <Empty title="還沒有任何交易紀錄" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>別</th>
                  <th>股票</th>
                  <th className="num">成交價</th>
                  <th className="num">股數</th>
                  <th className="num">金額</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td className="tabular">{shortDate(t.date)}</td>
                    <td>
                      <span className={`badge ${t.side === 'BUY' ? 'buy' : 'sell'}`}>
                        {t.side === 'BUY' ? '買進' : '賣出'}
                      </span>
                    </td>
                    <td>
                      <b className="tabular">{t.code}</b>　{t.name}
                    </td>
                    <td className="num">{price(t.price)}</td>
                    <td className="num">{lots(t.shares)}</td>
                    <td className="num">{money(t.net)}</td>
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
