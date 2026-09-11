import { useEffect, useMemo, useRef, useState } from 'react'
import { searchStocks, searchUsStocks } from '../services/prices.js'
import { price as fmtPrice } from '../lib/format.js'

/** 股票代號／名稱搜尋下拉（台股本地清單 + 美股即時查詢，支援鍵盤上下選取） */
export default function StockSearch({
  list = [],
  onSelect,
  placeholder = '輸入代號或名稱，例如 2330、台積電、AAPL',
  autoFocus,
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [usResults, setUsResults] = useState([])
  const boxRef = useRef(null)

  const twMatches = useMemo(() => searchStocks(list, query, 10), [list, query])

  // 美股需要打 API，延遲 250ms 避免每打一個字就查一次
  useEffect(() => {
    const q = query.trim()
    if (!q) return setUsResults([])
    let cancelled = false
    const timer = setTimeout(() => {
      searchUsStocks(q).then((r) => !cancelled && setUsResults(r.slice(0, 6)))
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const matches = useMemo(() => {
    const seen = new Set(twMatches.map((s) => s.code))
    return [...twMatches, ...usResults.filter((s) => !seen.has(s.code))]
  }, [twMatches, usResults])

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
    setOpen(false)
  }

  function onKeyDown(e) {
    if (!open || !matches.length) {
      if (e.key === 'Enter' && query.trim()) {
        // 清單還沒載入時也允許直接用打字的代號送出
        choose({ code: query.trim().toUpperCase(), name: '', market: '' })
        e.preventDefault()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      setCursor((c) => Math.min(c + 1, matches.length - 1))
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      setCursor((c) => Math.max(c - 1, 0))
      e.preventDefault()
    } else if (e.key === 'Enter') {
      choose(matches[cursor])
      e.preventDefault()
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="combo" ref={boxRef}>
      <input
        value={query}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {open && query.trim() && (
        <div className="combo-list">
          {matches.length === 0 && (
            <div className="combo-item muted">
              {list.length ? '查無相符的股票（美股請輸入英文代號或公司名）' : '代號清單載入中…（仍可直接輸入代號後按 Enter）'}
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
        </div>
      )}
    </div>
  )
}
