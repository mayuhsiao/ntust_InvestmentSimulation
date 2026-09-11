import { useEffect, useMemo, useRef, useState } from 'react'
import { searchStocks, searchRemote } from '../services/prices.js'
import { price as fmtPrice } from '../lib/format.js'

/** 看起來像股票代號嗎？台股為數字（可帶英文後綴），美股為純英文 */
const LOOKS_LIKE_CODE = /^(\d{4,6}[A-Z]?|[A-Z]{1,5}([.-][A-Z]{1,3})?)$/

/** 股票代號／名稱搜尋下拉（本地清單 + 伺服器查詢雙保險，支援鍵盤上下選取） */
export default function StockSearch({
  list = [],
  onSelect,
  placeholder = '輸入代號或名稱，例如 2330、台積電、AAPL',
  autoFocus,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [remote, setRemote] = useState([])
  const [searching, setSearching] = useState(false)
  const [hint, setHint] = useState('')
  const boxRef = useRef(null)

  const localMatches = useMemo(() => searchStocks(list, query, 10), [list, query])

  // 伺服器查詢延遲 250ms，避免每打一個字就送一次
  useEffect(() => {
    const q = query.trim()
    setHint('')
    if (!q) {
      setRemote([])
      setSearching(false)
      return
    }
    let cancelled = false
    setSearching(true)
    const timer = setTimeout(() => {
      searchRemote(q)
        .then((r) => !cancelled && setRemote(r))
        .finally(() => !cancelled && setSearching(false))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const matches = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const s of [...localMatches, ...remote]) {
      if (!s.code || seen.has(s.code)) continue
      seen.add(s.code)
      out.push(s)
    }
    return out.slice(0, 14)
  }, [localMatches, remote])

  useEffect(() => {
    setCursor(0)
  }, [query])

  useEffect(() => {
    const onDocClick = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  function choose(stock) {
    if (!stock) return
    onSelect?.(stock)
    setQuery('')
    setRemote([])
    setHint('')
    setOpen(false)
  }

  /**
   * 送出：有結果就選第一筆。
   * 沒有結果時只接受「看起來像代號」的輸入 ——
   * 否則手機使用者打「台積電」再按鍵盤送出鍵，中文會被當成代號送出去查，
   * 結果是一則看不懂的錯誤訊息。
   */
  function submit() {
    const q = query.trim()
    if (!q) return
    if (matches.length) return choose(matches[Math.min(cursor, matches.length - 1)])
    if (searching) return setHint('搜尋中，請稍候…')
    if (LOOKS_LIKE_CODE.test(q.toUpperCase())) {
      return choose({ code: q.toUpperCase(), name: '', market: '' })
    }
    setHint('找不到這檔股票。請確認名稱或改輸入代號（例如台積電是 2330）。')
  }

  function onKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault()
      return submit()
    }
    if (!matches.length) return
    if (e.key === 'ArrowDown') {
      setCursor((c) => Math.min(c + 1, matches.length - 1))
      setOpen(true)
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      setCursor((c) => Math.max(c - 1, 0))
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showList = open && query.trim()

  return (
    <div className="combo" ref={boxRef}>
      <input
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {hint && (
        <div className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>
          {hint}
        </div>
      )}

      {showList && (
        <div className="combo-list">
          {matches.length === 0 && (
            <div className="combo-item muted">
              {searching ? '搜尋中…' : '查無相符的股票，請確認代號或名稱'}
            </div>
          )}
          {matches.map((s, i) => (
            <div
              key={`${s.code}-${s.market}`}
              className={`combo-item${i === cursor ? ' active' : ''}`}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(s)}
            >
              <span className="code">{s.code}</span>
              <span className="nm">{s.name}</span>
              <span className={`badge${s.market === 'US' ? ' brand' : ''}`}>
                {s.market === 'US' ? '美股' : s.market === 'TPEX' ? '上櫃' : '上市'}
              </span>
              <span className="px">
                {s.market === 'US' ? s.exchange || '' : s.close != null ? fmtPrice(s.close) : ''}
              </span>
            </div>
          ))}
          {searching && matches.length > 0 && (
            <div className="combo-item muted small">搜尋中…</div>
          )}
        </div>
      )}
    </div>
  )
}
