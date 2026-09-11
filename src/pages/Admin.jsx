import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../context/AppContext.jsx'
import { Card, Empty, Field } from '../components/ui.jsx'
import { parseTable, looksLikeHeader, downloadCSV, readSpreadsheetFile } from '../lib/csv.js'
import { fetchCloses } from '../services/prices.js'
import { settle } from '../lib/fees.js'
import { navSeries, makePriceLookup } from '../lib/portfolio.js'
import { money, pct, price as fmtPrice, tone, lots, dateTime } from '../lib/format.js'

const SECTIONS = [
  { key: 'roster', label: '學生名單' },
  { key: 'import', label: '匯入名單／持股' },
  { key: 'config', label: '競賽設定' },
  { key: 'settle', label: '每日結算與報價' },
]

export default function Admin() {
  const [section, setSection] = useState('roster')
  return (
    <div className="stack">
      <div className="tabs" style={{ padding: 0, borderBottom: '1px solid var(--border)' }}>
        {SECTIONS.map((s) => (
          <button key={s.key} className={`tab${section === s.key ? ' active' : ''}`} onClick={() => setSection(s.key)}>
            {s.label}
          </button>
        ))}
      </div>
      {section === 'roster' && <Roster />}
      {section === 'import' && <ImportPanel />}
      {section === 'config' && <ConfigPanel />}
      {section === 'settle' && <SettlePanel />}
    </div>
  )
}

/* ================================================================== */
/* 學生名單                                                            */
/* ================================================================== */

function Roster() {
  const { students, ranking, saveStudents, removeStudent, config, notify, mode } = useApp()
  const [edit, setEdit] = useState(null)
  const [draft, setDraft] = useState({})

  const rows = useMemo(() => {
    const byId = new Map(ranking.map((r) => [r.studentId, r]))
    return [...students]
      .sort((a, b) => (a.group || '').localeCompare(b.group || '') || a.studentId.localeCompare(b.studentId))
      .map((s) => ({ ...s, rank: byId.get(s.studentId) }))
  }, [students, ranking])

  async function save() {
    await saveStudents([{ ...draft, studentId: edit }])
    setEdit(null)
  }

  function exportRoster() {
    downloadCSV('學生名單', [
      ['組別', '學號', '姓名', '身分', '已啟用', '起始本金', '備註'],
      ...rows.map((s) => [
        s.group, s.studentId, s.name,
        s.role === 'admin' ? '老師' : '學生',
        s.activated ? '是' : '否',
        s.initialCapital || config.initialCapital, s.note || '',
      ]),
    ])
  }

  return (
    <Card
      title={`學生名單（${students.filter((s) => s.role !== 'admin').length} 位學生）`}
      sub="名單匯入後，學生用學號到登入頁「首次啟用帳號」設定自己的密碼"
      actions={<button onClick={exportRoster} disabled={!rows.length}>匯出名單</button>}
      tight
    >
      {rows.length === 0 ? (
        <Empty title="尚未匯入任何學生">切換到「匯入名單／持股」分頁，直接從 Google 試算表複製貼上即可。</Empty>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>組別</th>
                <th>學號</th>
                <th>姓名</th>
                <th>身分</th>
                <th>帳號狀態</th>
                <th className="num">起始本金</th>
                <th className="num">總資產</th>
                <th className="num">報酬率</th>
                <th>備註</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) =>
                edit === s.studentId ? (
                  <tr key={s.studentId}>
                    <td><input value={draft.group || ''} onChange={(e) => setDraft({ ...draft, group: e.target.value })} /></td>
                    <td className="tabular">{s.studentId}</td>
                    <td><input value={draft.name || ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
                    <td>
                      <select value={draft.role || 'student'} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
                        <option value="student">學生</option>
                        <option value="admin">老師</option>
                      </select>
                    </td>
                    <td className="muted small">{s.activated ? '已啟用' : '未啟用'}</td>
                    <td>
                      <input
                        type="number"
                        value={draft.initialCapital ?? ''}
                        placeholder={String(config.initialCapital)}
                        onChange={(e) => setDraft({ ...draft, initialCapital: e.target.value ? Number(e.target.value) : null })}
                      />
                    </td>
                    <td colSpan={3}>
                      <input value={draft.note || ''} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
                    </td>
                    <td className="num">
                      <div className="row tight" style={{ flexWrap: 'nowrap' }}>
                        <button className="tiny primary" onClick={save}>存</button>
                        <button className="tiny" onClick={() => setEdit(null)}>取消</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.studentId}>
                    <td>{s.group || '—'}</td>
                    <td className="tabular">{s.studentId}</td>
                    <td>{s.name}</td>
                    <td>{s.role === 'admin' ? <span className="badge brand">老師</span> : '學生'}</td>
                    <td>
                      {s.activated ? (
                        <span className="badge">已啟用</span>
                      ) : (
                        <span className="badge warn">未啟用</span>
                      )}
                    </td>
                    <td className="num">{money(s.initialCapital || config.initialCapital)}</td>
                    <td className="num">{s.rank ? money(s.rank.total) : '—'}</td>
                    <td className={`num ${s.rank ? tone(s.rank.returnPct) : ''}`}>
                      {s.rank ? pct(s.rank.returnPct) : '—'}
                    </td>
                    <td className="muted small">{s.note || ''}</td>
                    <td className="num">
                      <div className="row tight" style={{ flexWrap: 'nowrap', justifyContent: 'flex-end' }}>
                        <button
                          className="tiny"
                          onClick={() => {
                            setEdit(s.studentId)
                            setDraft({ ...s })
                          }}
                        >
                          編輯
                        </button>
                        <button
                          className="tiny danger"
                          onClick={() => {
                            if (confirm(`確定刪除 ${s.studentId} ${s.name}？\n他的所有交易紀錄也會一併刪除，無法復原。`)) {
                              removeStudent(s.studentId)
                            }
                          }}
                        >
                          刪除
                        </button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ================================================================== */
/* 匯入                                                                */
/* ================================================================== */

const FIELDS = [
  { key: 'skip', label: '（略過）' },
  { key: 'group', label: '組別' },
  { key: 'studentId', label: '學號' },
  { key: 'name', label: '姓名' },
  { key: 'code', label: '股票代號' },
  { key: 'stockName', label: '股票名稱／標的' },
  { key: 'amount', label: '投資金額' },
  { key: 'shares', label: '股數' },
  { key: 'buyPrice', label: '買入價格' },
  { key: 'buyDate', label: '買入日期' },
  { key: 'capital', label: '起始本金' },
  { key: 'note', label: '備註' },
]

const GUESS = [
  [/組別|group|team/i, 'group'],
  [/學號|id$|student/i, 'studentId'],
  [/姓名|name$/i, 'name'],
  [/代號|代碼|code|ticker|symbol/i, 'code'],
  [/標的|股票名|個股/i, 'stockName'],
  [/投資金額|金額|amount|市值/i, 'amount'],
  [/股數|shares/i, 'shares'],
  [/買入價|成本價|買進價|price/i, 'buyPrice'],
  [/買入日|起始日|日期|date/i, 'buyDate'],
  [/本金|capital/i, 'capital'],
  [/備註|note|remark/i, 'note'],
]

function guessField(header) {
  for (const [re, key] of GUESS) if (re.test(header || '')) return key
  return 'skip'
}

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s$元NTD]/gi, ''))
  return Number.isFinite(n) ? n : null
}

function ImportPanel() {
  const { config, saveStudents, addTrade, notify, students } = useApp()
  const [text, setText] = useState('')
  const [table, setTable] = useState(null)
  const [mapping, setMapping] = useState([])
  const [hasHeader, setHasHeader] = useState(true)
  const [withHoldings, setWithHoldings] = useState(false)
  const [useFilePrice, setUseFilePrice] = useState(false)
  const [buyDate, setBuyDate] = useState(config.startDate)
  const [busy, setBusy] = useState(false)
  const [log, setLog] = useState([])
  const fileRef = useRef(null)

  function analyse(raw) {
    const rows = parseTable(raw)
    if (!rows.length) {
      setTable(null)
      return
    }
    const header = looksLikeHeader(rows[0])
    setHasHeader(header)
    setTable(rows)
    const width = Math.max(...rows.map((r) => r.length))
    const head = header ? rows[0] : []
    setMapping(Array.from({ length: width }, (_, i) => guessField(head[i])))
  }

  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const content = await readSpreadsheetFile(file)
    setText(content)
    analyse(content)
  }

  const dataRows = useMemo(() => (table ? (hasHeader ? table.slice(1) : table) : []), [table, hasHeader])

  const parsed = useMemo(() => {
    const get = (row, key) => {
      const i = mapping.indexOf(key)
      return i >= 0 ? row[i] : undefined
    }
    return dataRows.map((row) => ({
      group: (get(row, 'group') || '').trim(),
      studentId: (get(row, 'studentId') || '').trim().toUpperCase(),
      name: (get(row, 'name') || '').trim(),
      code: (get(row, 'code') || '').trim().toUpperCase(),
      stockName: (get(row, 'stockName') || '').trim(),
      amount: num(get(row, 'amount')),
      shares: num(get(row, 'shares')),
      buyPrice: num(get(row, 'buyPrice')),
      buyDate: (get(row, 'buyDate') || '').trim(),
      capital: num(get(row, 'capital')),
      note: (get(row, 'note') || '').trim(),
    }))
  }, [dataRows, mapping])

  /** 同一位學生可能有多列（多檔持股），組別／姓名以第一次出現為準 */
  const studentList = useMemo(() => {
    const map = new Map()
    let lastGroup = ''
    for (const r of parsed) {
      if (r.group) lastGroup = r.group
      if (!r.studentId) continue
      if (!map.has(r.studentId)) {
        map.set(r.studentId, {
          studentId: r.studentId,
          name: r.name || r.studentId,
          group: r.group || lastGroup,
          role: 'student',
          initialCapital: r.capital || null,
          note: r.note || '',
        })
      }
    }
    return [...map.values()]
  }, [parsed])

  const holdingRows = useMemo(() => {
    let lastId = ''
    return parsed
      .map((r) => {
        if (r.studentId) lastId = r.studentId
        return { ...r, studentId: r.studentId || lastId }
      })
      .filter((r) => r.studentId && r.code && (r.shares || r.amount))
  }, [parsed])

  async function runImport() {
    if (!studentList.length) return notify('沒有辨識到任何學號，請確認欄位對應', 'error')
    setBusy(true)
    setLog([])
    const lines = []
    try {
      await saveStudents(studentList)
      lines.push(`✅ 已匯入 / 更新 ${studentList.length} 位學生`)

      if (withHoldings && holdingRows.length) {
        const codes = [...new Set(holdingRows.map((r) => r.code))]
        lines.push(`📈 取得 ${codes.length} 檔股票在 ${buyDate} 的收盤價…`)
        setLog([...lines])

        const { results } = await fetchCloses(codes, buyDate, buyDate)
        const lookup = makePriceLookup(results)

        let ok = 0
        for (const r of holdingRows) {
          const date = /^\d{4}-\d{2}-\d{2}$/.test(r.buyDate) ? r.buyDate : buyDate
          const close = lookup.at(r.code, date)
          const px = useFilePrice && r.buyPrice ? r.buyPrice : close
          if (!px) {
            lines.push(`⚠️ ${r.studentId} ${r.code}：查不到 ${date} 的收盤價，已略過`)
            continue
          }
          // 由投資金額反推股數時要把手續費算進去，否則現金會被扣成負數
          const feeFactor = 1 + (Number(config.feeRate) || 0) * (Number(config.feeDiscount) || 1)
          const shares = r.shares || Math.floor((r.amount || 0) / (px * feeFactor))
          if (shares <= 0) {
            lines.push(`⚠️ ${r.studentId} ${r.code}：股數為 0，已略過`)
            continue
          }
          const est = settle('BUY', px, shares, config)
          await addTrade({
            studentId: r.studentId,
            date,
            side: 'BUY',
            code: r.code,
            name: r.stockName || results[r.code]?.name || '',
            market: results[r.code]?.market || '',
            shares,
            price: px,
            gross: est.gross,
            fee: est.fee,
            tax: 0,
            net: est.net,
            note: '匯入初始持股',
          })
          ok++
        }
        lines.push(`✅ 已建立 ${ok} 筆初始買進紀錄`)
      }

      lines.push('🎉 匯入完成')
      notify('匯入完成', 'success')
    } catch (err) {
      lines.push(`❌ 匯入失敗：${err.message}`)
      notify(err.message, 'error')
    } finally {
      setLog(lines)
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <Card
        title="匯入學生名單"
        sub="直接從 Google 試算表選取範圍複製（Ctrl+C），貼到下面的框即可；也可以上傳 CSV 檔"
      >
        <div className="stack sm">
          <textarea
            rows={8}
            value={text}
            placeholder={'組別\t學號\t姓名\t標的\t代號\t投資金額\t買入價格\n第一組\tM11426913\t黃志倫\t德宏\t5475\t2000000\t204'}
            onChange={(e) => {
              setText(e.target.value)
              analyse(e.target.value)
            }}
          />
          <div className="row">
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" onChange={onFile} style={{ width: 'auto' }} />
            <div className="spacer" />
            <label style={{ margin: 0 }}>
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                style={{ width: 'auto', marginRight: 6 }}
              />
              第一列是標題列
            </label>
          </div>
        </div>
      </Card>

      {table && (
        <>
          <Card title="欄位對應" sub={`共 ${dataRows.length} 列資料，請確認每一欄的意義`}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {mapping.map((_, i) => (
                      <th key={i}>
                        <select
                          value={mapping[i]}
                          onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? e.target.value : m)))}
                          style={{ minWidth: 120 }}
                        >
                          {FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                        {hasHeader && <div className="small muted" style={{ marginTop: 4 }}>{table[0][i] || ''}</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 6).map((row, i) => (
                    <tr key={i}>
                      {mapping.map((_, j) => (
                        <td key={j} className="small">{row[j] || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {dataRows.length > 6 && <div className="small muted" style={{ marginTop: 8 }}>（僅顯示前 6 列）</div>}
          </Card>

          <Card title="匯入選項">
            <div className="stack sm">
              <div className="notice info">
                將匯入 <b>{studentList.length}</b> 位學生
                {studentList.length > 0 && `：${studentList.slice(0, 6).map((s) => `${s.studentId} ${s.name}`).join('、')}${studentList.length > 6 ? ' …' : ''}`}
                <br />
                已存在的學號會被更新，不會重複建立，也不會影響已有的交易紀錄。
              </div>

              <label style={{ margin: 0 }}>
                <input
                  type="checkbox"
                  checked={withHoldings}
                  onChange={(e) => setWithHoldings(e.target.checked)}
                  style={{ width: 'auto', marginRight: 6 }}
                />
                同時匯入初始持股（辨識到 <b>{holdingRows.length}</b> 筆含股票代號的資料）
              </label>

              {withHoldings && (
                <div className="field-row">
                  <Field label="買進日期" hint="檔案中若有「買入日期」欄會優先採用">
                    <input type="date" value={buyDate} onChange={(e) => setBuyDate(e.target.value)} />
                  </Field>
                  <Field label="成交價來源">
                    <select value={useFilePrice ? 'file' : 'close'} onChange={(e) => setUseFilePrice(e.target.value === 'file')}>
                      <option value="close">使用該日收盤價（建議）</option>
                      <option value="file">使用檔案中的「買入價格」</option>
                    </select>
                  </Field>
                  <Field label="股數計算" hint="沒有「股數」欄時自動換算，並預留手續費避免現金變負數">
                    <input value="投資金額 ÷（成交價 × 含手續費係數）" disabled />
                  </Field>
                </div>
              )}

              <div className="row">
                <button className="primary" onClick={runImport} disabled={busy || !studentList.length}>
                  {busy ? <span className="loader" /> : '開始匯入'}
                </button>
                <button onClick={() => { setText(''); setTable(null); setLog([]) }}>清除</button>
              </div>

              {log.length > 0 && (
                <div className="notice mono small" style={{ whiteSpace: 'pre-wrap' }}>
                  {log.join('\n')}
                </div>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  )
}

/* ================================================================== */
/* 競賽設定                                                            */
/* ================================================================== */

function ConfigPanel() {
  const { config, saveConfig, isPractice, trades, settlements, clearTrades, startOfficial, notify } = useApp()
  const [draft, setDraft] = useState(config)
  const [busy, setBusy] = useState(false)
  const [resetting, setResetting] = useState(false)

  useEffect(() => setDraft(config), [config])

  const set = (k, cast = (v) => v) => (e) => setDraft((d) => ({ ...d, [k]: cast(e.target.value) }))
  const dirty = JSON.stringify(draft) !== JSON.stringify(config)

  async function save() {
    setBusy(true)
    try {
      await saveConfig({
        name: draft.name,
        startDate: draft.startDate,
        endDate: draft.endDate,
        practiceUntil: draft.practiceUntil || '',
        officialStartDate: draft.officialStartDate || '',
        initialCapital: Number(draft.initialCapital) || 0,
        benchmark: String(draft.benchmark || '0050').trim().toUpperCase(),
        feeRate: Number(draft.feeRate),
        feeDiscount: Number(draft.feeDiscount),
        minFee: Number(draft.minFee),
        taxRate: Number(draft.taxRate),
        lockTrading: Boolean(draft.lockTrading),
      })
    } finally {
      setBusy(false)
    }
  }

  async function runReset(mode) {
    const label = mode === 'official' ? '正式開賽' : '清除測試交易'
    const msg =
      mode === 'official'
        ? `確定要「正式開賽」嗎？\n\n• 刪除全部 ${trades.length} 筆交易紀錄\n• 刪除全部 ${settlements.length} 天結算資料\n• 起始日改為 ${draft.officialStartDate || config.officialStartDate}\n• 結束測試期提示\n\n學生名單與帳號會保留。此動作無法復原。`
        : `確定要清除全部 ${trades.length} 筆交易紀錄與 ${settlements.length} 天結算嗎？\n\n學生名單與帳號會保留。此動作無法復原。`
    if (!confirm(msg)) return
    setResetting(true)
    try {
      if (mode === 'official') await startOfficial()
      else await clearTrades()
    } catch (err) {
      notify(`${label}失敗：${err.message}`, 'error')
    } finally {
      setResetting(false)
    }
  }

  return (
    <div className="stack">
    <Card
      title="競賽設定"
      sub={config.updatedAt ? `最後更新：${dateTime(config.updatedAt)}` : '所有學生共用這組設定'}
      actions={
        <button className="primary" onClick={save} disabled={!dirty || busy}>
          {busy ? <span className="loader" /> : '儲存設定'}
        </button>
      }
    >
      <div className="stack">
        <div className="field-row">
          <Field label="競賽名稱">
            <input value={draft.name || ''} onChange={set('name')} />
          </Field>
          <Field label="起始日" hint="第一個交易日的收盤價為基準">
            <input type="date" value={draft.startDate || ''} onChange={set('startDate')} />
          </Field>
          <Field label="結算日">
            <input type="date" value={draft.endDate || ''} onChange={set('endDate')} />
          </Field>
          <Field label="起始本金（元）">
            <input type="number" step="100000" value={draft.initialCapital} onChange={set('initialCapital')} />
          </Field>
        </div>

        <div className="field-row">
          <Field label="測試期到哪一天" hint="這天以前畫面會顯示測試期提醒；留空代表已正式開賽">
            <input type="date" value={draft.practiceUntil || ''} onChange={set('practiceUntil')} />
          </Field>
          <Field label="正式開賽日" hint="按下方「正式開賽」時，起始日會換成這一天">
            <input type="date" value={draft.officialStartDate || ''} onChange={set('officialStartDate')} />
          </Field>
        </div>

        <div className="field-row">
          <Field label="對照指標代號" hint="排行榜與走勢圖的大盤對照，預設 0050">
            <input value={draft.benchmark || ''} onChange={set('benchmark')} />
          </Field>
          <Field label="手續費率" hint="0.001425 = 0.1425%">
            <input type="number" step="0.0001" value={draft.feeRate} onChange={set('feeRate')} />
          </Field>
          <Field label="手續費折扣" hint="1 = 不打折、0.6 = 六折">
            <input type="number" step="0.05" min="0" max="1" value={draft.feeDiscount} onChange={set('feeDiscount')} />
          </Field>
          <Field label="最低手續費（元）">
            <input type="number" step="1" value={draft.minFee} onChange={set('minFee')} />
          </Field>
          <Field label="證交稅率（賣出）" hint="0.003 = 0.3%，ETF 為 0.001">
            <input type="number" step="0.0005" value={draft.taxRate} onChange={set('taxRate')} />
          </Field>
        </div>

        <label style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={Boolean(draft.lockTrading)}
            onChange={(e) => setDraft((d) => ({ ...d, lockTrading: e.target.checked }))}
            style={{ width: 'auto', marginRight: 6 }}
          />
          <b>鎖定交易</b>　勾選後學生無法下單（結算或上課講解時使用；老師仍可下單）
        </label>

        <div className="notice">
          目前設定下，買進 1 張 100 元的股票需支付{' '}
          <b>{money(settle('BUY', 100, 1000, draft).net)}</b> 元；以 110 元賣出可拿回{' '}
          <b>{money(settle('SELL', 110, 1000, draft).net)}</b> 元。
        </div>
      </div>
    </Card>

    <Card
      title="重置競賽資料"
      sub="測試期結束、或想讓同學重新演練時使用。學生名單與帳號一律保留。"
    >
      <div className="stack sm">
        {isPractice ? (
          <div className="notice warn">
            目前是<b>測試期</b>（到 {config.practiceUntil} 為止）。同學現在下的單只是練習，
            正式開賽前請按下面的「正式開賽」把測試資料清乾淨。
          </div>
        ) : (
          <div className="notice">目前為正式競賽期間，起始日 {config.startDate}。</div>
        )}

        <div className="field-row">
          <div className="kv"><span>目前交易紀錄</span><b>{trades.length} 筆</b></div>
          <div className="kv"><span>已保存結算</span><b>{settlements.length} 天</b></div>
          <div className="kv"><span>正式開賽日</span><b>{config.officialStartDate || '—'}</b></div>
        </div>

        <div className="row">
          <button
            className="primary"
            onClick={() => runReset('official')}
            disabled={resetting || !config.officialStartDate}
          >
            {resetting ? <span className="loader" /> : `🚀 正式開賽（清除測試資料並把起始日設為 ${config.officialStartDate || '—'}）`}
          </button>
          <button className="danger" onClick={() => runReset('clear')} disabled={resetting || !trades.length}>
            只清除交易紀錄
          </button>
        </div>

        <div className="small muted">
          「只清除交易紀錄」會保留目前的起始日與測試期設定，適合測試期間反覆演練。
        </div>
      </div>
    </Card>
    </div>
  )
}

/* ================================================================== */
/* 每日結算與報價                                                       */
/* ================================================================== */

function SettlePanel() {
  const {
    competitors, tradesByStudent, lookup, calendar, config, prices,
    saveSettlements, settlements, refreshPrices, priceSyncing, lastSync, notify, lastTradingDay,
  } = useApp()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)

  const priceRows = useMemo(
    () =>
      Object.values(prices)
        .map((p) => {
          const dates = Object.keys(p.closes || {}).sort()
          return {
            code: p.code,
            name: p.name,
            market: p.market,
            days: dates.length,
            last: dates[dates.length - 1] || '—',
            close: dates.length ? p.closes[dates[dates.length - 1]] : null,
          }
        })
        .sort((a, b) => a.code.localeCompare(b.code)),
    [prices],
  )

  const stale = priceRows.filter((r) => r.last < lastTradingDay)

  async function runSettlement() {
    if (!calendar.length) return notify('沒有可結算的交易日，請先更新報價', 'error')
    setBusy(true)
    setProgress(0)
    try {
      const seriesByStudent = competitors.map((s) => ({
        student: s,
        series: navSeries(
          tradesByStudent[s.studentId] || [],
          lookup,
          calendar,
          Number(s.initialCapital) || Number(config.initialCapital) || 0,
        ),
      }))

      const docs = calendar.map((date, i) => {
        const rows = seriesByStudent
          .map(({ student, series }) => {
            const p = series[i]
            return {
              studentId: student.studentId,
              name: student.name || '',
              group: student.group || '',
              cash: round(p.cash),
              marketValue: round(p.marketValue),
              total: round(p.total),
              returnPct: Number(p.returnPct.toFixed(6)),
            }
          })
          .sort((a, b) => b.returnPct - a.returnPct)
        rows.forEach((r, idx) => {
          r.rank = idx + 1
        })
        return { date, rows, count: rows.length }
      })

      for (let i = 0; i < docs.length; i += 20) {
        await saveSettlements(docs.slice(i, i + 20))
        setProgress(Math.round(((i + 20) / docs.length) * 100))
      }
      notify(`已結算 ${docs.length} 個交易日 × ${competitors.length} 位學生`, 'success')
    } catch (err) {
      notify(`結算失敗：${err.message}`, 'error')
    } finally {
      setBusy(false)
      setProgress(0)
    }
  }

  function exportSettlement() {
    const header = ['日期', '名次', '組別', '學號', '姓名', '現金', '持股市值', '總資產', '報酬率']
    const body = []
    for (const doc of settlements) {
      for (const r of doc.rows || []) {
        body.push([doc.date, r.rank, r.group, r.studentId, r.name, r.cash, r.marketValue, r.total, (r.returnPct * 100).toFixed(2) + '%'])
      }
    }
    downloadCSV(`每日結算_${config.startDate}_${lastTradingDay}`, [header, ...body])
  }

  return (
    <div className="stack">
      <Card
        title="每日結算"
        sub="依競賽期間每個交易日的收盤價，計算並保存每位學生的淨值與名次"
        actions={
          <div className="row tight">
            <button onClick={exportSettlement} disabled={!settlements.length}>匯出結算 CSV</button>
            <button className="primary" onClick={runSettlement} disabled={busy || !calendar.length}>
              {busy ? <span className="loader" /> : '執行結算'}
            </button>
          </div>
        }
      >
        <div className="stack sm">
          {busy && (
            <div className="progress">
              <i style={{ width: `${progress}%` }} />
            </div>
          )}
          <div className="field-row">
            <div className="kv"><span>競賽期間</span><b>{config.startDate} ～ {config.endDate}</b></div>
            <div className="kv"><span>已取得交易日</span><b>{calendar.length} 天</b></div>
            <div className="kv"><span>最新交易日</span><b>{lastTradingDay}</b></div>
            <div className="kv"><span>參賽學生</span><b>{competitors.length} 位</b></div>
            <div className="kv"><span>已保存結算</span><b>{settlements.length} 天</b></div>
          </div>
          <div className="notice">
            排行榜本身是「即時計算」的，隨時都看得到最新結果。
            執行結算是把每一天的淨值 <b>永久保存</b> 到資料庫，做為成績存證與事後查核之用。
          </div>
        </div>
      </Card>

      <Card
        title="報價快取"
        sub={lastSync ? `最後更新：${dateTime(lastSync)}` : '尚未更新'}
        actions={
          <button onClick={() => refreshPrices()} disabled={priceSyncing}>
            {priceSyncing ? <span className="loader" /> : '強制更新全部報價'}
          </button>
        }
        tight
      >
        {stale.length > 0 && (
          <div style={{ padding: '12px 18px 0' }}>
            <div className="notice warn">
              有 {stale.length} 檔股票的報價尚未更新到 {lastTradingDay}，請按右上角「強制更新全部報價」。
            </div>
          </div>
        )}
        {priceRows.length === 0 ? (
          <Empty title="尚無報價快取">有人下單後就會自動抓取並快取該檔股票的日收盤價。</Empty>
        ) : (
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>代號</th>
                  <th>名稱</th>
                  <th>市場</th>
                  <th className="num">已快取天數</th>
                  <th className="num">最新報價日</th>
                  <th className="num">最新收盤</th>
                </tr>
              </thead>
              <tbody>
                {priceRows.map((r) => (
                  <tr key={r.code}>
                    <td className="tabular"><b>{r.code}</b></td>
                    <td>{r.name}</td>
                    <td>{r.market === 'TPEX' ? '上櫃' : r.market === 'TWSE' ? '上市' : r.market}</td>
                    <td className="num">{r.days}</td>
                    <td className={`num tabular ${r.last < lastTradingDay ? 'up' : ''}`}>{r.last}</td>
                    <td className="num">{fmtPrice(r.close)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

const round = (n) => Math.round((Number(n) || 0) * 100) / 100
