import { useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import NtustLogo from '../components/NtustLogo.jsx'

/**
 * 已經有帳號、但還沒加入班級名單時顯示。
 * 常見情況是註冊當下認證碼打錯，或老師還沒設定認證碼。
 * 這裡讓同學直接補填就好，不用重新設定密碼。
 */
export default function CompleteJoin() {
  const { authId, joinRoster, abandonRegistration, signOut, config } = useApp()
  const [form, setForm] = useState({ joinCode: '', name: '', group: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!form.joinCode.trim()) return setError('請輸入老師公布的註冊認證碼')
    if (!form.name.trim()) return setError('請輸入姓名')
    setBusy(true)
    try {
      await joinRoster({
        joinCode: form.joinCode.trim(),
        name: form.name.trim(),
        group: form.group.trim(),
      })
    } catch (err) {
      setError(err.message || '加入失敗')
    } finally {
      setBusy(false)
    }
  }

  async function abandon() {
    if (!confirm('確定要刪除這個帳號嗎？\n\n刪除後可以用同一個學號重新註冊。')) return
    setBusy(true)
    try {
      await abandonRegistration()
    } catch (err) {
      setError(`${err.message}。請改用「登出」後聯絡老師處理。`)
      setBusy(false)
    }
  }

  return (
    <div className="center-screen" style={{ padding: 24 }}>
      <div className="card" style={{ maxWidth: 440, width: '100%' }}>
        <div className="card-body">
          <div className="row" style={{ marginBottom: 16, flexWrap: 'nowrap' }}>
            <NtustLogo size={44} variant="mark" />
            <div>
              <h2 style={{ margin: 0, fontSize: 18 }}>再一步就完成了</h2>
              <div className="small muted">你的帳號已建立，但還沒加入班級名單</div>
            </div>
          </div>

          <div className="notice warn" style={{ marginBottom: 16 }}>
            學號 <b className="tabular">{authId}</b> 目前不在名單中。
            請輸入老師公布的<b>註冊認證碼</b>完成加入。
            <br />
            若老師說已經幫你匯入名單了，請聯絡老師確認學號是否一致。
          </div>

          <form onSubmit={submit} className="stack sm">
            <div>
              <label>註冊認證碼</label>
              <input
                value={form.joinCode}
                onChange={set('joinCode')}
                placeholder="老師課堂上公布的認證碼"
                autoFocus
                autoComplete="off"
                className="mono"
                style={{ letterSpacing: '0.1em', fontWeight: 700 }}
              />
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

            {error && <div className="notice error">{error}</div>}

            <button className="primary" type="submit" disabled={busy} style={{ width: '100%', padding: 11 }}>
              {busy ? <span className="loader" /> : '完成註冊'}
            </button>
          </form>

          <div className="row" style={{ marginTop: 16, justifyContent: 'space-between' }}>
            <button className="ghost" onClick={signOut} disabled={busy}>
              登出
            </button>
            <button className="danger" onClick={abandon} disabled={busy}>
              刪除此帳號重新註冊
            </button>
          </div>

          {config.classSiteUrl && (
            <div className="small muted" style={{ marginTop: 14, textAlign: 'center' }}>
              <a href={config.classSiteUrl} target="_blank" rel="noopener noreferrer">
                前往班級網站 ↗
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
