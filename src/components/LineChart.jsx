import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * 輕量折線圖（純 SVG，不依賴任何圖表套件）
 *
 * props
 *   labels  string[]                     X 軸標籤（日期）
 *   series  [{ name, color, values, dashed }]  values 與 labels 等長，可含 null
 *   height  number
 *   format  (v) => string                Y 值顯示格式
 *   zeroLine boolean                     是否畫出 0 基準線
 */
export default function LineChart({
  labels = [],
  series = [],
  height = 260,
  format = (v) => String(Math.round(v)),
  zeroLine = false,
  area = false,
}) {
  const wrapRef = useRef(null)
  const [width, setWidth] = useState(900)
  const [hover, setHover] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pad = { top: 12, right: 14, bottom: 24, left: 62 }

  const geometry = useMemo(() => {
    const values = series.flatMap((s) => s.values.filter((v) => v != null && Number.isFinite(v)))
    if (!labels.length || !values.length) return null

    let min = Math.min(...values)
    let max = Math.max(...values)
    if (zeroLine) {
      min = Math.min(min, 0)
      max = Math.max(max, 0)
    }
    if (min === max) {
      const bump = Math.abs(min) * 0.02 || 1
      min -= bump
      max += bump
    }
    const span = max - min
    min -= span * 0.08
    max += span * 0.08

    const plotW = Math.max(10, width - pad.left - pad.right)
    const plotH = Math.max(10, height - pad.top - pad.bottom)
    const xAt = (i) => pad.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW)
    const yAt = (v) => pad.top + plotH - ((v - min) / (max - min)) * plotH

    const ticks = []
    const steps = 4
    for (let i = 0; i <= steps; i++) {
      const v = min + ((max - min) * i) / steps
      ticks.push({ v, y: yAt(v) })
    }

    const xTicks = []
    const count = Math.min(6, labels.length)
    for (let i = 0; i < count; i++) {
      const idx = count === 1 ? 0 : Math.round((i / (count - 1)) * (labels.length - 1))
      xTicks.push({ idx, x: xAt(idx), label: labels[idx] })
    }

    return { min, max, plotW, plotH, xAt, yAt, ticks, xTicks }
  }, [labels, series, width, height, zeroLine])

  if (!geometry) {
    return (
      <div ref={wrapRef} className="empty" style={{ height }}>
        <h3>尚無資料可繪製</h3>
        <div className="small">競賽開始後就會顯示每日淨值走勢</div>
      </div>
    )
  }

  const { xAt, yAt, ticks, xTicks, plotW, plotH } = geometry

  function buildPath(values) {
    let d = ''
    let started = false
    values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return
      d += `${started ? 'L' : 'M'}${xAt(i).toFixed(2)},${yAt(v).toFixed(2)}`
      started = true
    })
    return d
  }

  function onMove(evt) {
    const rect = evt.currentTarget.getBoundingClientRect()
    const x = evt.clientX - rect.left
    const ratio = (x - pad.left) / plotW
    const idx = Math.round(ratio * (labels.length - 1))
    if (idx < 0 || idx >= labels.length) return setHover(null)
    setHover(idx)
  }

  const zeroY = geometry.min <= 0 && geometry.max >= 0 ? yAt(0) : null

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map((s) => (
            <span key={s.name}>
              <i style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <svg
        className="chart"
        width={width}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {series.map((s, i) => (
            <linearGradient key={i} id={`grad-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line className="grid-line" x1={pad.left} y1={t.y} x2={pad.left + plotW} y2={t.y} />
            <text className="axis-text" x={pad.left - 8} y={t.y + 3.5} textAnchor="end">
              {format(t.v)}
            </text>
          </g>
        ))}

        {zeroLine && zeroY != null && (
          <line
            x1={pad.left}
            y1={zeroY}
            x2={pad.left + plotW}
            y2={zeroY}
            stroke="var(--border-strong)"
            strokeWidth="1"
            strokeDasharray="3 3"
          />
        )}

        {xTicks.map((t, i) => (
          <text
            key={i}
            className="axis-text"
            x={t.x}
            y={pad.top + plotH + 16}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {String(t.label).slice(5).replace('-', '/')}
          </text>
        ))}

        {area && series.length === 1 && (
          <path
            d={`${buildPath(series[0].values)}L${xAt(labels.length - 1)},${pad.top + plotH}L${xAt(0)},${
              pad.top + plotH
            }Z`}
            fill="url(#grad-0)"
            stroke="none"
          />
        )}

        {series.map((s, i) => (
          <path
            key={i}
            d={buildPath(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width || 2}
            strokeDasharray={s.dashed ? '5 4' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hover != null && (
          <>
            <line
              x1={xAt(hover)}
              y1={pad.top}
              x2={xAt(hover)}
              y2={pad.top + plotH}
              stroke="var(--border-strong)"
              strokeWidth="1"
            />
            {series.map((s, i) =>
              s.values[hover] == null ? null : (
                <circle
                  key={i}
                  cx={xAt(hover)}
                  cy={yAt(s.values[hover])}
                  r="3.5"
                  fill="var(--surface)"
                  stroke={s.color}
                  strokeWidth="2"
                />
              ),
            )}
          </>
        )}
      </svg>

      {hover != null && (
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: Math.min(Math.max(xAt(hover) - 60, 0), Math.max(0, width - 160)),
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            boxShadow: 'var(--shadow)',
            padding: '7px 10px',
            fontSize: 12,
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            zIndex: 5,
          }}
        >
          <div className="muted" style={{ marginBottom: 3 }}>
            {labels[hover]}
          </div>
          {series.map((s) => (
            <div key={s.name} className="tabular">
              <i
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: s.color,
                  marginRight: 6,
                }}
              />
              {s.name}：<b>{s.values[hover] == null ? '—' : format(s.values[hover])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
