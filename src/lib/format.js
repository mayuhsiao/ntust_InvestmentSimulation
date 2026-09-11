/** 顯示格式化工具 */

const NF = (min, max) => new Intl.NumberFormat('zh-TW', { minimumFractionDigits: min, maximumFractionDigits: max })
const nf0 = NF(0, 0)
const nf2 = NF(2, 2)
const nfAuto = NF(0, 2)

export function money(n, digits = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return (digits === 2 ? nf2 : nf0).format(Number(n))
}

export function num(n, digits = 2) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return NF(0, digits).format(Number(n))
}

/** 股價：未滿 50 元顯示兩位、以上顯示到小數點兩位但去掉多餘的 0 */
export function price(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return nfAuto.format(Number(n))
}

/** 報酬率：傳入比例（0.0523 → '+5.23%'） */
export function pct(ratio, digits = 2) {
  if (ratio == null || !Number.isFinite(Number(ratio))) return '—'
  const v = Number(ratio) * 100
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

export function signedMoney(n, digits = 0) {
  if (n == null || !Number.isFinite(Number(n))) return '—'
  return `${Number(n) > 0 ? '+' : ''}${money(n, digits)}`
}

/** 漲跌方向 → CSS class */
export function tone(n) {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) === 0) return 'flat'
  return Number(n) > 0 ? 'up' : 'down'
}

/** 1000 → '1 張'；1500 → '1 張 500 股'；500 → '500 股' */
export function lots(shares) {
  const s = Math.round(Number(shares) || 0)
  const lot = Math.floor(s / 1000)
  const odd = s % 1000
  if (lot && odd) return `${nf0.format(lot)} 張 ${nf0.format(odd)} 股`
  if (lot) return `${nf0.format(lot)} 張`
  return `${nf0.format(odd)} 股`
}

export function shortDate(iso) {
  if (!iso) return '—'
  return String(iso).slice(5).replace('-', '/')
}

export function dateTime(value) {
  if (!value) return '—'
  const d = value?.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
