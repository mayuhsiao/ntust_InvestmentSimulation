/** CSV / TSV 解析與匯出（支援直接從 Google 試算表複製貼上） */

/** 自動判斷分隔符號：Tab（從試算表複製）優先，其次逗號 */
export function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n')
  const tabs = (head.match(/\t/g) || []).length
  const commas = (head.match(/,/g) || []).length
  if (tabs > 0 && tabs >= commas) return '\t'
  return ','
}

/** 解析成二維陣列，支援雙引號包住的欄位與欄內換行 */
export function parseTable(text, delimiter) {
  const d = delimiter || detectDelimiter(text)
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  const src = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === d) {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }

  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''))
}

const HEADER_HINTS = ['組別', '學號', '姓名', '代號', '標的', '股數', '金額', '價格', '日期', 'id', 'name', 'code']

/** 判斷第一列是否為標題列 */
export function looksLikeHeader(row) {
  if (!row) return false
  const joined = row.join('')
  if (HEADER_HINTS.some((h) => joined.includes(h))) return true
  // 整列都沒有數字，多半是標題
  return row.every((c) => c && !/^\d/.test(c))
}

/** 陣列轉 CSV 字串（含 BOM，Excel 開啟不會亂碼） */
export function toCSV(rows, { bom = true } = {}) {
  const esc = (v) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const body = rows.map((r) => r.map(esc).join(',')).join('\r\n')
  return (bom ? '﻿' : '') + body
}

export function downloadCSV(filename, rows) {
  const blob = new Blob([toCSV(rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    // 先用 UTF-8；若出現大量替代字元再改用 Big5 重讀
    reader.readAsText(file, 'utf-8')
  })
}

export async function readSpreadsheetFile(file) {
  let text = await readFileAsText(file)
  if ((text.match(/�/g) || []).length > 3 && typeof TextDecoder !== 'undefined') {
    try {
      const buf = await file.arrayBuffer()
      text = new TextDecoder('big5').decode(buf)
    } catch {
      /* 瀏覽器不支援 big5 就沿用原本結果 */
    }
  }
  return text.replace(/^﻿/, '')
}
