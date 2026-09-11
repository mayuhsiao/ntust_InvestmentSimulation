import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import NtustLogo from '../components/NtustLogo.jsx'
import { money } from '../lib/format.js'
import { DEFAULT_CONFIG } from '../services/defaults.js'

export default function Login() {
  const { signIn, activate, mode } = useApp()
  const [tab, setTab] = useState('signin')
  const [form, setForm] = useState({ studentId: '', password: '', confirm: '', name: '', group: '', joinCode: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const classSite = DEFAULT_CONFIG.classSiteUrl
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
        await activate(form.studentId, form.password, {
          name: form.name.trim(),
          group: form.group.trim(),
          joinCode: form.joinCode.trim(),
        })
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
        <div className="hero-watermark">
          <NtustLogo size={430} variant="seal" tone="mono" color="#fff" />
        </div>

        <div className="hero-brand">
          <NtustLogo size={54} variant="seal" tone="mono" color="#fff" />
          <div>
            <b>國立臺灣科技大學</b>
            <span>國際經濟趨勢與策略分析(彭文彥)</span>
          </div>
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

        {classSite && (
          <div style={{ fontSize: 13, opacity: 0.9 }}>
            班級網站：
            <a className="hero-link" href={classSite} target="_blank" rel="noopener noreferrer">
              {classSite.replace(/^https?:\/\//, '')} ↗
            </a>
          </div>
        )}
      </aside>

      <main className="login-panel">
        <form className="login-form" onSubmit={submit}>
          <h2>{tab === 'signin' ? '登入' : '註冊新帳號'}</h2>
          <div className="sub">
            {tab === 'signin' ? '使用學號與密碼登入' : '輸入老師公布的註冊認證碼，即可自行建立帳號'}
          </div>

          <div className="seg">
            <button type="button" className={tab === 'signin' ? 'active' : ''} onClick={() => setTab('signin')}>
              登入
            </button>
            <button type="button" className={tab === 'activate' ? 'active' : ''} onClick={() => setTab('activate')}>
              註冊新帳號
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

            {tab === 'activate' && (
              <div>
                <label>註冊認證碼</label>
                <input
                  value={form.joinCode}
                  onChange={set('joinCode')}
                  placeholder="老師課堂上公布的認證碼"
                  autoComplete="off"
                />
                <div className="small muted" style={{ marginTop: 4 }}>
                  老師已經匯入你的學號時可以留空
                </div>
              </div>
            )}

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
                    <label>姓名</label>
                    <input value={form.name} onChange={set('name')} placeholder="王小明" />
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
              {busy ? <span className="loader" /> : tab === 'signin' ? '登入' : '註冊並登入'}
            </button>
          </div>

          <div className="notice" style={{ marginTop: 18 }}>
            {mode === 'local' ? (
              <>
                <b>目前為本機示範模式</b>
                <br />
                尚未設定 Firebase，資料暫存在這台電腦的瀏覽器中。第一個註冊的帳號會自動成為老師（管理者）。
              </>
            ) : (
              <>
                <b>忘記密碼？</b>
                <br />
                請聯絡授課老師協助重設。
              </>
            )}
          </div>

          {classSite && (
            <div className="small muted" style={{ marginTop: 14, textAlign: 'center' }}>
              <a href={classSite} target="_blank" rel="noopener noreferrer">
                前往班級網站 ↗
              </a>
            </div>
          )}
        </form>
      </main>
    </div>
  )
}
