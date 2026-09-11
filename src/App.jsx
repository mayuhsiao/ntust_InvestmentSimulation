import { useEffect, useState } from 'react'
import { useApp } from './context/AppContext.jsx'
import Login from './pages/Login.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Trade from './pages/Trade.jsx'
import History from './pages/History.jsx'
import Leaderboard from './pages/Leaderboard.jsx'
import Admin from './pages/Admin.jsx'
import Account from './pages/Account.jsx'
import NtustLogo from './components/NtustLogo.jsx'
import { pct, tone, dateTime } from './lib/format.js'

const TABS = [
  { key: 'dashboard', label: '我的投資' },
  { key: 'trade', label: '交易下單' },
  { key: 'history', label: '交易紀錄' },
  { key: 'leaderboard', label: '排行榜' },
  { key: 'admin', label: '管理', adminOnly: true },
  { key: 'account', label: '帳號' },
]

function readHash() {
  const key = window.location.hash.replace(/^#\/?/, '')
  return TABS.some((t) => t.key === key) ? key : 'dashboard'
}

export default function App() {
  const {
    authId, booting, loading, error, toast, me, isAdmin, config, mode,
    signOut, refresh, priceSyncing, lastSync, myRank, mySnapshot, lastTradingDay, isPractice,
  } = useApp()

  const [page, setPage] = useState(readHash)

  useEffect(() => {
    const onHash = () => setPage(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  function navigate(key) {
    window.location.hash = `/${key}`
    setPage(key)
  }

  if (booting) {
    return (
      <div className="center-screen">
        <span className="loader" style={{ width: 26, height: 26 }} />
        <div>載入中…</div>
      </div>
    )
  }

  if (!authId) return <Login />

  const visibleTabs = TABS.filter((t) => !t.adminOnly || isAdmin)
  const active = visibleTabs.some((t) => t.key === page) ? page : 'dashboard'

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="logo">
            <span className="logo-mark">
              <NtustLogo size={32} variant="mark" />
            </span>
            <span>
              台股投資模擬競賽
              <small>{config.name}</small>
            </span>
          </div>

          {config.classSiteUrl && (
            <a
              className="site-link"
              href={config.classSiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={config.classSiteUrl}
            >
              🏫 班級網站 ↗
            </a>
          )}

          <div className="spacer" />

          <div className="row tight small muted" style={{ flexWrap: 'nowrap' }}>
            {mode === 'local' && <span className="badge warn">本機示範模式</span>}
            {isPractice && <span className="badge warn">測試期</span>}
            {config.lockTrading && <span className="badge warn">交易已鎖定</span>}
            <span className="tabular">結算日 {lastTradingDay}</span>
          </div>

          <button className="ghost" onClick={refresh} disabled={loading || priceSyncing} title={lastSync ? `報價最後更新 ${dateTime(lastSync)}` : ''}>
            {loading || priceSyncing ? <span className="loader" /> : '↻ 更新'}
          </button>

          <div className="user-chip">
            <span className="avatar">{(me?.name || authId || '?').slice(0, 1)}</span>
            <div className="meta">
              <b>{me?.name || authId}</b>
              <span>
                {authId}
                {myRank ? ` · 第 ${myRank.rank} 名` : ''}
                {' · '}
                <span className={tone(mySnapshot.returnPct)}>{pct(mySnapshot.returnPct)}</span>
              </span>
            </div>
          </div>

          <button className="ghost" onClick={signOut}>
            登出
          </button>
        </div>

        <nav className="tabs">
          {visibleTabs.map((t) => (
            <button key={t.key} className={`tab${active === t.key ? ' active' : ''}`} onClick={() => navigate(t.key)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="content">
        {isPractice && (
          <div className="notice warn" style={{ marginBottom: 16 }}>
            🧪 <b>目前是測試期（到 {config.practiceUntil} 為止）</b>
            現在可以自由買賣、熟悉操作，所有功能都跟正式競賽一模一樣。
            <b>{config.officialStartDate} 正式開賽前，這段期間的交易紀錄會全部清除、本金歸零重來</b>，
            所以請放心亂按。
          </div>
        )}
        {error && <div className="notice error" style={{ marginBottom: 16 }}>{error}</div>}
        {active === 'dashboard' && <Dashboard onNavigate={navigate} />}
        {active === 'trade' && <Trade />}
        {active === 'history' && <History />}
        {active === 'leaderboard' && <Leaderboard />}
        {active === 'admin' && isAdmin && <Admin />}
        {active === 'account' && <Account />}
      </main>

      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </div>
  )
}
