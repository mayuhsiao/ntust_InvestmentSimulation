/**
 * 增量同步與打包（純函式，方便單獨驗證）
 * ------------------------------------------------------------------
 * 全班的交易紀錄與名單幾乎只會「新增」，每次開網頁都整包重讀，
 * 讀取量會隨著交易筆數 × 開網頁次數一路往上疊，很快就超過 Firestore 免費額度。
 *
 * 做法：瀏覽器保留上次讀到的結果，下次只查「某個時間點之後」的文件再合併回去。
 * 這裡的時間一律是 Firestore 伺服器時間（createdAt、activatedAt），不受使用者電腦時鐘影響。
 */

import { toMillis } from './portfolio.js'

/** 文件裡的 Firestore Timestamp 轉成毫秒，才能存進瀏覽器快取，也和本機新增的紀錄格式一致 */
export function plain(data) {
  const out = {}
  for (const [k, v] of Object.entries(data || {})) {
    out[k] = typeof v?.toMillis === 'function' ? v.toMillis() : v
  }
  return out
}

/** 清單中某個時間欄位的最大值（毫秒）；完全沒有時回傳 0 */
export function latest(list, field) {
  let max = 0
  for (const item of list) {
    const t = toMillis(item[field])
    if (t > max) max = t
  }
  return max
}

/**
 * 把「field >= since 的最新文件」合併回快取。
 *   - 快取中 field < since（或沒有這個欄位）的資料沿用，查詢本來就不會回傳它們
 *   - field >= since 的部分完全以 fresh 為準，期間內被刪除的文件就會從結果消失
 */
export function mergeSince(cached, fresh, { field, since, key }) {
  const out = new Map()
  for (const item of cached) {
    const t = toMillis(item[field])
    if (!t || t < since) out.set(item[key], item)
  }
  for (const item of fresh) out.set(item[key], item)
  return [...out.values()]
}

/** JSON 中的非 ASCII 字元（股票中文名稱）改寫成 \uXXXX，字元數就等於位元組數，切段時不會超過文件大小上限 */
export function asciiJson(value) {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

/** 長字串切成固定長度的段落（至少回傳一段） */
export function chunkText(text, size) {
  const out = []
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size))
  return out.length ? out : ['']
}
