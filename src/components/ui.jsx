import { tone } from '../lib/format.js'

export function Card({ title, sub, actions, children, tight, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {sub && <div className="sub">{sub}</div>}
          </div>
          <div className="spacer" />
          {actions}
        </header>
      )}
      <div className={`card-body${tight ? ' tight' : ''}`}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, foot, delta, small }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={`value tabular${small ? ' sm' : ''}${delta != null ? ` ${tone(delta)}` : ''}`}>{value}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  )
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="small">{children}</div>}
    </div>
  )
}

export function Field({ label, hint, children }) {
  return (
    <div>
      <label>{label}</label>
      {children}
      {hint && <div className="small muted" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

export function RankMedal({ rank }) {
  return <span className={`rank-medal${rank <= 3 ? ` g${rank}` : ''}`}>{rank}</span>
}

export function MarketBadge({ market }) {
  if (!market) return null
  const map = { TWSE: '上市', TPEX: '上櫃', OTHER: '其他' }
  return <span className="badge">{map[market] || market}</span>
}
