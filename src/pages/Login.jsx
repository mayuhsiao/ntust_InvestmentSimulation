import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { money } from '../lib/format.js'
import { DEFAULT_CONFIG } from '../services/defaults.js'

export default function Login() {
  const { signIn, activate, mode } = useApp()
  const [tab, setTab] = useState('signin')
  const [form, setForm] = useState({ studentId: '', password: '', confirm: '', name: '', group: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.studentId.trim()) return setError('請輸入學號')
    if (!form.password) return setError('請輸入密碼')
    if (tab === 'activate' && form.password !== form.confirm) return setError('兩次輸入的密碼不一致')

    setBusy(true)
    try {
      if (tab === 'signin') {
        await signIn(form.studentId, form.password)
      } else {
        await activate(form.studentId, form.password, { name: form.name.trim(), group: form.group.trim() })
      }
    } catch (err) {
      setError(err.message || '操作失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <aside className="login-hero">
        <div className="logo" style={{ color: '#fff' }}>
          <span className="logo-mark" style={{ background: 'rgba(255,255,255,.18)' }}>📈</span>
          <span>
            國立臺灣科技大學
            <small style={{ color: 'rgba(255,255,255,.7)' }}>理財工具實務與應用</small>
          </span>
        </div>

        <h1>
          台股投資模擬競賽
          <br />
          用真實收盤價，比出真功夫
        </h1>
        <p>
          每人起始本金 {money(DEFAULT_CONFIG.initialCapital)} 元，買賣上市櫃股票以當日收盤價成交，
          系統每日結算淨值並即時排名。
        </p>

        <div className="hero-points">
          <div className="hero-point">
            <span>🏛️</span>
            <div>
              <b>真實報價</b>
              <span>資料取自證交所／櫃買中心與 Yahoo Finance，上市上櫃逾 12,000 檔皆可交易</span>
            </div>
          </div>
          <div className="hero-point">
            <span>🧾</span>
            <div>
              <b>完整成本計算</b>
              <span>手續費 0.1425%（可設折扣、最低 20 元）、賣出證交稅 0.3%，與實際下單一致</span>
            </div>
          </div>
          <div className="hero-point">
            <span>🏆</span>
            <div>
              <b>每日結算排名</b>
              <span>個人與分組報酬率排行榜，並可與大盤／0050 對照走勢</span>
            </div>
          </div>
        </div>
      </aside>

      <main className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <h2>{tab === 'signin' ? '登入' : '首次啟用帳號'}</h2>
          <div className="sub">
            {tab === 'signin' ? '使用學號與密碼登入' : '老師匯入名單後，第一次使用請在此設定自己的密碼'}
          </div>

          <div className="seg">
            <button type="button" className={tab === 'signin' ? 'active' : ''} onClick={() => setTab('signin')}>
              登入
            </button>
            <button type="button" className={tab === 'activate' ? 'active' : ''} onClick={() => setTab('activate')}>
              首次啟用帳號
            </button>
          </div>

          <div className="stack sm">
            <div>
              <label>學號</label>
              <input
                value={form.studentId}
                onChange={set('studentId')}
                placeholder="M11426913"
                autoComplete="username"
                autoCapitalize="characters"
                autoFocus
              />
            </div>

            <div>
              <label>密碼</label>
              <input
                type="password"
                value={form.password}
                onChange={set('password')}
                placeholder={tab === 'activate' ? '請設定至少 6 個字元' : '請輸入密碼'}
                autoComplete={tab === 'activate' ? 'new-password' : 'current-password'}
              />
            </div>

            {tab === 'activate' && (
              <>
                <div>
                  <label>確認密碼</label>
                  <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
                </div>
                <div className="field-row">
                  <div>
                    <label>姓名（選填）</label>
                    <input value={form.name} onChange={set('name')} placeholder="沿用名單資料可留空" />
                  </div>
                  <div>
                    <label>組別（選填）</label>
                    <input value={form.group} onChange={set('group')} placeholder="第一組" />
                  </div>
                </div>
              </>
            )}

            {error && <div className="notice error">{error}</div>}

            <button className="primary" type="submit" disabled={busy} style={{ width: '100%', padding: 11 }}>
              {busy ? <span className="loader" /> : tab === 'signin' ? '登入' : '啟用並登入'}
            </button>
          </div>

          <div className="notice" style={{ marginTop: 18 }}>
            {mode === 'local' ? (
              <>
                <b>目前為本機示範模式</b>
                <br />
                尚未設定 Firebase，資料暫存在這台電腦的瀏覽器中。第一個啟用的帳號會自動成為老師（管理者）。
              </>
            ) : (
              <>
                <b>雲端模式（Firebase）</b>
                <br />
                忘記密碼請聯絡授課老師重設。
              </>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}
