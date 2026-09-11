import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { Card, Field } from '../components/ui.jsx'
import { money, pct, dateTime, tone } from '../lib/format.js'

export default function Account() {
  const { me, authId, isAdmin, mode, config, mySnapshot, myRank, changePassword, notify, lastSync } = useApp()
  const [form, setForm] = useState({ old: '', next: '', confirm: '' })
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('ntust-invest:theme') || 'system')

  function applyTheme(value) {
    setTheme(value)
    localStorage.setItem('ntust-invest:theme', value)
    const root = document.documentElement
    if (value === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', value)
  }

  async function submit(e) {
    e.preventDefault()
    if (form.next !== form.confirm) return notify('兩次輸入的新密碼不一致', 'error')
    setBusy(true)
    try {
      await changePassword(form.old, form.next)
      setForm({ old: '', next: '', confirm: '' })
    } catch (err) {
      notify(err.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid cols-2">
      <Card title="我的資料">
        <div className="kv"><span>學號</span><b className="tabular">{authId}</b></div>
        <div className="kv"><span>姓名</span><b>{me?.name || '—'}</b></div>
        <div className="kv"><span>組別</span><b>{me?.group || '—'}</b></div>
        <div className="kv"><span>身分</span><b>{isAdmin ? '老師（管理者）' : '學生'}</b></div>
        <div className="kv"><span>起始本金</span><b>{money(me?.initialCapital || config.initialCapital)}</b></div>
        <div className="kv"><span>目前總資產</span><b>{money(mySnapshot.total)}</b></div>
        <div className="kv">
          <span>總報酬率</span>
          <b className={tone(mySnapshot.returnPct)}>{pct(mySnapshot.returnPct)}</b>
        </div>
        <div className="kv"><span>目前名次</span><b>{myRank ? `第 ${myRank.rank} 名` : '—'}</b></div>
        <div className="kv"><span>資料儲存</span><b>{mode === 'firebase' ? 'Firebase 雲端' : '本機瀏覽器（示範模式）'}</b></div>
        <div className="kv"><span>報價最後更新</span><b>{lastSync ? dateTime(lastSync) : '—'}</b></div>
      </Card>

      <div className="stack">
        <Card title="修改密碼">
          <form onSubmit={submit} className="stack sm">
            <Field label="目前密碼">
              <input
                type="password"
                value={form.old}
                onChange={(e) => setForm({ ...form, old: e.target.value })}
                autoComplete="current-password"
              />
            </Field>
            <Field label="新密碼" hint="至少 6 個字元">
              <input
                type="password"
                value={form.next}
                onChange={(e) => setForm({ ...form, next: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
            <Field label="確認新密碼">
              <input
                type="password"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                autoComplete="new-password"
              />
            </Field>
            <button className="primary" type="submit" disabled={busy || !form.old || !form.next}>
              {busy ? <span className="loader" /> : '更新密碼'}
            </button>
          </form>
        </Card>

        <Card title="顯示外觀">
          <div className="seg" style={{ margin: 0 }}>
            {[
              ['system', '跟隨系統'],
              ['light', '淺色'],
              ['dark', '深色'],
            ].map(([k, label]) => (
              <button key={k} className={theme === k ? 'active' : ''} onClick={() => applyTheme(k)}>
                {label}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
